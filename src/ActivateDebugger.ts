import * as vscode from 'vscode'
import * as DAP from '@vscode/debugadapter'
import {InlineAdapterFactory} from './DebugFactory'

//This took me way too long to figure out how to get it to work
export function activateDebugging(ctx: vscode.ExtensionContext, otc: vscode.OutputChannel){
	//Activate the debugger to run inside of vscode
	ctx.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('lc3', new InlineAdapterFactory(ctx, otc)))
	
	ctx.subscriptions.push(vscode.commands.registerCommand('extension.mock-debug.runEditorContents', (resource: vscode.Uri) => {
			let targetResource = resource;
			if (!targetResource && vscode.window.activeTextEditor) {
				targetResource = vscode.window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				vscode.debug.startDebugging(undefined, {
					type: 'lc3',
					name: 'Run File',
					request: 'launch',
					program: targetResource.fsPath
				});
			}
		}),
		vscode.commands.registerCommand('extension.mock-debug.debugEditorContents', (resource: vscode.Uri) => {
			let targetResource = resource;
			if (!targetResource && vscode.window.activeTextEditor) {
				targetResource = vscode.window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				vscode.debug.startDebugging(undefined, {
					type: 'lc3',
					name: 'Debug File',
					request: 'launch',
					program: targetResource.fsPath,
				});
			}
		})
	)

	vscode.commands.registerCommand('ucr-lc3.debug.getProgramName', config => {
		return vscode.window.showInputBox({
		  placeHolder: 'Please enter the name of an object file in the workspace folder',
		  value: './Folder/Program.asm'
		});
	  });
}