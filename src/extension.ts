import * as vscode from 'vscode';
import { activateDebugging } from './ActivateDebugger';
import { subscribeToDiagnostics } from './diagnostics';

let diagnosticList: vscode.DiagnosticCollection;
let output: vscode.OutputChannel = vscode.window.createOutputChannel("LC3-Tools");

export function activate(ctx: vscode.ExtensionContext): void {
	console.log('UCR\'s LC-3 Extension is now running');

	diagnosticList = vscode.languages.createDiagnosticCollection('lc3');
	ctx.subscriptions.push(diagnosticList);
	subscribeToDiagnostics(ctx, diagnosticList);

	activateDebugging(ctx, output);
}

export function deactivate(ctx: vscode.ExtensionContext): void {
	//Nothing to deactivate
}