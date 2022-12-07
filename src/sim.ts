import * as vscode from 'vscode';
import { exec, spawn } from 'child_process';

async function importModule(moduleName: string):Promise<any>{
    console.log("Importing", moduleName);
    const importedModule = await import(moduleName);
    console.log("\tImported!");
    return importedModule;
}

let executableFolder = "\\src\\lc3tools\\";
/*function setModule(mod: any){
    lc3 = mod;
}
function failedMod(plat: string){
    console.log("Failed to load " + plat + " version of interface!");
}
if (process.platform == 'darwin'){ //Not a big fan of promises
    importModule('lc3interface_MAC').then(setModule).catch(() => failedMod("Apple Arm"));
}else if (process.platform == 'win32'){
    importModule('lc3interface_WIN').then(setModule).catch(() => failedMod("Windows"));
}else if (process.platform == 'linux'){
	importModule('lc3interface_LIN').then(setModule).catch(() => failedMod("Linux"));
}*/

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
    console.log("OPEN!");
}