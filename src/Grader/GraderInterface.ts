import { EventEmitter } from 'stream';
import * as cp from 'child_process';
import {promisify} from 'util';
import * as vscode from 'vscode';
import {platform} from "process";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const execFile = promisify(cp.execFile);

const EVENT_NEWLINE = "DataNewLine";

export interface Optional<T>{
	value?: T;
	message?: string;
}

export class CLIInterface extends EventEmitter {
	outputChannel: vscode.OutputChannel;

	private CLI_path: vscode.Uri;
	private cli_buffer: string = "";

	private debugger: cp.ChildProcessWithoutNullStreams | undefined = undefined;
	
	constructor(ctx: vscode.ExtensionContext, otc: vscode.OutputChannel){
		super();
		this.outputChannel = otc;

		let isWindows = platform === "win32"
		let isMac = platform === "darwin"

		this.CLI_path = ctx.extensionUri;
		if (isWindows){
			this.CLI_path = vscode.Uri.joinPath(this.CLI_path, "./CLIs/Windows/");
		}else if (isMac){
			this.CLI_path = vscode.Uri.joinPath(this.CLI_path, "./CLIs/Mac/");
		}else{ //Must be linux then...
			this.CLI_path = vscode.Uri.joinPath(this.CLI_path, "./CLIs/Linux/");
		}

		//NOTE: May need to detect architecture specifically
	}

	public async Compile(file: vscode.TextDocument): Promise<boolean> {
		let compiler_uri: vscode.Uri = vscode.Uri.joinPath(this.CLI_path, "./assembler")
		
		try {
			const {stdout, stderr} = await execFile(compiler_uri.fsPath, ["---print-level=5", compiler_uri.fsPath])

			if (stderr){
				console.log("Compile Std Err: " + stderr);

				this.outputChannel.clear();
				this.outputChannel.show();

				this.outputChannel.appendLine(stderr);
				this.outputChannel.appendLine("System having issues finding the file? \nIt may be due to spaces in a folder name. Please remove them before continuing.");
				return false;
			}

			if (stdout){
				this.outputChannel.clear();
				//this.outputChannel.show();

				this.outputChannel.appendLine(stdout);
			}

			return true;
		}catch (e){
			console.log("Error: " + e);

			this.outputChannel.clear();
			this.outputChannel.show();

			this.outputChannel.appendLine("Error with compiling function: E1001");
			return false;
		}
	}

	public async LaunchDebuggerCLI(file: vscode.TextDocument): Promise<boolean>{
		if (this.debugger) return false;

		let debugger_uri = vscode.Uri.joinPath(this.CLI_path, "./simulator");
		let objFile = file.fileName.substring(0, file.fileName.lastIndexOf(".")) + ".obj";

		this.cli_buffer = "";

		try{
			this.debugger = cp.spawn(debugger_uri.fsPath, ["--print-level=6", objFile]);
		}catch (e){
			console.log(e);
			return false;
		}
		
		this.debugger.stdout.setEncoding('utf-8');

		this.debugger.stdout.on("data", (data) =>{
			this.cli_buffer += data;
			if (this.cli_buffer.endsWith("\n")){
				this.emit(EVENT_NEWLINE);
				console.log(this.cli_buffer);
			}
		})

		this.debugger.stderr.on("data", (data) => {
			console.log(data);
		})

		this.debugger.addListener('error', (err: Error) => {
			console.log("Simulator Error: " + err.message);
		});

		//Remove the entrance message (the help message)
		while(this.CountSentinelInBuffer("\n") < 16){
			await sleep(50);
		}

		this.cli_buffer = ""; //We're are just clearing the stdout buffer

		this.debugger.stdin.write("randomize\n"); //To enforce a "grader" like appearance

		return true;
	}

	public CloseDebuggerCLI(){
		if (this.debugger == undefined) return;

		//NOTE: May want to tell the debugger to quit through the stdin instead of just sigterm-ing it
		this.debugger.stdin.end();
		//this.debugger.kill();
		this.debugger = undefined;
	}

	public async GetRegisters(): Promise<Optional<number[]>> {
		if (this.debugger == null) return {message: "Debugger not running?"};

		this.cli_buffer = "";

		this.debugger.stdin.write("regs\n");

		let registers: number[] = [];

		while (this.CountSentinelInBuffer("\n") < 2) {await sleep(50)} 
		this.SkipWhitespace();
		//Get the rest...


		return {value: registers};
	}

	private SkipWhitespace(){
		if (this.cli_buffer.length <= 0 || this.cli_buffer.search(/\s/gm) != 0) return;

		this.cli_buffer = this.cli_buffer.substring(1);

		this.SkipWhitespace();
	}

	private CountSentinelInBuffer(sentinel: string): number{
		let count = 0;

		let tempValue: string = this.cli_buffer.substring(0) //I just want to make sure that the string is a copy...

		while(tempValue.length > 0){
			let ii = tempValue.indexOf(sentinel);
			if (ii < 0){
				break;
			}
			
			tempValue = tempValue.substring(ii+1);
			count++;
		}
		

		return count;
	}
}