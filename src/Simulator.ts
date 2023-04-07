import { EventEmitter } from 'stream';
import * as vscode from 'vscode'

export interface Result{
	success: boolean;
	line?: number;
	context?: string;
	message?: string;
}

export interface LC3Data{
	assembly: string;
	hex: number;
	machine: number;
}

const emptyLC3Data: LC3Data = {
	assembly: "",
	hex: 0x0000,
	machine: 0b0000000000000000
}

export class LC3Simulator extends EventEmitter{
	status: Result = {success: true};
	halted: boolean = false;

	registers: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
	memory: Map<number, LC3Data>;
	pc: number = 0x3000;
	psr: number = 0;
	mcr: number = 0;

	public file: vscode.TextDocument;
	private currentLine: number = -1;

	//Map .ORIGIN x#### locations to file line numbers
	private subroutineLocations: Map<number, number>;

	//Map Labels to locations in memory
	private labelLocations: Map<number, number>;

	constructor(f: vscode.TextDocument){
		super();
		//Initialize the machine
		this.memory = new Map<number, LC3Data>(); //Potentially get a file to pre-load system memory into here

		//Initialize the Object
		this.file = f;
		this.subroutineLocations = new Map<number, number>();
		this.labelLocations = new Map<number, number>();

		console.log("Opened and simulating: " + this.file.fileName)
		//this.preprocess() //TODO: Pre-processing so that we can map file locations with .origin commands
	}

	//-----------------------Public Functions for Simulator Control-----------------------

	public getCurrentLine(): number{
		return this.currentLine;
	}

	public getCurrentInstruction(offset:number = 0): string{
		let lineString = this.file.lineAt(this.currentLine + offset);

		return lineString.text;
	}

	public stepOver(forward: boolean): Result{
		console.log("Asked To Step Over Line " + this.currentLine);
		if (!this.status.success || this.halted) {return this.status;}

		if (this.file.lineCount < this.currentLine) {
			this.status = {success: true, context: "Complete", message: "Complete", line: this.file.lineCount}
			this.halted = true;
			return this.status;
		}

		this.currentLine += 1;

		let succ = this.interpretCommand(this.file.lineAt(this.currentLine).text);
		if (!succ.success){
			succ.line = this.currentLine+1; //translating from 0-index to 1-index
			succ.context = "Runtime"
			this.status = succ;
			this.halted = true;
		}

		return succ;
	}

	public stepIn(forward: boolean): Result{
		console.log("Asked to Step In!")
		if (!this.status.success || this.halted) {return this.status;}

		//Detect if that command sends the program elsewhere

		return {success: true};
	}

	public stepOut(forward: boolean): Result{
		console.log("Asked to Step Out!")
		if (!this.status.success || this.halted) {return this.status;}

		//Detect if this command is part of a subroutine

		return {success: true};
	}

	public run(): Result{
		console.log("Asked to Run!")
		if (!this.status.success || this.halted) {return this.status;}

		//For Loop until HALT or end of program lines or max loop reached

		return {success: true};
	}
	
	//TODO: Add in Breakpoints

	//-----------------------Meta-Functions-----------------------

	private preprocess(): Result{
		let currentLocation: number = -1; //Sentinel Number

		for (let i = 0; i < this.file.lineCount; i++){
			let lineOfText = this.file.lineAt(i)
			let txt = lineOfText.text.trim().toLocaleUpperCase();

			if (lineOfText.isEmptyOrWhitespace || txt.substring(0, 1) == ";") continue;

			if (currentLocation != -1){
				currentLocation++;
			}

			if (txt.startsWith(".")){
				//Pseudo-operators
				if (txt.startsWith(".ORIG")){
					if (currentLocation != -1) return {success: false, message: "Where does program stop? (Missing End Statement)", line: i};

					currentLocation = Number("0"+txt.substring(5,9).trim());

					if (Number.isNaN(currentLocation)) return {success: false, line: i, message: "Could not understand location. (Please format like \"x3000\")"};
					
					this.subroutineLocations.set(currentLocation + 1, i);

					if (currentLocation < 0x3000 || currentLocation > 0xFE00) return {success: false, line: i, message: "Program cannot begin in system reserved memory."};

				} else if (txt.startsWith(".END")){
					if (currentLocation == -1) return {success: false, message: "Where does program begin? (Missing Origin Statement)", line: i};
					currentLocation = -1;
				}//TODO: More

				//TODO: Label Identification
			}
			
			//TODO: Otherwise translate commands into data
		}

		if (currentLocation != -1) return {success: false, message: "Where does program stop? (Missing End Statement)", line: this.file.lineCount};

		return {success: true};
	}

