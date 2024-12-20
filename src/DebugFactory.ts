import * as vscode from 'vscode';
import {ProviderResult} from 'vscode';
import { LC3SimulatorAdapter } from './Simulator/DebugAdapter';
import { LC3GraderAdapter } from "./Grader/DebugAdapter"

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
		return new vscode.DebugAdapterInlineImplementation(new LC3SimulatorAdapter(this.extCtx, this.extOtc));
	}
}

export class GraderAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
	extCtx: vscode.ExtensionContext;
	extOtc: vscode.OutputChannel;

	constructor(ctx: vscode.ExtensionContext, output: vscode.OutputChannel){
		this.extCtx = ctx;
		this.extOtc = output;
	}

	createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		return new vscode.DebugAdapterInlineImplementation(new LC3GraderAdapter(this.extCtx, this.extOtc));
	}
}