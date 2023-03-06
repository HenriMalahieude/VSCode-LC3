//Refer to: https://github.com/microsoft/vscode-mock-debug

import * as vscode from 'vscode';
import * as DAP from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol/lib/debugProtocol";
import { LC3Simulator, Result } from "./Simulator";
import path from 'path';
import { Message } from '@vscode/debugadapter/lib/messages';

interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the "program" to debug. */
	program: string;
	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
}

interface IAttachRequestArguments extends ILaunchRequestArguments { }

export class lc3debugadapter extends DAP.LoggingDebugSession{
	private static threadID = 1;

	private _debugger: LC3Simulator | undefined;
	private outputChannel: vscode.OutputChannel; //NOTE: I hope this is a reference variable.

	constructor(ctx: vscode.ExtensionContext, otc: vscode.OutputChannel){
		super();

		this.outputChannel = otc;
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		//Notify front-end of capabilities of this debugger
		response.body = response.body || {};

		//response.body.supportsConfigurationDoneRequest = false;

		//NOTE: Later we can implement "step back" functionality

		this.sendResponse(response);

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		//this.sendEvent(new DAP.InitializedEvent());
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): void {
		console.log(`disconnectRequest suspend: ${args.suspendDebuggee}, terminate: ${args.terminateDebuggee}`);
		this._debugger = undefined;
	}

	protected async attachRequest(response: DebugProtocol.AttachResponse, args: IAttachRequestArguments) {
		return this.launchRequest(response, args);
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: ILaunchRequestArguments) {
		// Run the debugger
		let f: vscode.Uri[] = await vscode.workspace.findFiles(args.program);
	
		if (f.length > 0){
			let td: vscode.TextDocument = await vscode.workspace.openTextDocument(f[0]);

			this._debugger = new LC3Simulator(td);
		} else {
			this.sendErrorResponse(response, {
				id: 1001,
				format: "Could not read from file provided",
				showUser: true
			});
		}
		
		this.sendResponse(response);
	}

	protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {

		const path = args.source.path as string;
		const clientLines = args.lines || [];

		// clear all breakpoints for this file
		/*this._runtime.clearBreakpoints(path);

		// set and verify breakpoint locations
		const actualBreakpoints0 = clientLines.map(async l => {
			const { verified, line, id } = await this._runtime.setBreakPoint(path, this.convertClientLineToDebugger(l));
			const bp = new DAP.Breakpoint(verified, this.convertDebuggerLineToClient(line)) as DebugProtocol.Breakpoint;
			bp.id = id;
			return bp;
		});
		const actualBreakpoints = await Promise.all<DebugProtocol.Breakpoint>(actualBreakpoints0);

		// send back the actual breakpoint positions
		response.body = {
			breakpoints: actualBreakpoints
		};*/
		this.sendResponse(response);
	}

	protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request): void {
		/*if (args.source.path) {
			const bps = this._runtime.getBreakpoints(args.source.path, this.convertClientLineToDebugger(args.line));
			response.body = {
				breakpoints: bps.map(col => {
					return {
						line: args.line,
						column: this.convertDebuggerColumnToClient(col)
					};
				})
			};
		} else {
			response.body = {
				breakpoints: []
			};
		}
		this.sendResponse(response);*/
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {

		// runtime supports no threads so just return a default thread.
		response.body = {
			threads: [
				new DAP.Thread(lc3debugadapter.threadID, "thread 1"),
			]
		};
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request): Promise<void> {
		
		
		/*
		let vs: RuntimeVariable[] = [];

		const v = this._variableHandles.get(args.variablesReference);
		if (v === 'locals') {
			vs = this._runtime.getLocalVariables();
		} else if (v === 'globals') {
			if (request) {
				this._cancellationTokens.set(request.seq, false);
				vs = await this._runtime.getGlobalVariables(() => !!this._cancellationTokens.get(request.seq));
				this._cancellationTokens.delete(request.seq);
			} else {
				vs = await this._runtime.getGlobalVariables();
			}
		} else if (v && Array.isArray(v.value)) {
			vs = v.value;
		}

		response.body = {
			variables: vs.map(v => this.convertFromRuntime(v))
		};
		this.sendResponse(response);*/
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		if (this._debugger){
			let info: Result = this._debugger.run();
			if (info.success = false){
				//TODO: Edit Response;
			}
		}
		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		if (this._debugger){
			let info: Result = this._debugger.stepOver(true);
			if (info.success = false){
				//TODO: Edit Response;
			}
		}
		this.sendResponse(response);
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		if (this._debugger){
			let info: Result = this._debugger.stepIn(true);
			if (info.success = false){
				//TODO: Edit Response;
			}
		}
		this.sendResponse(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments, request?: DebugProtocol.Request | undefined): void {
		if (this._debugger){
			let info: Result = this._debugger.stepOut(true);
			if (info.success = false){
				//TODO: Edit Response;
			}
		}
		this.sendResponse(response);
	}

	protected customRequest(command: string, response: DebugProtocol.Response, args: any) {
		/*if (command === 'toggleFormatting') {
			this._valuesInHex = ! this._valuesInHex;
			if (this._useInvalidatedEvent) {
				this.sendEvent(new DAP.InvalidatedEvent( ['variables'] ));
			}
			this.sendResponse(response);
		} else {
			super.customRequest(command, response, args);
		}*/
	}

	/*public chooseFile(){
		let filePath: string | undefined;
		let root = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
		
		if (root){
			let standard: string | undefined = undefined;
			if (vscode.window.activeTextEditor){
				standard = path.relative(root.uri.fsPath, vscode.window.activeTextEditor.document.uri.fsPath);
			}
			
			vscode.window.showInputBox({
				placeHolder: "File in " + root.name + " folder",
				prompt: "File Path from "+ root.name +" to Simulate (ex: './file.asm')",
				value: standard
			}).then((receive: string | undefined) => {
				filePath = receive ? receive : standard;
				
				if (filePath){
					vscode.workspace.findFiles(filePath).then((docs: vscode.Uri[]) => {

					});	
				}
			})
		}
	}*/
}