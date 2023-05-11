import * as vscode from 'vscode';
import {InlineAdapterFactory} from './DebugFactory';

//This took me way too long to figure out how to get it to work
export function activateDebugging(ctx: vscode.ExtensionContext, otc: vscode.OutputChannel){
	//Activate the debugger to run inside of vscode
	ctx.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('lcsim', new InlineAdapterFactory(ctx, otc)));

	//TODO: Dynamic Debug Launcher thingy?

	vscode.commands.registerCommand('ucr-lc3.debug.getProgramName', config => {
		return vscode.window.showInputBox({
		  placeHolder: 'Please enter the name of an object file in the workspace folder',
		  value: './Folder/Program.asm or ./Program.asm'
		});
	  },
	  vscode.commands.registerCommand('ucr-lc3.debug.toggleFormatting', (variable) => {
		const ds = vscode.debug.activeDebugSession;
		if (ds) {
			ds.customRequest('toggleFormatting');
		}
	}));
}