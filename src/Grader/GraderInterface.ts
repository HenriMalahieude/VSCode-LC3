import * as Mutexer from 'async-mutex'
import { EventEmitter } from 'stream';
import * as cp from 'child_process';
import {promisify} from 'util';
import * as vscode from 'vscode';
import {platform} from "process";

const STD_WAIT = 100; //in ms
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

	private buffer_in: string[] = ["a"];

	private debugger: cp.ChildProcessWithoutNullStreams | undefined = undefined;
	private debugMutex: Mutexer.Mutex = new Mutexer.Mutex();
	
	constructor(ctx: vscode.ExtensionContext, otc: vscode.OutputChannel){
		super();
		this.outputChannel = otc;

		let isWindows = platform === "win32"
		let isMac = platform === "darwin" //I wish there was specific ARM or Intel platform detection

		this.CLI_path = ctx.extensionUri;
		if (isWindows){
			this.CLI_path = vscode.Uri.joinPath(this.CLI_path, "./CLIs/Windows/");
			this.CLI_compiler = vscode.Uri.joinPath(this.CLI_path, "./assembler.exe"); //Compiled on Windows 10, Intel Processor
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

	public FillStdInBuffer(input: string){
		for (let i = 0; i < input.length; i++){
			this.buffer_in.push(input.charAt(i));
		}
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
		})

		this.debugger.stderr.on("data", (data) => {
			console.log(data);
		})

		this.debugger.addListener('error', (err: Error) => {
			console.log("Simulator Error: " + err.message);
		});

		//this.debugger.stdin.write("randomize\n"); //To enforce a "grader" like appearance
		//However, note that the labels/command info will be wiped otherwise
		
		//Remove the entrance message (the help message)
		while(this.CountSentinelInBuffer("\n") < 16){ await sleep(STD_WAIT); }

		this.cli_buffer = "";

		return true;
	}

	public async CloseDebuggerCLI(){
		if (this.debugger == undefined) return;
		this.debugMutex.cancel();

		this.outputChannel.appendLine("Closing the CLI Interface. . .");
		this.outputChannel.show();

		//NOTE: May want to tell the debugger to quit through the stdin instead of just sigterm-ing it
		this.debugger.stdin.end("quit\n");
		this.debugger.kill();
		this.debugger = undefined;
		this.cli_buffer = "";
	}

	public async GetRegisters(): Promise<Optional<number[]>> {
		if (!this.update_register_cache){
			return {value: this.register_cache};
		}
		if (this.debugger == null) return {message: "Debugger not running?"};
		const release = await this.debugMutex.acquire();
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

		while (this.cli_buffer.indexOf("\nExecuted ") == -1) {await sleep(STD_WAIT)}
		
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

		this.register_cache = registers;
		this.update_register_cache = false;

		this.cli_buffer = "";
		release();
		return {value: registers};
	}

	public async GetMemoryRange(start: number, amount:number = 1): Promise<Optional<Map<number, string>>> {
		if (start + amount > 0xFFFE || start < 0x0) return {message: "Memory Range out of Bounds"};
		if (this.debugger == null) return {message: "Debugger not running?"};
		const release = await this.debugMutex.acquire();
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

		while(this.cli_buffer.indexOf("\nExecuted") == -1 && this.cli_buffer.indexOf("invalid address") == -1) {await sleep(STD_WAIT)};
		
		if (this.cli_buffer.indexOf("invalid address") != -1){
			release();
			return {message: "Memory Range Get: Invalid Address?"};
		}

		for (let i = 0; i < amount; i++){
			if (this.cli_buffer == "" && i < amount) {
				release();
				return {message: "Reached end of stdin, but we asked for more memory?"};
			}

			this.SkipWhitespace();
			let addr = Number(this.cli_buffer.substring(0, this.cli_buffer.indexOf(":")));
			if (Number.isNaN(addr)){
				release();
				return {message: "Memory get " + i.toString() + " failed?"}
			}
			memory_range.set(addr, this.cli_buffer.substring(this.cli_buffer.indexOf(" ") + 1, this.cli_buffer.indexOf("\r")));

			this.cli_buffer = this.cli_buffer.substring(this.cli_buffer.indexOf("\n") + 1);
		}

		this.cli_buffer = "";
		release();
		return {value: memory_range};
	}

	public async StackTraceRequest(): Promise<Optional<string[]>> {
		const amount = 5;
		if (this.debugger == undefined) return {message: "Debugger not running, cannot trace stack."};
		const release = await this.debugMutex.acquire();
		
		let stack: string[] = [];

		this.debugger.stdin.write("list " + (Math.floor(amount/2)).toString() + "\n");

		while (this.cli_buffer.indexOf("\nExecuted ") == -1) await sleep(STD_WAIT);

		for (let i = 0; i < amount; i++){
			if (this.cli_buffer == "" && i < amount) {
				release();
				return {message: "ST context get " + i + " failed?"};
			}

			stack[i] = this.cli_buffer.substring(0, this.cli_buffer.indexOf("\n"))

			this.cli_buffer = this.cli_buffer.substring(this.cli_buffer.indexOf("\n") + 1)
		}

		this.cli_buffer = "";
		release();
		return {value: stack};
	}

	public async SetRegisters(register_index: number, value: number): Promise<boolean> {
		if (this.debugger == undefined || Number.isNaN(value) || Number.isNaN(register_index)) return false;
		const release = await this.debugMutex.acquire();

		let stringed: string = "";
		if (register_index <= 7){
			stringed = "R" + register_index.toString();
		}else{
			release();
			return false; //Though this functionality could be expanded later
		}

		this.debugger.stdin.write("set " + stringed + " 0x" + value.toString(16) + "\n");

		while(this.cli_buffer.indexOf("\nExecuted ") == -1) {await sleep(STD_WAIT)}

		this.update_register_cache = true;
		this.cli_buffer = "";
		release();
		return true;
	}

	public async SetBreakpoint(location: number, addBreak: boolean): Promise<Optional<boolean>>{
		if (location < 0x0 || location > 0xFFFE) return {value: false, message: "Break Point Location out of bounds"}
		if (this.debugger == undefined) return {value: false, message: "Debugger not running?"};

		let break_points = await this.GetBreakpoints();
		if (break_points.message != undefined || break_points.value == undefined) return {value: false, message: break_points.message};
		console.log(break_points)

		const release = await this.debugMutex.acquire();

		let bp_id_if_exists = -1;
		for (let i = 0; i <= break_points.value.MaxId; i++){
			let tem_vl = break_points.value.Points.get(i);
			if (tem_vl != undefined){
				if (tem_vl == location) {
					bp_id_if_exists = i;
				}
			}
		}

		if (bp_id_if_exists != -1 && addBreak){
			this.cli_buffer = "";
			release();
			return {value: false, message: "Cannot add a breakpoint that already exists"};
		}else if (bp_id_if_exists == -1 && !addBreak){
			this.cli_buffer = "";
			release();
			return {value: false, message: "Cannot remove a breakpoint that doesn't exist"};
		}
		
		this.cli_buffer = "";
		if (addBreak){
			this.debugger.stdin.write("break set 0x" + location.toString(16) + "\n");
		}else {
			this.debugger.stdin.write("break clear " + bp_id_if_exists + "\n");
		}

		while (this.cli_buffer.indexOf("Executed") == -1) {await sleep(STD_WAIT)}

		if (this.cli_buffer.startsWith("invalid value")) return {value: false, message: "Set BP failed:\n" + this.cli_buffer};

		this.cli_buffer = "";
		release();
		return {value: true};
	}

	//Returns locations of each breakpoint ([-1, 0x4000, 0x320F 0xFF02])
	public async GetBreakpoints(): Promise<Optional<{Points: Map<number, number>, MaxId: number}>>{
		if (this.debugger == undefined) return {message: "Debugger not running?"};
		const release = await this.debugMutex.acquire();

		this.debugger.stdin.write("break list\n");

		//Note: If there is nothing in the list, then "/nExecuted" won't exist because there ain't no "\n"
		while (this.cli_buffer.indexOf("Executed") == -1) {await sleep(STD_WAIT)} //Wait until it has listed everything

		let new_line_count = this.CountSentinelInBuffer("\n") - 1; //Remove the count for "Executed"
		let break_points: Map<number, number> = new Map;
		let m_id: number = -1;

		if (new_line_count > 0){ //each new line represents a breakpoint
			let temp: string = "" + this.cli_buffer; //Ensure copy
			while (temp != ""){
				if (temp.startsWith("Executed")) break;

				if (!temp.startsWith("#")){
					this.cli_buffer = ""
					release();
					return {message: "GetBp: Invalid CLI response:\n"+temp};
				}

				let id = Number(temp.substring(1, 2)); 
				if (Number.isNaN(id)) {
					this.cli_buffer = ""
					release();
					return {message: "GetBp: Invalid ID? (" + temp.substring(1, 2) + ")"};
				}
				
				if (id > m_id) m_id = id;

				let loc = Number(temp.substring(4, 10));
				if (Number.isNaN(loc)){
					this.cli_buffer = ""
					release();
					return {message: "GetBp: Invalid Location? (" + temp.substring(4, 10) + ")"};
				}

				break_points.set(id, loc);
				temp = temp.substring(temp.indexOf("\n") + 1);
			}
		}

		this.cli_buffer = "";
		release();
		return {value: {Points: break_points, MaxId: m_id}};
	}

	//So basically, input doesn't work?
	public async StepInstruction(mode: "over" | "in" | "out"): Promise<Optional<string>>{
		if (this.debugger == undefined) return {message: "Debugger not running?"};
		const release = await this.debugMutex.acquire();
		//Input doesn't work, only method that I can think of is to suffer, force breakpoints on every single input opcode and handle the inputs manually...

		this.debugger.stdin.write("step " + mode + "\n");
		//while (this.cli_buffer.indexOf("Executed") == -1) await sleep(STD_WAIT);
		let std_output = ""
		let input = true;
		for (let i = 0; i < 10; i++){
			if (this.cli_buffer.indexOf("Executed") != -1){
				input = false;
				break;
			}

			await sleep(STD_WAIT);
		}

		if (input == true){
			this.emit("stdin_expect");
			console.log("rbuh " + this.buffer_in.length)
			while (this.buffer_in.length <= 0) await sleep(STD_WAIT);
			let char = this.buffer_in.shift()?.charAt(0)
			console.log(char)

			this.debugger.stdin.write(char);		

			while (this.cli_buffer.indexOf("Executed") == -1){console.log(this.cli_buffer); await sleep(STD_WAIT) }
		}

		let tt = this.cli_buffer.indexOf("    0x");
		if (tt != -1){
			std_output = this.cli_buffer.substring(0, tt);
		}

		this.update_register_cache = true;
		this.cli_buffer = "";
		release();
		return {value: std_output};
	}

	//Helper Function
	private SkipWhitespace(){
		if (this.cli_buffer.length <= 0 || this.cli_buffer.search(/\s/gm) != 0) return;

		this.cli_buffer = this.cli_buffer.substring(1);

		this.SkipWhitespace();
	}

	private IsErrorInBuffer(): boolean {
		if (this.cli_buffer.indexOf("--- Access violation---") != -1) return true; //LC3 Tools seems to have a typo and be missing a space
		if (this.cli_buffer.indexOf("--- Illegal opcode ---") != -1) return true;
		if (this.cli_buffer.indexOf("--- Privilege violation ---") != -1) return true;
		if (this.cli_buffer.indexOf("--- Undefined trap executed ---") != -1) return true;

		return false;
	}

	private GetErrorInBuffer(): string{
		let err = ""

		let start = this.cli_buffer.indexOf("\n\n---");
		if (start != -1) err = this.cli_buffer.substring(start+5, this.cli_buffer.indexOf("---\n\n")); //Getting just the text within the \n\n--- "error" ---\n\n

		return err;
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

	private IgnoreWarnings(){
		let w_ind = this.cli_buffer.indexOf("warning: ");
		while(w_ind != -1 && this.cli_buffer.length > 0) {
			this.cli_buffer = this.cli_buffer.substring(this.cli_buffer.indexOf("\n")+1);
		}
	}
}