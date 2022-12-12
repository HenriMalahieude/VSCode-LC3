import * as fs from 'fs';
import * as vscode from 'vscode';
import { exec } from 'child_process';
//const requireFunc = require('util').promisify(require('require-from-string'));
//const lc3interface = requireFunc(fs.readFileSync('lc3interface', 'utf8'));
const lc3interface = require("..\\local_modules\\lc3interface");

/*async function importModule(moduleName: string):Promise<any>{
    console.log("Importing", moduleName);
    const importedModule = await import(moduleName);
    console.log("\tImported!");
    return importedModule;
}*/

//TODO: Get separate things for windows, linux, and mac
let executableFolder = "\\src\\lc3tools_WIN\\"; //default

if (process.platform == 'darwin'){
    //TODO: MAC Version
    executableFolder = "\\src\\lc3tools_MAC";
}else if (process.platform == 'linux'){
	//TODO: Linux Version
    executableFolder = "\\src\\lc3tools_LIN";
}

export function AssembleCode(ctx: vscode.ExtensionContext){
    let openedWindow = vscode.window.activeTextEditor?.document.uri.fsPath;
    let extensionLocation: any = ctx.extensionUri.fsPath;

    if (openedWindow == undefined || extensionLocation == undefined){
        console.log("No file opened?");
        return;
    }else if (!openedWindow.endsWith(".asm")){
        console.log("File doesn't have proper extension?");
        return;
    }

    //let entireCommend = extensionLocation + executableFolder + " --print-level=5 " + openedWindow;
    let command  = extensionLocation + executableFolder + "\\assembler.exe --print-level=5 " + openedWindow;
    console.log(command);
    exec(command, (error, stdout, stderr) => {
        if (error){
            console.log(`error: ${error.message}`);
            return;
        }

        if (stderr){
            console.log(`stderr: ${stderr}`);
            return;
        }

        //TODO: Create a terminal
        //console.log(`stdout: ${stdout}`);
    });
}

export function OpenSimulator(ctx: vscode.ExtensionContext){
    console.log("TODO: Simulator");
}