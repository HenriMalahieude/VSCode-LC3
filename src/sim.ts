//import * as fs from 'fs';
import * as vscode from 'vscode';
import { exec, spawn } from 'child_process';

//Issue: This needs to be recompiled into a newer version of node, or this project needs to use an older version of node
//const lc3interface = require("..\\local_modules\\lc3interface");

//TODO: Get separate things for windows, linux, and mac
let executableFolder = "\\src\\lc3tools_WIN\\"; //default
let output: vscode.OutputChannel = vscode.window.createOutputChannel("LC3-Tools");

//Note: I wish there was a better way to detect operating system. Like detecting Chipset instead.
if (process.platform == 'darwin'){
    //TODO: MAC Version
    executableFolder = "\\src\\lc3tools_MAC";
}else if (process.platform == 'linux'){
	//TODO: Linux Version
    executableFolder = "\\src\\lc3tools_LIN";
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

    //let entireCommend = extensionLocation + executableFolder + " --print-level=5 " + openedWindow;
    let command  = extensionLocation + executableFolder + "\\assembler.exe --print-level=5 " + openedWindow;
    exec(command, (error, stdout, stderr) => {
        if (error){
            console.log(`error: ${error.message}`);
            output.append(error.message);
            return;
        }

        if (stderr){
            console.log(`stderr: ${stderr}`);
            output.append(stderr);
            return;
        }

        console.log(`stdout: ${stdout}`);
        output.append(stdout);
    });
}

export function OpenSimulator(ctx: vscode.ExtensionContext){
    output.clear();

    let openedWindow: string | undefined = vscode.window.activeTextEditor?.document.uri.fsPath;
    let extensionLocation: any = ctx.extensionUri.path;

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
        output.append("File isn't a .asm or .bin file? \n(Have you tried clicking on it to select it?)\n" + openedWindow);
        output.show();
        return;
    }

    let fileName = openedWindow?.slice(openedWindow?.lastIndexOf("\\")+1, openedWindow?.lastIndexOf("."));
    let objFile: any = openedWindow?.slice(0, openedWindow.lastIndexOf("\\")) + "\\" + fileName + ".obj";

    //let entireCommend = extensionLocation + executableFolder + " --print-level=5 " + openedWindow;
    let command = extensionLocation + executableFolder + "\\simulator.exe --log=sim.txt --print-level=8 " + objFile;
    console.log(command);
    
    let proc = spawn(command);
}