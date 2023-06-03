//Refer to: https://github.com/microsoft/vscode-mock-debug

import * as vscode from 'vscode';
import * as DAP from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol/lib/debugProtocol";
import { LC3Simulator, Result, emptyLC3Data } from "./Simulator";
import * as path from "path";

interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the "program" to debug. */
	program: string;
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

	private maxMemoryView: number = 16;
	private maxStackView: number = 8;

	private _addressesInHex = true;
	private _valuesInHex = true;

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
		//response.body.supportsBreakpointLocationsRequest = true;
		response.body.supportsSetVariable = true;
		this.sendResponse(response);

		this.sendEvent(new DAP.InitializedEvent());
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

			this.outputChannel.clear();
			this._debugger = new LC3Simulator(td);

			this._debugger.on("warning", (rr:Result) => {
				//console.log("Received warning");
				this.outputChannel.show();
				this.outputChannel.appendLine(this.formatResult(rr));
			})

			this._debugger.on("stdin", () => {
				this.stdoutUpdate(); //If the sim is running, we update the output to make it clear when you want intput
				vscode.window.showInputBox({
					title: 'LC3-Simulator Input Request',
					placeHolder: '',//Hello, World!
					prompt: 'Single char \'a\' or full string \'Hello, World!\'',
					value: '',
					ignoreFocusOut: true,
				}).then((item: string | undefined) => {
					if (item != undefined){
						if (this._debugger){
							for (let i = 0; i < item.length; i++){
								this._debugger.addNextStdIn(item.charCodeAt(i));
								this._debugger.emit("stdin update");
							}
						}
						this.stdoutUpdate(); //Update the output, though this may be too fast, not sure though
					}else{
						if (this._debugger) this._debugger.emit("stdin"); //We don't want them running away
					}
				});
			})

			this._debugger.InitializeSimulator();

			if (this._debugger.status.success === false){
				response.success = false;
				this.sendFormattedErrorMessage(response, this._debugger.status);

				this._debugger = undefined;
				return;
			}

			//Since this simulator automatically stops on start
			this.stopEvent("launch");
		} catch (e) {
			return this.sendErrorResponse(response, {
				id: 1201,
				format: "Could not read from file provided. Must be in './Folder/Program.asm' or './Program.asm' format.\n(Error: " + e + ")",
				showUser: true
			});
		}
		this.sendResponse(response);
	}

	protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {
		if (this._debugger == undefined) return;

		if (args.breakpoints != undefined){
			const locations = args.breakpoints;

			this._debugger.clearBreakpoints();

			//Apparently we have to add it for the forward response
			response.body = {
				breakpoints: []
			}

			for (let bpi = 0; bpi < locations.length; bpi++) {
				let bp = locations[bpi];
				if (bp){
					this._debugger.addBreakpoint(bp.line);
					response.body.breakpoints.push({verified: (args.sourceModified == undefined) ? true : !args.sourceModified, line: bp.line, id: bp.line});
				}
			}
		}

		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments, request?: DebugProtocol.Request | undefined): void {
		let lin: number = 0;
		let txt: string = "";
		let sourceFile: DAP.Source = new DAP.Source("File");

		if (this._debugger && this._debugger.file){

			//Next Instruction Info
			if (args.threadId == 1){
				lin = this._debugger.getCurrentLine();
				txt = this._debugger.getCurrentInstruction(1);

				sourceFile.name = path.basename(this._debugger.file.uri.fsPath);
				sourceFile.path = this._debugger.file.uri.fsPath;

				txt = txt.trim();
			
				response.body = {
					stackFrames: [{id: 0, name: txt, line: lin+1, column: 1, source: sourceFile}],
					totalFrames: 1,
				};
			}
		}

		//this.sendResponse(LC3StackResponse);
		this.sendResponse(response);
	}

	protected cancelRequest(response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments, request?: DebugProtocol.Request | undefined): void {
		this.sendResponse(response);
	}

	protected terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments, request?: DebugProtocol.Request | undefined): void {
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		// runtime supports no threads so just return a default thread.
		response.body = {
			threads: [
				new DAP.Thread(lc3DebugAdapter.threadID, "Next Instruction")
			]
		};
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request): Promise<void> {
		//TODO: Searching memory
		if (this._debugger){
			if (request && request.arguments) {	
				if (request.arguments.variablesReference == 1){
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
							{name: "PC", type: "integer", value: this.formatNumber(this._debugger.pc+1), variablesReference: 0},
							{name: "PSR", type: "integer", value: this.formatNumber(this._debugger.psr), variablesReference: 0},
							{name: "MCR", type: "integer", value: this.formatNumber(this._debugger.mcr), variablesReference: 0},
						]
					};
				}else if (request.arguments.variablesReference == 2){
					let vArr = [];

					let curProgramCount = this._debugger.pc + 1;
					let memoryHead = curProgramCount - (curProgramCount % 16);

					for (let i = 0; i < this.maxMemoryView; i++){
						let contents = this._debugger.memory.get(memoryHead + i);
						
						let stringMachine: string;
						if (contents == undefined) {
							contents = emptyLC3Data();
							stringMachine = contents.assembly + " (0x?)";
						}else{
							stringMachine = contents.assembly + " (" + this.formatNumber(contents.machine) + ")";
						}
						
						vArr.push({name: this.formatAddress(memoryHead + i), type: "string", value: stringMachine, variablesReference: 0});
					}

					response.body = {
						variables: []
					}

					response.body.variables = vArr;
				}else{
					const STACK_END = 0xFE00 - 1;
					let whereStackEnds = STACK_END;
					for (let i = 0; i < 200; i++) { //Find where the stack ends
						if (this._debugger.memory.get(STACK_END + i) == undefined){
							whereStackEnds += i;
							break;
						}
					}

					let whereStackBegins = (whereStackEnds - this.maxStackView) >= STACK_END ? (whereStackEnds - this.maxStackView) : STACK_END;

					response.body = {variables: []}
					for (let i = whereStackBegins; i <= whereStackEnds; i++){
						let data = this._debugger.memory.get(i);
						if (data == undefined) data = emptyLC3Data();
						
						response.body.variables.push({type: "string", name: (this.formatAddress(i) + " (" + String(i - whereStackBegins) + ")"), value: this.formatNumber(data.machine), variablesReference: 0});
					}
				}
			}
		}
		this.sendResponse(response);
	}

	protected setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): void {
		if (this._debugger == undefined) return;

		if (args.name.startsWith("R")){ //Edit Register
			let n = Number(args.name.at(1));
			let v = Number(args.value);
			if (!Number.isNaN(n) && !Number.isNaN(v)){
				this._debugger.registers[n] = v;
				response.body = {value: this.formatNumber(v)}
			}
			
		}else if (args.name == "PSR" || args.name == "MCR"){ //System Set Registers
			return this.sendErrorResponse(response, {
				id: 1203,
				format: "PSR and MCR are system set registers not open for editing.",
				showUser: true
			});
		}else if (args.name == "PC"){
			let v = Number(args.value)
			if (!Number.isNaN(v)){
				let location = this._debugger.memory.get(v);
				if (location){
					this._debugger.pc = v-1;
					this._debugger.currentLine = location.location.fileIndex-1;
					response.body = {value: this.formatNumber(v)};
					this.sendEvent(new DAP.InvalidatedEvent(undefined, lc3DebugAdapter.threadID, 0));
				}
			}
		}else if (args.name.startsWith("0x") || args.name.startsWith("#")){ //Edit memory
			let address = Number(args.name);
			let v = Number(args.value);
			if (!Number.isNaN(address) && !Number.isNaN(v)){
				let m = this._debugger.memory.get(address);
				if (m){
					m.machine = v;
					this._debugger.memory.set(address, m);
					response.body = {value: m.assembly + " (" + this.formatNumber(v) + ")"}
				}
			}
		}else{
			return this.sendErrorResponse(response, {
				id: 1204,
				format: "Editing this 'variable' unavailable.",
				showUser: true
			})
		}

		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments, request?: DebugProtocol.Request | undefined): void {
		
		response.body = {
			scopes: [
				{name: "Registers", variablesReference: 1, expensive: false},
				{name: "Memory", variablesReference: 2, expensive: true},
				{name: "Stack", variablesReference: 3, expensive: true}
			]
		};
		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		if (this._debugger){
			this._debugger.run().then((info: Result) => {
				if (info.success == false){
					response.success = false;
					if (this._debugger) return this.sendFormattedErrorMessage(response, this._debugger.status);
				}
				this.stopEvent("end");
				this.stdoutUpdate();
			});
		}
		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		if (this._debugger){
			this._debugger.stepOver(true, undefined).then((info: Result) => {
				if (info.success == false){
					response.success = false;
					if (this._debugger) return this.sendFormattedErrorMessage(response, this._debugger.status);
				}
				this.stopEvent("step over");
				this.stdoutUpdate();
			});
		}
		this.sendResponse(response);
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		if (this._debugger){
			this._debugger.stepIn(true).then((info: Result) => {
				if (info.success == false){
					response.success = false;
					if (this._debugger) return this.sendFormattedErrorMessage(response, this._debugger.status);
				}
				this.stopEvent("step in");
				this.stdoutUpdate();
			});
		}
		this.sendResponse(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments, request?: DebugProtocol.Request | undefined): void {
		if (this._debugger){
			this._debugger.stepOut(true).then((info: Result) => {
				if (info.success == false){
					response.success = false;
					if (this._debugger) return this.sendFormattedErrorMessage(response, this._debugger.status);
				}
				this.stopEvent("step out");
				this.stdoutUpdate();
			});
		}
		this.sendResponse(response);
	}

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
		return this._addressesInHex ? ('0x' + x.toString(16)) : ("#" + x.toString(10));
	}

	private formatNumber(x: number) {
		if (this._valuesInHex){
			let nn = x;
			if (nn < 0){
				nn = 0xFFFF + x + 1; //Since it's negative we don't want 0x-5, we want 0xFFFB;
			}
			return ('0x' + nn.toString(16).toLocaleUpperCase());
		}

		return x.toString(10);
	}

	private sendFormattedErrorMessage(response: DebugProtocol.Response, status: Result){
		if (!this._debugger) return;

		let info = this.formatResult(status);
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
		return `\n(Line ${res.line}) ${res.context}: ${res.message}`;
	}

	private stopEvent(ni: string){
		this.sendEvent(new DAP.StoppedEvent(ni, lc3DebugAdapter.threadID)) //NOTE: These events require a ThreadId, or it will hitch forever
	}

	private stdoutUpdate(){
		if (this._debugger){
			let v = this._debugger.getNextStdOut();
			while (v != undefined){
				//console.log("Stdout: ", v);
				this.outputChannel.show();
				if (v >= 31 && v <= 127){
					this.outputChannel.append(String.fromCharCode(v));
				}else if (v >= 127){
					this.outputChannel.append("[?]");
				}
				
				v = this._debugger.getNextStdOut();
			}
		}
	}
}