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

	protected cancelRequest(response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments | undefined): void {} //TODO

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

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {} //TODO

	protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments) {} //TODO

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments | undefined) {
		response.body = {
			scopes: [
				{name: "Registers", variablesReference: 1, expensive: false},
				{name: "Memory", variablesReference: 2, expensive: false},
			]
		};
		
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
	private graderError(response: DebugProtocol.Response, message: string){
		return this.sendErrorResponse(response, {
			id: 1002,
			format: message,
			showUser: true
		})
	}
}