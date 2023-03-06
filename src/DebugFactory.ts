import * as vscode from 'vscode';
import {ProviderResult} from 'vscode';
import { lc3debugadapter } from './DebugAdapter';

//This Class is what allows the Debug Adapter to run inside of VSCode...
//These classes are also a waste of time, you're gonna tell me that creating a singular class just for this is good programming?!?!
//How bout just letting us design the descriptor in our own code with a function or something?
export class InlineAdapterFactory implements vscode.DebugAdapterDescriptorFactory{
	ext_ctx: vscode.ExtensionContext;
	ext_otc: vscode.OutputChannel;

	//The only reason these are here is because I need them for the debug adapter
	constructor(ctx: vscode.ExtensionContext, output: vscode.OutputChannel){
		this.ext_ctx = ctx;
		this.ext_otc = output;
	}

	createDebugAdapterDescriptor(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
		return new vscode.DebugAdapterInlineImplementation(new lc3debugadapter(this.ext_ctx, this.ext_otc));
	}
}