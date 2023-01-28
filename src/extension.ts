import * as vscode from 'vscode';
import { subscribeToDiagnostics } from './diagnostics';
import { OpenSimulator, AssembleCode, CloseSimulator } from './sim';

let diagnosticList: vscode.DiagnosticCollection;

export function activate(ctx: vscode.ExtensionContext): void {
	console.log('UCR\'s LC-3 Extension is now running');

	diagnosticList = vscode.languages.createDiagnosticCollection('lc3');
	ctx.subscriptions.push(diagnosticList);

	subscribeToDiagnostics(ctx, diagnosticList);
	
	ctx.subscriptions.push(vscode.commands.registerCommand("ucr-lc3.OpenSimulator", () =>{OpenSimulator(ctx)}));
	ctx.subscriptions.push(vscode.commands.registerCommand("ucr-lc3.AssembleCode", () =>{AssembleCode(ctx)}));
	ctx.subscriptions.push(vscode.commands.registerCommand("ucr-lc3.CloseSimulator", () => {CloseSimulator(ctx)}));

	vscode.commands.registerCommand('ucr-lc3.debug.getProgramName', config => {
		return vscode.window.showInputBox({
		  placeHolder: 'Please enter the name of an object file in the workspace folder',
		  value: 'Program.obj'
		});
	  });
}

// This method is called when your extension is deactivated
export function deactivate(ctx: vscode.ExtensionContext): void {
	CloseSimulator(ctx);
}