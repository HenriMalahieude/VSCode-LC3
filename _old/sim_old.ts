import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, exec, Serializable, spawn } from 'child_process';
import * as path from 'path';

const escape_spaces_mod = require('escape-path-with-spaces')

//Issue: This needs to be recompiled into a newer version of node, or this project needs to use an older version of node
console.log(process.version) //v16.14.2
const lc3interface = require("..\\local_modules\\win32\\lc3interface"); //Yet when I compile for 16.14.2 I get Node_module_version 93 instead of 106

//TODO: Get separate things for windows, linux, and mac
let executableFolder = "../lc3tools_WIN"; //default of windows
let output: vscode.OutputChannel = vscode.window.createOutputChannel("LC3-Tools");

let proc: ChildProcessWithoutNullStreams | undefined = undefined;
let sim_webview: vscode.WebviewPanel | undefined = undefined;

//Note: I wish there was a better way to detect operating system. Like detecting Chipset instead.
if (process.platform == 'darwin'){
    //TODO: MAC Version
    executableFolder = "../lc3tools_MAC";
}else if (process.platform == 'linux'){
	//TODO: Linux Version
    executableFolder = "../lc3tools_LIN";
}

//Note: This may break for other systems than windows
function escapeSpaces(input: string) : string {
    if (process.platform == "win32"){
        //console.log(escape_spaces_mod(input));
        //input = input.replaceAll(/((\w+)(\s+))+(\w+)/g, "\"${0}\"");
        //return input;
    }

    return input.replaceAll(/(\s+)/g, "%20");
}

function summonSimWebview(ctx: vscode.ExtensionContext){
    let simViewHTML = "";

    sim_webview = vscode.window.createWebviewPanel(
        "sim",
        "LC3-Tools Integrated Simulator",
        vscode.ViewColumn.One,
        {}
    );

    sim_webview.webview.html = simViewHTML;

    sim_webview.reveal(vscode.ViewColumn.One, false);
}

export function AssembleCode(ctx: vscode.ExtensionContext){
    output.clear();
    output.show();

    let openedWindow = vscode.window.activeTextEditor?.document.uri.fsPath;
    let extensionLocation: any = ctx.extensionUri.fsPath;

    if (openedWindow == undefined || extensionLocation == undefined){
        console.log("No file opened?");
        output.append("No file is opened?");
        return;
    }else if (!openedWindow.endsWith(".asm") && !openedWindow.endsWith(".bin")){
        console.log("File doesn't have proper extension?");
        output.append("File isn't a .asm or .bin file?");
        return;
    }

    //openedWindow = escapeSpaces(openedWindow);

    //let entireCommend = extensionLocation + executableFolder + " --print-level=5 " + openedWindow;
    let pathed = path.format({
        dir: extensionLocation + executableFolder,
        base: 'assembler.exe'
    })
    //let localePath = path.relative(extensionLocation, executableFolder);

    let command: string = pathed + " --print-level=5 " + openedWindow;

    console.log(command);

    exec(command, (error, stdout, stderr) => {
        if (error){
            console.log(`error: ${error.message}`);
            output.append(error.message);
            output.append("\nSystem having issues finding the file? \nIt may be due spaces in a folder name. Please remove them before continuing.");
            return;
        }

        if (stderr){
            console.log(`stderr: ${stderr}`);
            output.append(stderr);
            output.append("\nAssembler having issues finding the file? \nIt may be due spaces in a folder name. Please remove them before continuing.");
            return;
        }

        console.log(`stdout: ${stdout}`);
        output.append(stdout);
    });
}

export function OpenSimulator(ctx: vscode.ExtensionContext){
    output.clear();

    let openedWindow: string | undefined = vscode.window.activeTextEditor?.document.uri.fsPath;
    let extensionLocation: any = ctx.extensionUri.fsPath;

    if (openedWindow == undefined || extensionLocation == undefined){ //nothing is selected
        console.log("No file opened?");
        output.append("No file is opened?");
        output.show();
        return;
    }else if (openedWindow.indexOf("\\") < 0){ //we don't have an active editor selected
        console.log(openedWindow);
        output.append("Please open or click on the file/editor you would like to simulate.");
        output.show();
        return;
    }else if (!openedWindow.endsWith(".asm") && !openedWindow.endsWith(".bin")){
        console.log("File doesn't have proper extension?");
        output.append("File isn't a .asm or .bin file? \n(Have you tried clicking on it/opening the text editor to select it?)\n" + openedWindow);
        output.show();
        return;
    }

    let fileName: string = path.basename(openedWindow);
    let objFile: any = openedWindow?.slice(0, openedWindow.lastIndexOf("\\")) + "\\" + fileName + ".obj";

    //let entireCommend = extensionLocation + executableFolder + " --print-level=5 " + openedWindow;
    let command = extensionLocation + executableFolder + "\\simulator.exe --print-level=8 " + objFile;
    console.log(command);
    
    //summonSimWebview(ctx);

    if (!proc){
        proc = spawn(command);

        proc.addListener("message", (message: Serializable, sendHandle) => {
            output.clear();
            output.append("Message: " + message.toString());
            output.show();
        })

        proc.stdout.on('data', (chunk) => {
            console.log(chunk);
        })

        proc.addListener("close", (code, signal: NodeJS.Signals) => {
            output.append("Simulator closed with code (" + String(code) + ")\nAnd signal: "  +signal.toString());
            output.show();
        })

        proc.addListener("error", (err: Error) => {
            output.append("Simulator error: " + err.message);
        })
    }
}

export function CloseSimulator(ctx : vscode.ExtensionContext){
    proc?.send("quit");
    proc?.kill();
    proc = undefined;
}