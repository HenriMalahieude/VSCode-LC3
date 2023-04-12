//Refer to: https://github.com/microsoft/vscode-mock-debug

import * as vscode from 'vscode';
import * as DAP from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol/lib/debugProtocol";
import { LC3Simulator, Result } from "./Simulator";
import * as path from "path";

interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the "program" to debug. */
	program: string;
	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
}

function pathToUri(path: string) {
	try {
		return vscode.Uri.file(path);
	} catch (e) {
		return vscode.Uri.parse(path);
	}
}

export class lc3DebugAdapter extends DAP.DebugSession{
	private static threadID = 1;

	private _debugger: LC3Simulator | undefined;
	private outputChannel: vscode.OutputChannel;

	private _addressesInHex = true;
	private _valuesInHex = true;
	//private outputChannel: vscode.OutputChannel; //NOTE: I hope this is a reference variable.

	constructor(ctx: vscode.ExtensionContext, otc: vscode.OutputChannel){
		super();

		this.setDebuggerColumnsStartAt1(false);
		this.setDebuggerLinesStartAt1(true);
		this.outputChannel = otc;
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		//Notify front-end of capabilities of this debugger
		response.body = response.body || {};

		//NOTE: Later we can implement "step back" functionality
		this.sendResponse(response);

		//this.sendEvent(new DAP.InitializedEvent());
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request): void {
		console.log(`disconnectRequest suspend: ${args.suspendDebuggee}, terminate: ${args.terminateDebuggee}`);
		this._debugger = undefined;
		
		this.sendResponse(response);
	}

	protected async attachRequest(response: DebugProtocol.AttachResponse, args: ILaunchRequestArguments) {
		return this.launchRequest(response, args);
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: ILaunchRequestArguments) {
		// Run the debugger
		try{
			let td: vscode.TextDocument = await vscode.workspace.openTextDocument(pathToUri(args.program));

			vscode.window.showTextDocument(td); //Focus this Text Document

			this._debugger = new LC3Simulator(td);
			//Insert Compile/Preprocess error here
			if (this._debugger.status.success === false){
				response.success = false;
				this.sendFormattedErrorMessage(response, this._debugger.status);

				this._debugger = undefined;
				return;
			}

			this._debugger.on("warning", (rr:Result) => {
				this.outputChannel.show();
				this.outputChannel.appendLine(this.formatResult(rr));
			})

			//Since this simulator automatically stops on start
			this.sendEvent(new DAP.StoppedEvent("entry", lc3DebugAdapter.threadID));
		} catch (e) {

			return this.sendErrorResponse(response, {
				id: 1201,
				format: "Could not read from file provided. Must be in './Folder/Program.asm' or './Program.asm' format.",
				showUser: true
			});
		}
		this.sendResponse(response);
	}

	protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {

		/*const path = args.source.path as string;
		const clientLines = args.lines || [];

		// clear all breakpoints for this file
		this._runtime.clearBreakpoints(path);

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

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments, request?: DebugProtocol.Request | undefined): void {
		let lin: number = 0;
		let txt: string = "";
		let sourceFile: DAP.Source = new DAP.Source("File");
		if (this._debugger){
			lin = this._debugger.getCurrentLine();
			txt = this._debugger.getCurrentInstruction();

			sourceFile.name = path.basename(this._debugger.file.uri.fsPath);
			sourceFile.path = this._debugger.file.uri.fsPath;
		}

		txt = txt.trim();
		
		if (args.threadId === lc3DebugAdapter.threadID){
			response.body = {
				stackFrames: [{id: 0, name: txt, line: lin+1, column: 1, source: sourceFile}],
				totalFrames: 1,
			};
		}else{
			console.log("Attempted to get Stack stackTrace");
		}
		
		this.sendResponse(response);
	}

	protected cancelRequest(response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments, request?: DebugProtocol.Request | undefined): void {
		this.sendResponse(response);
	}

	protected terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments, request?: DebugProtocol.Request | undefined): void {
		this.sendResponse(response);
	}

	protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {

		// runtime supports no threads so just return a default thread.
		response.body = {
			threads: [
				new DAP.Thread(lc3DebugAdapter.threadID, "Current Instruction"),
				new DAP.Thread(lc3DebugAdapter.threadID + 1, "Stack")
			]
		};
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request): Promise<void> {
		if (this._debugger){
			//console.log(this._debugger.registers)
			response.body = {
				variables: [
					{name: "R0", type: "integer", value: this.formatNumber(this._debugger.registers[0]), variablesReference: 0},
					{name: "R1", type: "integer", value: this.formatNumber(this._debugger.registers[1]), variablesReference: 0},
					{name: "R2", type: "integer", value: this.formatNumber(this._debugger.registers[2]), variablesReference: 0},
					{name: "R3", type: "integer", value: this.formatNumber(this._debugger.registers[3]), variablesReference: 0},
					{name: "R4", type: "integer", value: this.formatNumber(this._debugger.registers[4]), variablesReference: 0},
					{name: "R5", type: "integer", value: this.formatNumber(this._debugger.registers[5]), variablesReference: 0},
					{name: "R6", type: "integer", value: this.formatNumber(this._debugger.registers[6]), variablesReference: 0},
					{name: "R7", type: "integer", value: this.formatNumber(this._debugger.registers[7]), variablesReference: 0},
					{name: "PC", type: "integer", value: this.formatNumber(this._debugger.pc), variablesReference: 0},
					{name: "PSR", type: "integer", value: this.formatNumber(this._debugger.psr), variablesReference: 0},
					{name: "MCR", type: "integer", value: this.formatNumber(this._debugger.mcr), variablesReference: 0},
				]
			};
		}
		this.sendResponse(response);
	}
	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments, request?: DebugProtocol.Request | undefined): void {
		
		response.body = {
			scopes: [
				{name: "Registers", variablesReference: 1, expensive: false},
				{name: "Memory", variablesReference: 2, expensive: true}
			]
		};
		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		if (this._debugger){
			let info: Result = this._debugger.run();
			if (info.success === false){
				response.success = false;
				return this.sendFormattedErrorMessage(response, this._debugger.status);
			}
		}
		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		if (this._debugger){
			let info: Result = this._debugger.stepOver(true);
			console.log(info)
			if (info.success === false){
				response.success = false;
				return this.sendFormattedErrorMessage(response, this._debugger.status);
			}
			this.sendEvent(new DAP.StoppedEvent("next", lc3DebugAdapter.threadID))
		}
		this.sendResponse(response);
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		if (this._debugger){
			let info: Result = this._debugger.stepIn(true);
			if (info.success === false){
				response.success = false;
				return this.sendFormattedErrorMessage(response, this._debugger.status);
			}
			this.sendEvent(new DAP.StoppedEvent("step in", lc3DebugAdapter.threadID))
		}
		this.sendResponse(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments, request?: DebugProtocol.Request | undefined): void {
		if (this._debugger){
			let info: Result = this._debugger.stepOut(true);
			if (info.success == false){
				response.success = false;
				return this.sendFormattedErrorMessage(response, this._debugger.status);
			}
			this.sendEvent(new DAP.StoppedEvent("step out", lc3DebugAdapter.threadID))
		}
		this.sendResponse(response);
	}

	//TODO: Formatting Request
	protected customRequest(command: string, response: DebugProtocol.Response, args: any) {
		if (command == 'toggleFormatting') {
			this._valuesInHex =! this._valuesInHex;
			this.sendResponse(response);
		} else {
			super.customRequest(command, response, args);
		}
	}

	//----------Helper Functions
	private formatAddress(x: number, pad = 8) {
		return this._addressesInHex ? '0x' + x.toString(16) : x.toString(10);
	}

	private formatNumber(x: number) {
		if (this._valuesInHex){
			let nn = x;
			if (nn < 0){
				nn += 16 * 16 * 16 * 16; //Since it's negative we don't want 0x-5, we want 0xFFFB;
			}
			return '0x' + nn.toString(16)
		}

		return x.toString(10);
	}

	private sendFormattedErrorMessage(response: DebugProtocol.Response, status: Result){
		if (!this._debugger) return;

		let info = this.formatResult(status);

		this.outputChannel.clear();
		this.outputChannel.show();
		this.outputChannel.appendLine(info);

		this._debugger = undefined
		return this.sendErrorResponse(response, {
			id: 1202,
			format: info,
			showUser: true
		})
	}

	private formatResult(res: Result): string {
		return `(Line ${res.line}) ${res.context}: ${res.message}`;
	}
}