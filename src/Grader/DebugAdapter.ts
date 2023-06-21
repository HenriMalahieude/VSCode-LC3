import { DebugProtocol } from "@vscode/debugprotocol/lib/debugProtocol";
import * as DAP from "@vscode/debugadapter";
import * as vscode from 'vscode';
import {Optional, CLIInterface} from './GraderInterface'
import {startsWithCommand} from "../Simulator/SimSubmodule/LC3Utils"

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

export class LC3GraderAdapter extends DAP.DebugSession {
	private outputChannel: vscode.OutputChannel;
	private grader: CLIInterface;
	private file: vscode.TextDocument | undefined;

	private valuesInHex: boolean = true;
	private memoryCount: number = 16;

	private memoryHead: number = -1;

	private bp_cache: DebugProtocol.Breakpoint[] = [];
	private input_force_bp: DebugProtocol.Breakpoint[] = [];

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
		this.file = undefined;
	}

	protected attachRequest(response: DebugProtocol.AttachResponse, args: ILaunchRequestArguments) {
		return this.launchRequest(response, args);
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: ILaunchRequestArguments) {
		try {
			let td: vscode.TextDocument = await vscode.workspace.openTextDocument(pathToUri(args.program));
			vscode.window.showTextDocument(td); //Focus this Text Document

			this.file = td;

			let compilationSuccess = await this.grader.Compile(td);

			if (compilationSuccess){
				let succ: boolean = await this.grader.LaunchDebuggerCLI(td);

				if (!succ) return this.graderError(response, "Could not launch the CLI?");

				//TODO: Add forced breakpoints in for Inputs

				this.grader.on("stdin_expect", () => {
					vscode.window.showInputBox({
						title: 'LC3-Simulator Input Buffer Fill Request',
						placeHolder: 'a',//Hello, World!
						prompt: 'Single char \'a\' or full string \'Hello, World!\', Escape character (\\) not supported.',
						value: '',
						ignoreFocusOut: true,
					}).then((item: string | undefined) => {
						if (item != undefined){
							this.grader.FillStdInBuffer(item);
						}else{
							this.grader.emit("stdin_expect"); //We don't want them running away
						}
					})
				})

				this.outputChannel.appendLine("\n");
				this.sendEvent(new DAP.StoppedEvent("launch", 1))
			}else{
				this.graderError(response, "Could not compile?");
			}
		}catch (e){
			console.log(e)
			this.file = undefined;
			return;
		}
	}

	//Note: Should we even support these? They have the simulator which will be much better for them
	protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments) {
		if (this.file == undefined) return this.graderError(response, "Not debugging any file");

		const locations = args.breakpoints;

		response.body = {
			breakpoints: []
		}

		if (locations && args.source && args.source.path && args.source.path == this.file.uri.fsPath){

			//Find and remove missing breakpoints in new "locations"
			for (let i = 0; i < this.bp_cache.length; i++){
				let remov = true;

				//Compare to each element in "new" array
				for (let j = 0; j < locations.length; j++){
					if (this.bp_cache[i].line == locations[j].line){
						remov = false;
						break;
					}
				}

				if (remov){
					let bp = this.bp_cache[i]

					if (bp.line){
						let loc = this.GetSourceLineAddress(bp.line);
						console.log("Remove: 0x" + loc.toString(16))

						if (loc > 0x0){ //A valid Location we set beforehand
							let remove_succ_p = await this.grader.SetBreakpoint(loc, false);
							if (remove_succ_p.message != undefined || remove_succ_p.value == undefined || !remove_succ_p.value){
								let mess = remove_succ_p.message ? remove_succ_p.message : "Remove BP Default Error?"; //NOTE: Perhaps not force the bp end?
								return this.graderError(response, mess);
							}
						}
					}

					this.bp_cache.splice(i, 1);
					i--; //we are removing an element, so we have to make sure we don't skip elements
				}
			}

			//Find and add new breakpoints from list
			for (let i = 0; i < locations.length; i++){
				let n = true;
				for (let j = 0; j < this.bp_cache.length; j++){
					if (this.bp_cache[j].line == locations[i].line){
						n = false;
						break;
					}
				}

				if (n){ //New, lets add it
					let bp = locations[i]
					
					if (bp.line){
						let loc = this.GetSourceLineAddress(bp.line);
						console.log("Add: 0x" + loc.toString(16))

						if (loc > 0x0){
							let add_succ_p = await this.grader.SetBreakpoint(loc, true);
							if (add_succ_p.message != undefined || add_succ_p.value == undefined || !add_succ_p.value){
								let mess = add_succ_p.message ? add_succ_p.message : "Adding BP Default Error?"
								return this.graderError(response, mess);
							}
							this.bp_cache.push({verified: true, line: bp.line, id: bp.line, instructionReference: "0x" + loc.toString(16)});
						}else{
							this.bp_cache.push({verified: false, message: "Not a valid memory location", line: bp.line, id: bp.line});
						}
					}
				}
			}
		}

		response.body = {
			breakpoints: this.bp_cache, //I hope this gets copied over, I'm a noob for this type of memory management in Typescript. Reference? Or Value? No Clue
		}

		return this.sendResponse(response);
	}
	
	protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments | undefined) {
		let promise_stack = await this.grader.StackTraceRequest();
		if (promise_stack.value == undefined || promise_stack.message != undefined) {
			this.graderError(response, (promise_stack.message) ? promise_stack.message : "Default Launch Error?");
		}

		let stack = (promise_stack.value) ? promise_stack.value : ["Error Getting Stack Trace"];
		//console.log(stack)

		response.body = {
			stackFrames: []
		}

		for (let i = 0; i < stack.length; i++){
			response.body.stackFrames.push({id: i, name: stack[i], line: 0, column: 0, presentationHint: 'subtle'});
		}

		response.body.totalFrames = stack.length;

		//console.log(response)

		this.sendResponse(response);
	}

	protected cancelRequest(response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments | undefined) {this.sendResponse(response);}

	protected terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments | undefined): void {
		this.grader.CloseDebuggerCLI();
		this.file = undefined;
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
				{name: "Registers", variablesReference: 1, expensive: false},
				{name: "Memory", variablesReference: 2, expensive: true},
			]
		};
		
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments) {
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

	protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments) {
		//TODO: Run

		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments) {
		this.grader.StepInstruction("over").then((std_output) => {this.StepHelper(response, std_output)});

		this.sendResponse(response);
	}

	protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments) {
		this.grader.StepInstruction("in").then((std_output) => {this.StepHelper(response, std_output)});

		this.sendResponse(response);
	}

	protected async stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments | undefined) {
		this.grader.StepInstruction("out").then((std_output) => {this.StepHelper(response, std_output)});

		this.sendResponse(response);
	}

	protected customRequest(command: string, response: DebugProtocol.Response, args: any) {
		if (command == 'toggleFormatting') {
			this.valuesInHex =! this.valuesInHex;
			this.sendResponse(response);
		} else {
			super.customRequest(command, response, args);
		}
	}

	private StepHelper(response: DebugProtocol.Response, std_output: Optional<string>){
		if (std_output.message != undefined){
			response.success = false
			return this.graderError(response, std_output.message)
		}

		if (std_output.value != "" && std_output.value != undefined){
			this.outputChannel.append(std_output.value);
			this.outputChannel.show();
		}

		this.sendEvent(new DAP.StoppedEvent("step", 1))
	}

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
		console.log("Grader Error: " + message);

		this.grader.CloseDebuggerCLI();
		this.file = undefined;

		return this.sendErrorResponse(response, {
			id: 1002,
			format: message,
			showUser: true
		})
	}

	//Simply starts at source line, and counts upwards until .ORIG is hit or error
	private GetSourceLineAddress(source_line: number): number {
		if (this.file == undefined) return -1;

		function detectCommand(line: number, file: vscode.TextDocument): boolean{
			let txt = file.lineAt(line).text.trim().toLocaleUpperCase();
			let command = txt.split(" ")
			if (!startsWithCommand(command[0] + " ")) { //For Labels that have a command following it
				command.shift()
			}

			return command.length > 0 && startsWithCommand(command[0] + " ");
		}

		let isCommand = detectCommand(source_line-1, this.file)
		if (isCommand) {
			//Start counting up
			let commandsAbove = 0;
			let at = source_line-1;
			while (at > 0){
				at--;
				let nTxt = this.file.lineAt(at).text.trim().toLocaleUpperCase();

				if (detectCommand(at, this.file)){
					commandsAbove++;
					continue;
				}

				if (nTxt.startsWith(".END")) return -1;
				if (nTxt.startsWith(".ORIG")) {
					let nn = Number("0x"+nTxt.split(" ")[1].substring(1)); //convert "x3000" to number
					if (!Number.isNaN(nn)){
						console.log(nn, commandsAbove)
						return nn + commandsAbove;
					}

					return -1;
				}
			}
		}

		return -1;
	}
}