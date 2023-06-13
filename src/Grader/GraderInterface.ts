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
	private outputChannel: vscode.OutputChannel;

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
		let compiler_uri: vscode.Uri = vscode.Uri.joinPath(this.CLI_path, "./assembler.exe")
		
		try {
			const {stdout, stderr} = await execFile(compiler_uri.fsPath, ["--print-level=5", file.uri.fsPath])

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
			console.log(e);

			this.outputChannel.clear();
			this.outputChannel.show();

			this.outputChannel.appendLine("" + e);
			this.outputChannel.appendLine("Error with compiling function: E1001");
			return false;
		}
	}

	public async LaunchDebuggerCLI(file: vscode.TextDocument): Promise<boolean>{
		if (this.debugger) return false;

		let debugger_uri = vscode.Uri.joinPath(this.CLI_path, "./simulator.exe");
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

		this.debugger.stdin.write("randomize\n"); //To enforce a "grader" like appearance

		this.cli_buffer = ""; //We're are just clearing the stdout buffer

		return true;
	}

	public CloseDebuggerCLI(){
		if (this.debugger == undefined) return;

		//NOTE: May want to tell the debugger to quit through the stdin instead of just sigterm-ing it
		this.debugger.stdin.end("quit\n");
		//this.debugger.kill();
		this.debugger = undefined;
	}

	public async GetRegisters(): Promise<Optional<number[]>> {
		if (this.debugger == null) return {message: "Debugger not running?"};
		/*
		> regs
		R0: 0x0000 (    0)    R1: 0x0000 (    0)    R2: 0x0000 (    0)    R3: 0x0000 (    0)
		R4: 0x0000 (    0)    R5: 0x0000 (    0)    R6: 0x0000 (    0)    R7: 0x0000 (    0)
		PC: 0x3000
		PSR: 0x8002
		CC: ☻
		MCR: 0x0000
		Executed 0 instructions
		>
		*/

		this.cli_buffer = "";

		this.debugger.stdin.write("regs\n");

		let registers: number[] = [];

		while (this.CountSentinelInBuffer("\n") < 2) {await sleep(50)}
		console.log(this.cli_buffer);
		
		for (let i = 0; i < 8; i++){
			let registerTerm = "R" + i.toString() + ": "; // "R0: "
			let start = this.cli_buffer.indexOf(registerTerm) + registerTerm.length + 1; //Where the data starts
			let value = this.cli_buffer.substring(start, start+6);
			console.log(value);
			registers[i] = Number(value);
		}
		
		let pc_start = this.cli_buffer.indexOf("PC: ") + "PC: ".length + 1;
		registers[8] = Number(this.cli_buffer.substring(pc_start, pc_start+6));

		let psr_start = this.cli_buffer.indexOf("PSR: ") + "PSR: ".length + 1;
		registers[9] = Number(this.cli_buffer.substring(psr_start, psr_start+6));

		let mcr_start = this.cli_buffer.indexOf("MSR: ") + "MCR: ".length + 1;
		registers[10] = Number(this.cli_buffer.substring(mcr_start, mcr_start+6));

		return {value: registers};
	}

	public async GetMemoryRange(start: number, amount:number = 1): Promise<Optional<Map<number, string>>> {
		if (this.debugger == null) return {message: "Debugger not running?"};
		/* 
			> mem 0x3000 0x300F
			0x3000: 0x5DA0 AND R6, R6, #0
			0x3001: 0x5020 AND R0, R0, #0
			0x3002: 0x1DAF ADD R6, R6, #15 

			etc

			Executed 0 instructions
			>
		*/

		let memory_range: Map<number, string> = new Map;

		this.cli_buffer = "";

		if (amount > 1){
			this.debugger.stdin.write("mem " + start.toString(16) + " " + (start + amount).toString(16) + "\n");
		}else{
			this.debugger.stdin.write("mem " + start.toString(16) + "\n");
		}
		
		while(this.CountSentinelInBuffer("\n") < (amount-2)) {await sleep(50)};
		for (let i = 0; i < amount; i--){
			if (this.cli_buffer == "" && i < amount) return {message: "Reached end of stdin, but we asked for more memory?"};

			this.SkipWhitespace();
			let addr = Number(this.cli_buffer.substring(0, this.cli_buffer.indexOf(":")));
			if (Number.isNaN(addr)){
				return {message: "Memory get " + i.toString() + " failed?"}
			}
			memory_range.set(addr, this.cli_buffer.substring(this.cli_buffer.indexOf(" ") + 1));

			this.cli_buffer.substring(this.cli_buffer.indexOf("\n") + 1);
		}

		return {value: memory_range};
	}

	//Helper Function
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