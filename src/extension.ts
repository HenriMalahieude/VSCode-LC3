import * as vscode from 'vscode';
import { subscribeToDiagnostics } from './diagnostics';
import {CreateUI} from './sim';

let diagnosticList: vscode.DiagnosticCollection;

export function activate(ctx: vscode.ExtensionContext): void {
	console.log('UCR\'s LC-3 Extension is now running');

	diagnosticList = vscode.languages.createDiagnosticCollection('lc3');
	ctx.subscriptions.push(diagnosticList);

	subscribeToDiagnostics(ctx, diagnosticList);
	CreateUI(ctx);
}

// This method is called when your extension is deactivated
export function deactivate() {}