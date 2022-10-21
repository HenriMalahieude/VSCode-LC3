import * as vscode from 'vscode';
import { subscribeToDiagnostics } from './diagnostics';

const keywords: string[] = [
	'ADD', 'AND', 'NOT', 
	'BR', 'JMP', 'JSR', 'JSRR', 'RTI', 'TRAP', //Special case for BR
	'ST', 'STR', 'STI', 'LEA', 'LD', 'LDR', 'LDI',
];

const pseudo_ops: string[] = [
	'.ORIG', '.FILL', '.STRINGZ', '.END'
]

let diagnosticList: vscode.DiagnosticCollection;

export function activate(ctx: vscode.ExtensionContext): void {
	console.log('UCR\'s LC-3 Extension is now running');

	diagnosticList = vscode.languages.createDiagnosticCollection('lc3');
	ctx.subscriptions.push(diagnosticList);

	subscribeToDiagnostics(ctx, diagnosticList);
}

// This method is called when your extension is deactivated
export function deactivate() {}