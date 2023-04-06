import * as vscode from 'vscode';
import {ProviderResult} from 'vscode';
import { lc3DebugAdapter } from './DebugAdapter';

//This Class is what allows the Debug Adapter to run inside of VSCode...
//These classes are also a waste of time, you're gonna tell me that creating a singular class just for this is good programming?!?!
//How bout just letting us design the descriptor in our own code with a function or something?
export class InlineAdapterFactory implements vscode.DebugAdapterDescriptorFactory{
	extCtx: vscode.ExtensionContext;
	extOtc: vscode.OutputChannel;

	//The only reason these are here is because I need them for the debug adapter
	constructor(ctx: vscode.ExtensionContext, output: vscode.OutputChannel){
		this.extCtx = ctx;
		this.extOtc = output;
	}

	createDebugAdapterDescriptor(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
		return new vscode.DebugAdapterInlineImplementation(new lc3DebugAdapter(this.extCtx, this.extOtc));
	}
}