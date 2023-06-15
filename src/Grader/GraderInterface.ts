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
	private CLI_compiler: vscode.Uri;
	private CLI_simulator: vscode.Uri;

	private cli_buffer: string = "";
	
	private register_cache: number[] = [];
	private update_register_cache: boolean = true; //We want to reduce CLI spam

	private debugger: cp.ChildProcessWithoutNullStreams | undefined = undefined;
	
	constructor(ctx: vscode.ExtensionContext, otc: vscode.OutputChannel){
		super();
		this.outputChannel = otc;

		let isWindows = platform === "win32"
		let isMac = platform === "darwin"

		this.CLI_path = ctx.extensionUri;
		if (isWindows){
			this.CLI_path = vscode.Uri.joinPath(this.CLI_path, "./CLIs/Windows/");
			this.CLI_compiler = vscode.Uri.joinPath(this.CLI_path, "./assembler.exe");
			this.CLI_simulator = vscode.Uri.joinPath(this.CLI_path, "./simulator.exe");
		}else if (isMac){
			this.CLI_path = vscode.Uri.joinPath(this.CLI_path, "./CLIs/Mac/");
			//Stand Ins while we don't have them
			this.CLI_compiler = vscode.Uri.joinPath(this.CLI_path, "./assembler.exe");
			this.CLI_simulator = vscode.Uri.joinPath(this.CLI_path, "./simulator.exe");
		}else{ //Must be linux then...
			this.CLI_path = vscode.Uri.joinPath(this.CLI_path, "./CLIs/Linux/");
			//Stand Ins while we don't have them
			this.CLI_compiler = vscode.Uri.joinPath(this.CLI_path, "./assembler.exe");
			this.CLI_simulator = vscode.Uri.joinPath(this.CLI_path, "./simulator.exe");
		}

		//NOTE: May need to detect architecture specifically
	}

	public async Compile(file: vscode.TextDocument): Promise<boolean> {
		try {
			const {stdout, stderr} = await execFile(this.CLI_compiler.fsPath, ["--print-level=5", file.uri.fsPath])

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
				this.outputChannel.appendLine(stdout);

				if (stdout.indexOf("assembly successful") == -1){
					this.outputChannel.show();

					return false;
				}
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

		let objFile = file.fileName.substring(0, file.fileName.lastIndexOf(".")) + ".obj";

		this.cli_buffer = "";

		try{
			this.debugger = cp.spawn(this.CLI_simulator.fsPath, ["--print-level=6", objFile]);
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

		this.debugger.stdin.write("randomize\n"); //To enforce a "grader" like appearance
		
		//Remove the entrance message (the help message)
		while(this.CountSentinelInBuffer("\n") < 17){
			await sleep(50);
		}

		this.cli_buffer = "";

		return true;
	}

	public CloseDebuggerCLI(){
		if (this.debugger == undefined) return;

		//NOTE: May want to tell the debugger to quit through the stdin instead of just sigterm-ing it
		this.debugger.stdin.end("quit\n");
		//this.debugger.kill();
		this.debugger = undefined;
		this.cli_buffer = "";
	}

	public async GetRegisters(): Promise<Optional<number[]>> {
		if (!this.update_register_cache){
			return {value: this.register_cache};
		}
		
		await this.WaitForCLIClear();
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

		this.debugger.stdin.write("regs\n");

		let registers: number[] = [];

		while (this.CountSentinelInBuffer("\n") < 7) {await sleep(50)}
		
		for (let i = 0; i < 8; i++){
			let registerTerm = "R" + i.toString() + ": "; // "R0: "
			let start = this.cli_buffer.indexOf(registerTerm) + registerTerm.length; //Where the data starts
			let value = this.cli_buffer.substring(start, start+6);
			registers[i] = Number(value);
		}
		
		let pc_start = this.cli_buffer.indexOf("PC: ") + "PC: ".length;
		registers[8] = Number(this.cli_buffer.substring(pc_start, pc_start+6));

		let psr_start = this.cli_buffer.indexOf("PSR: ") + "PSR: ".length;
		registers[9] = Number(this.cli_buffer.substring(psr_start, psr_start+6));

		let mcr_start = this.cli_buffer.indexOf("MSR: ") + "MCR: ".length;
		registers[10] = Number(this.cli_buffer.substring(mcr_start, mcr_start+6));

		this.cli_buffer = "";
		
		this.register_cache = registers;
		this.update_register_cache = false;

		return {value: registers};
	}

	public async GetMemoryRange(start: number, amount:number = 1): Promise<Optional<Map<number, string>>> {
		await this.WaitForCLIClear();
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

		if (amount > 1){
			let i = "mem 0x" + start.toString(16) + " 0x" + (start + amount - 1).toString(16) + "\n"
			this.debugger.stdin.write(i);
		}else{
			this.debugger.stdin.write("mem 0x" + start.toString(16) + "\n");
		}

		while(this.CountSentinelInBuffer("\n") < amount) {await sleep(50)};
		console.log(this.cli_buffer)

		for (let i = 0; i < amount; i++){
			if (this.cli_buffer == "" && i < amount) return {message: "Reached end of stdin, but we asked for more memory?"};

			this.SkipWhitespace();
			let addr = Number(this.cli_buffer.substring(0, this.cli_buffer.indexOf(":")));
			if (Number.isNaN(addr)){
				return {message: "Memory get " + i.toString() + " failed?"}
			}
			memory_range.set(addr, this.cli_buffer.substring(this.cli_buffer.indexOf(" ") + 1, this.cli_buffer.indexOf("\n")));

			this.cli_buffer = this.cli_buffer.substring(this.cli_buffer.indexOf("\n") + 1);
		}

		this.cli_buffer = "";

		return {value: memory_range};
	}

	public async StackTraceRequest(): Promise<Optional<string[]>> {
		const amount = 5;
		if (this.debugger == undefined) return {message: "Debugger not running?"};
		
		let stack: string[] = [];

		let registers = await this.GetRegisters();
		if (registers.message != undefined || registers.value == undefined) return {message: registers.message};

		let pc_value = registers.value[8];
		pc_value -= Math.floor(amount / 2);

		let memory_range = await this.GetMemoryRange(pc_value, 5);
		if (memory_range.value == undefined || memory_range.message != undefined) return {message: memory_range.message};

		for (let i = 0; i < amount; i++){
			stack[i] = "0x" + (pc_value + i).toString(16) + ": " + memory_range.value.get(pc_value+i);
		}

		return {value: stack};
	}

	public async SetRegisters(register_index: number, value: number): Promise<boolean> {
		await this.WaitForCLIClear();
		if (this.debugger == undefined || Number.isNaN(value) || Number.isNaN(register_index)) return false;

		let stringed: string = "";
		if (register_index <= 7){
			stringed = "R" + register_index.toString();
		}else{
			return false; //Though this functionality could be expanded later
		}

		this.debugger.stdin.write("set " + stringed + " 0x" + value.toString(16) + "\n");

		while(this.CountSentinelInBuffer("\n") < 1) {await sleep(50)}

		this.update_register_cache = true;
		this.cli_buffer = "";
		return true;
	}

	//Helper Function
	private SkipWhitespace(){
		if (this.cli_buffer.length <= 0 || this.cli_buffer.search(/\s/gm) != 0) return;

		this.cli_buffer = this.cli_buffer.substring(1);

		this.SkipWhitespace();
	}

	private async WaitForCLIClear(){
		while(this.cli_buffer != "") {
			await sleep(25)
		}
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