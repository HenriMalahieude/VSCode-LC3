import * as vscode from 'vscode';

async function importModule(moduleName: string):Promise<any>{
    console.log("Importing ", moduleName);
    const importedModule = await import(moduleName);
    console.log("\timported ...");
    return importedModule;
}

let lc3;
function setModule(mod: any){
    lc3 = mod;
}
function failedMod(plat: string){
    console.log("Failed to load " + plat + " version of interface!");
}
if (process.platform == 'darwin'){ //Not a big fan of promises
    importModule('lc3interface_MAC').then(setModule).catch(() => failedMod("Windows"));
}else if (process.platform == 'win32'){
    importModule('lc3interface_WIN').then(setModule).catch(() => failedMod("Windows"));
}else if (process.platform == 'linux'){
	importModule('lc3interface_LIN').then(setModule).catch(() => failedMod("Windows"));
}

export function CreateUI(ctx: vscode.ExtensionContext){
    vscode.window.createTreeView('lc3-tools-view', {treeDataProvider: new IconProvider()});
    vscode.window.registerTreeDataProvider('lc3-tools-view', new IconProvider());
}

export function AssembleCode(ctx: vscode.ExtensionContext){
    //this requires the lc3interface

    //lc3.assemble(fileName); //TODO: Determine open file
    //opens terminal if there is an issue
}

class IconProvider implements vscode.TreeDataProvider<vscode.TreeItem>{
    constructor(){}

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem{
        return element;
    }

    getChildren(element?: vscode.TreeItem | undefined): vscode.ProviderResult<vscode.TreeItem[]> {
        //TODO: I need to return two icons that can be clicked
        return;
    }
}

