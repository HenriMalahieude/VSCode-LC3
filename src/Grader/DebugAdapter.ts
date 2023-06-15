import { DebugProtocol } from "@vscode/debugprotocol/lib/debugProtocol";
import * as DAP from "@vscode/debugadapter";
import * as vscode from 'vscode';
import {Optional, CLIInterface} from './GraderInterface'

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

//TODO: All of the unfinished functions inside
export class LC3GraderAdapter extends DAP.DebugSession {
	private outputChannel: vscode.OutputChannel;
	private grader: CLIInterface;

	private valuesInHex: boolean = true;
	private memoryCount: number = 16;

	private memoryHead: number = -1;

	constructor(ctx: vscode.ExtensionContext, otc: vscode.OutputChannel){
		super();

		this.outputChannel = otc;
		this.grader = new CLIInterface(ctx, otc);

		this.setDebuggerColumnsStartAt1(false);
		this.setDebuggerLinesStartAt1(false);
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments) {
		//Notify front-end of capabilities of this debugger
		response.body = response.body || {};
		response.body.supportsSetVariable = true;
		this.sendResponse(response);

		this.sendEvent(new DAP.InitializedEvent());
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments) {
		this.grader.CloseDebuggerCLI();
	}

	protected attachRequest(response: DebugProtocol.AttachResponse, args: ILaunchRequestArguments) {
		this.launchRequest(response, args);
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: ILaunchRequestArguments) {
		try {
			let td: vscode.TextDocument = await vscode.workspace.openTextDocument(pathToUri(args.program));
			vscode.window.showTextDocument(td); //Focus this Text Document

			let compilationSuccess = await this.grader.Compile(td);

			if (compilationSuccess){
				let succ: boolean = await this.grader.LaunchDebuggerCLI(td);

				if (!succ) return this.graderError(response, "Could not launch the CLI?");

				
				this.sendEvent(new DAP.StoppedEvent("launch", 1))
			}else{
				this.graderError(response, "Could not compile?");
			}
		}catch (e){
			console.log(e)
			return;
		}
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {} //TODO
	
	//NOTE: This is required to be able to test...
	protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments | undefined) {
		let promise_stack = await this.grader.StackTraceRequest();
		if (promise_stack.value == undefined || promise_stack.message != undefined) {
			this.graderError(response, (promise_stack.message) ? promise_stack.message : "Default Launch Error?");
		}

		let stack = (promise_stack.value) ? promise_stack.value : ["Error Getting Stack Trace"];

		response.body = {
			stackFrames: []
		}

		for (let i = 0; i < stack.length; i++){
			response.body.stackFrames.push({id: i, name: stack[i], line: 0, column: 0, presentationHint: 'subtle'});
		}

		response.body.totalFrames = stack.length;

		this.sendResponse(response);
	}

	protected cancelRequest(response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments | undefined) {}

