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

	const provider = new ConfigurationProvider();
	ctx.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('lcsim', provider));

	ctx.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('lcsim', {
		provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined): vscode.ProviderResult<vscode.DebugConfiguration[]> {
			return [
				{
					name: "LC3 Simulator (Dynamic)",
					request: "launch",
					type: "lcsim",
					program: "${workspaceFolder}/${command:ucr-lc3.debug.getProgramName}"
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

		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'LC3') {
				config.type = 'lcsim';
				config.name = 'LC3 Simulator (Dynamic)';
				config.request = 'launch';
				config.program = '${workspaceFolder}/${command:ucr-lc3.debug.getProgramName}';
			}
		}

		if (!config.program) {
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return undefined;	// abort launch
			});
		}

		return config;
	}
}