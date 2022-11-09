import * as vscode from 'vscode';

/*async function importModule(moduleName: string):Promise<any>{
    console.log("importing ", moduleName);
    const importedModule = await import(moduleName);
    console.log("\timported ...");
    return importedModule;
}

let lc3;
if (process.platform == 'darwin'){
	lc3 = await importModule('lc3interface_MAC');
}else if (process.platform == 'win32'){
	lc3 = await importModule('lc3interface_WIN');
}else if (process.platform == 'linux'){
	lc3 = await importModule('lc3interface_LIN');
}*/

export function CreateUI(ctx: vscode.ExtensionContext){

}