	protected terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments | undefined): void {
		this.grader.CloseDebuggerCLI();
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		// runtime supports no threads so just return a default thread.
		response.body = {
			threads: [
				new DAP.Thread(1, "Location")
			]
		};

		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments | undefined) {
		response.body = {
			scopes: [
				{name: "Registers", variablesReference: 1, expensive: true},
				{name: "Memory", variablesReference: 2, expensive: true},
			]
		};
		
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments) {
		console.log("Update Variables " + args.variablesReference.toString())
		let registers = await this.grader.GetRegisters();
		if (registers.value == undefined || registers.message != undefined){
			return this.graderError(response, registers.message ? registers.message : "Register Get Default Error?");
		}
		
		if (args.variablesReference == 1) { //Registers section
			response.body = {
				variables: [
					{type: "string", name: "R0", value: this.formatNumber(registers.value[0]), variablesReference: 0},
					{type: "string", name: "R1", value: this.formatNumber(registers.value[1]), variablesReference: 0},
					{type: "string", name: "R2", value: this.formatNumber(registers.value[2]), variablesReference: 0},
					{type: "string", name: "R3", value: this.formatNumber(registers.value[3]), variablesReference: 0},
					{type: "string", name: "R4", value: this.formatNumber(registers.value[4]), variablesReference: 0},
					{type: "string", name: "R5", value: this.formatNumber(registers.value[5]), variablesReference: 0},
					{type: "string", name: "R6", value: this.formatNumber(registers.value[6]), variablesReference: 0},
					{type: "string", name: "R7", value: this.formatNumber(registers.value[7]), variablesReference: 0},
					{type: "string", name: "PC", value: this.formatNumber(registers.value[8]), variablesReference: 0},
					{type: "string", name: "PSR", value: this.formatNumber(registers.value[9]), variablesReference: 0},
					{type: "string", name: "MCR", value: this.formatNumber(registers.value[10]), variablesReference: 0},
				]
			}
		}else if (args.variablesReference == 2){ //Memory Section
			response.body = {
				variables: []
			}

			let memoryTop = registers.value[8];
			let start = "(PC) 0x"
			if (this.memoryHead != -1){
				memoryTop = this.memoryHead;
				start = "0x";
			}

			console.log(memoryTop)

			response.body.variables.push({type: "string", name: "Memory Start", value: start + memoryTop.toString(16), variablesReference: 0});
			
			let range = await this.grader.GetMemoryRange(memoryTop, this.memoryCount);
			if (range.message != undefined || range.value == undefined) return this.graderError(response, range.message ? range.message : "Memory Get Default Error?");

			for (let i = 0; i < this.memoryCount; i++){
				let v = range.value.get(memoryTop+i);
				let vv: string = v ? v : "?";

				response.body.variables.push({type: "string", name: "0x"+(memoryTop + i).toString(16), value: vv, variablesReference: 0});
			}
		}

		this.sendResponse(response);
	}

	protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments) {
		if (args.name.startsWith("R")){
			let val = Number(args.value);
			if (!Number.isNaN(val)){
				let succ = await this.grader.SetRegisters(Number(args.name.substring(1,2)), val);

				if (!succ){
					return this.graderError(response, "Couldn't set register value. Is Debugger running?");
				}

				response.body = {value: this.formatNumber(val)};
			}
		}else if (args.name == "PC" || args.name == "PSR" || args.name == "MCR"){
			return this.graderError(response, "Cannot Edit System Reserved Registers");
		}else if (args.name.startsWith("0x")){
			return this.graderError(response, "Editing Memory is not Supported in Grader Mode"); //Can be changed, but we want the students using the simulator
		}else if (args.name == "Memory Start"){
			let location = Number(args.value);
			console.log(location)
			if (!Number.isNaN(location)){
				if (location > 0xFFFF || location < 0){
					this.memoryHead = -1;

					let register = await this.grader.GetRegisters();
					if (register.message != undefined || register.value == undefined) return this.graderError(response, "Couldn't get registers?");

					response.body = {value: "(PC) 0x" + register.value[8].toString(16)};
				}else{
					response.body = {value: "0x"+location.toString(16)};

					if (this.memoryHead == -1){ //Only send this message once
						this.outputChannel.appendLine("To return to Auto Memory View, edit \"Memory Start\" variable to -1");
					}

					this.memoryHead = location;
				}

				this.sendEvent(new DAP.StoppedEvent("memory update", 1)); //This is so it updates the memory
			}
		}

		this.sendResponse(response);
	}

	protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments) {} //TODO

	protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments) {} //TODO

	protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments) {} //TODO

	protected async stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments | undefined) {} //TODO

	protected customRequest(command: string, response: DebugProtocol.Response, args: any) {
		if (command == 'toggleFormatting') {
			this.valuesInHex =! this.valuesInHex;
			this.sendResponse(response);
		} else {
			super.customRequest(command, response, args);
		}
	}

	//Helper
	private formatNumber(x: number) {
		if (this.valuesInHex){
			let nn = x;
			if (nn < 0){
				nn = 0xFFFF + x + 1; //Since it's negative we don't want 0x-5, we want 0xFFFB;
			}
			return ('0x' + nn.toString(16).toLocaleUpperCase());
		}

		return x.toString(10);
	}

	private graderError(response: DebugProtocol.Response, message: string){
		return this.sendErrorResponse(response, {
			id: 1002,
			format: message,
			showUser: true
		})
	}
}