	private interpretCommand(line: string): Result{
		let manip = line.trim().toLocaleUpperCase();
		if (manip.startsWith(".") || manip.startsWith(";") || manip.length <= 0) return {success: true};

		if (!this.startsWithCommand(manip)){
			manip = manip.substring(manip.indexOf(" ")+1) //Removes the label (NOTE: for positional labels)
		}

		this.pc++;
		//Macros
		if (manip.match(/\s*HALT\s*/gm)){
			console.log('Halting program')
			this.halted = true;
			return {success: true};
		}else if (manip.match(/\s*PUTC\s*/gm)){
			//TODO: Initiate PUTC with event

			return {success: true};
		}else if (manip.match(/\s*GETC\s*/gm)){
			//TODO: Intiate GETC with event

			return {success: true};
		}

		//Real Opcodes
		//Note: This isn't really scalable, or very easy to work with. But since the opcodes are finite.... it's fine.
		if (manip.startsWith("ADD ")){
			return this.ADD(manip);
		}else if (manip.startsWith("AND ")){
			return this.AND(manip);
		}else if (manip.startsWith("BR ")){
			return {success: false, message: "TODO"}; //TODO
		}else if (manip.startsWith("JMP ")){
			return {success: false, message: "TODO"}; //TODO
		}else if (manip.startsWith("JSR ")){
			return {success: false, message: "TODO"}; //TODO
		}else if (manip.startsWith("JSRR ")){
			return {success: false, message: "TODO"}; //TODO
		}else if (manip.startsWith("LD ")){
			return this.LD(manip);
		}else if (manip.startsWith("LDI ")){
			return {success: false, message: "TODO"}; //TODO
		}else if (manip.startsWith("LDR ")){
			return {success: false, message: "TODO"}; //TODO
		}else if (manip.startsWith("LEA ")){
			return {success: false, message: "TODO"}; //TODO
		}else if (manip.startsWith("NOT ")){
			return this.NOT(manip);
		}else if (manip.startsWith("RET ")){
			return {success: false, message: "TODO"}; //TODO
		}else if (manip.startsWith("RTI ")){
			return {success: false, message: "TODO"}; //TODO
		}else if (manip.startsWith("ST ")){
			return {success: false, message: "TODO"}; //TODO
		}else if (manip.startsWith("STI ")){
			return {success: false, message: "TODO"}; //TODO
		}else if (manip.startsWith("STR ")){
			return {success: false, message: "TODO"}; //TODO
		}else if (manip.startsWith("TRAP ")){
			return {success: false, message: "TODO"}; //TODO
		}

		return {success: false, message: "Couldn't understand line. Is that a valid OPCode?"};
	}

	//-----------------------ALL THE OPCODES-----------------------

	private ADD(line: string): Result{
		let command  = line.split(" ");
		let destinationS = command[1].substring(1, 2);
		let sourceS = command[2].substring(1, 2);
		let numerical

		if (!command[3].startsWith("R")){
			numerical = this.convertNumber(command[3]);
		}else{
			numerical = Number(command[3].substring(1,2));
			if (Number.isNaN(numerical) || numerical < 0 || numerical > 7){
				return {success: false, message: "Second Source Register is NaN or out of bounds."};
			}

			numerical = this.registers[numerical];
		}

		let destIndex = Number(destinationS);
		let sourIndex = Number(sourceS);

		//console.log(command);
		//console.log(destinationS, sourceS, numerical, destIndex, sourIndex);

		if (!command[1].startsWith("R") || Number.isNaN(destIndex) || destIndex < 0 || destIndex > 7){
			return {success: false, message: "Destination Register is NaN or out of bounds."}
		}

		if (!command[2].startsWith("R") || Number.isNaN(sourIndex) || sourIndex < 0 || sourIndex > 7){
			return {success: false, message: "First Source Register is NaN or out of bounds."}
		}

		if (Number.isNaN(numerical)){
			return {success: false, message: "Number not given proper hexadecimal (x) or decimal (#) or binary (b) flag"}
		}

		if (command[3].startsWith("R")){
			let temp = Number(command[3].substring(1, 2));

			if (!Number.isNaN(temp) && temp >= 0 && temp <= 7){
				numerical = this.registers[temp]
			}else{
				return {success: false, message: "Second Source Register is NaN or out of bounds."}
			}
		}

		this.registers[destIndex] = this.registers[sourIndex] + numerical;

		return {success: true};
	}

