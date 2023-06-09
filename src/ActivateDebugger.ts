import * as path from 'path';
import * as vscode from 'vscode';
import {InlineAdapterFactory} from './DebugFactory';

//This took me way too long to figure out how to get it to work
export function activateDebugging(ctx: vscode.ExtensionContext, otc: vscode.OutputChannel){
	//Activate the debugger to run inside of vscode, basically give VSCode a method of spawning the debugger
	ctx.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('lc3sim', new InlineAdapterFactory(ctx, otc)));

	vscode.commands.registerCommand('ucr-lc3.debug.getProgramName', config => {
		return vscode.window.showInputBox({
			placeHolder: 'Please enter the name of an object file in the workspace folder',
			value: './Folder/Program.asm or ./Program.asm'
		});
	}),

	vscode.commands.registerCommand('ucr-lc3.debug.getProgramNameInference', config => {
		let v = vscode.window.activeTextEditor;
		let ret: string | undefined = (v) ? vscode.workspace.asRelativePath(v.document.uri, false) : undefined;

		if (v == undefined){
			console.log("Bruh")
			return vscode.window.showInputBox({
				placeHolder: 'Please enter the name of an object file in the workspace folder',
				value: './Folder/Program.asm or ./Program.asm'
			});
		}
		
		return ret
	}),

	vscode.commands.registerCommand('ucr-lc3.debug.toggleFormatting', (variable) => {
		const ds = vscode.debug.activeDebugSession;
		if (ds) {
			ds.customRequest('toggleFormatting');
		}
	});

	const provider = new ConfigurationProvider();
	ctx.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('lc3sim', provider));

	ctx.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('lc3sim', {
		provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined): vscode.ProviderResult<vscode.DebugConfiguration[]> {
			return [
				{
					name: "LC3 Simulator (Dynamic)",
					request: "launch",
					type: "lc3sim",
					program: "${workspaceFolder}/${command:ucr-lc3.debug.getProgramNameInference}"
				},
			];
		}
	}, vscode.DebugConfigurationProviderTriggerKind.Dynamic));
}

//Copy Pasted from Mock Debugger from VS
class ConfigurationProvider implements vscode.DebugConfigurationProvider {

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'LC3') {
				config.type = 'lc3sim';
				config.name = 'LC3 Simulator (Dynamic)';
				config.request = 'launch';
				config.program = '${workspaceFolder}/${command:ucr-lc3.debug.getProgramName}';
			}
		}

		if (!config.program) {
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return undefined;	// abort launch
			});
		} //*/

		return config;
	}
}