	private AND(line: string): Result{
		let command  = line.split(" ");
		let destinationS = command[1].substring(1, 2);
		let sourceS = command[2].substring(1, 2);
		let numerical

		if (!command[3].startsWith("R")){
			numerical = this.convertNumber(command[3]);
		}else{
			numerical = Number(command[3].substring(1,2));
			if (Number.isNaN(numerical) || numerical < 0 || numerical > 7){
				return {success: false, message: "Second Source Register is NaN or out of bounds."};
			}

			numerical = this.registers[numerical];
		}

		let destIndex = Number(destinationS);
		let sourIndex = Number(sourceS);

		this.registers[destIndex] = this.registers[sourIndex] & numerical; //Bitwise And

		return {success: true};
	}
	
	private LD(line: string): Result{
		let command = line.split(" ");
		let destinationS = command[1].substring(1, 2);
		let numerical = this.convertNumber(command[2]);

		console.log(destinationS, numerical)
		
		let registerIndex = Number(destinationS);//Get R#
		if (!command[1].startsWith("R") || Number.isNaN(registerIndex) || registerIndex > 7 || registerIndex < 0){
			return {success: false, message: "Destination Register is NaN or out of bounds."};
		}

		if (Number.isNaN(numerical)){
			//TODO: Labels
			return {success: false, message: "Source is NaN or out of signed 9-bit bounds."};
		}

		this.registers[registerIndex] = numerical;
	
		return {success: true};
	}

	private NOT(line: string): Result{
		let command = line.split(" ");
		let destinationS = command[1].substring(1, 2);

		let destIndex = Number(destinationS);
		if (!command[1].startsWith("R") || Number.isNaN(destIndex) || destIndex > 7 || destIndex < 0){
			return {success: false, message: "Source Register is NaN or out of bounds."};
		}

		this.registers[destIndex] = ~this.registers[destIndex];

		return {success: true}
	}

	//-----------------------HELPER FUNCTIONS-----------------------

	//Requires All Upper Case input
	private convertNumber(param: string): number{
		if (param.startsWith("X")){
			param = "0x" + param.substring(1);
			return Number(param);
		}else if (param.startsWith("B")){
			param = "0b" + param.substring(1);
			return Number(param);
		}else if (param.startsWith("#")){
			return Number(param.substring(1));
		}

		return NaN;
	}

	//Requires All Upper Case input
	private startsWithCommand(line: string): boolean{
		if (line.startsWith("ADD ")) return true;
		if (line.startsWith("AND ")) return true;

		if (line.startsWith("BR ")) return true;
		if (line.startsWith("JMP ")) return true;
		if (line.startsWith("JSR ")) return true;
		if (line.startsWith("JSRR ")) return true;

		if (line.startsWith("LD ")) return true;
		if (line.startsWith("LDI ")) return true;
		if (line.startsWith("LDR ")) return true;
		if (line.startsWith("LEA ")) return true;

		if (line.startsWith("NOT ")) return true;

		if (line.startsWith("RET ")) return true;
		if (line.match(/RTI\s*/g)) return true;
		
		if (line.startsWith("ST ")) return true;
		if (line.startsWith("STI ")) return true;
		if (line.startsWith("STR ")) return true;
		
		if (line.startsWith("TRAP ")) return true;

		return false;
	}
}