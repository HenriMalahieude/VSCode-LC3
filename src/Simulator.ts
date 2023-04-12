import { EventEmitter } from 'stream';
import * as vscode from 'vscode'

export interface Result{
	success: boolean;
	line?: number;
	context?: string;
	message?: string;
}

export interface LC3Data{
	assembly: string | undefined;
	machine: number;
}

interface LC3Label{
	label: string;
	fileLine: number;
	location: number;
	details: LC3Data;
}

const emptyLC3Data: LC3Data = { //For Memory Traversal TODO
	assembly: "",
	machine: 0b0000000000000000
}

//TODO: Initialize PC to first .ORIGIN Encountered
export class LC3Simulator extends EventEmitter{
	status: Result = {success: true};
	halted: boolean = false;

	registers: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
	memory: Map<number, LC3Data | LC3Label>;
	pc: number = 0x2FFF;
	psr: number = 0;
	mcr: number = 0;

	public file: vscode.TextDocument;
	private currentLine: number = -1;

	//Map .ORIGIN x#### locations to file line numbers (for return/jumping/conditionals)
	private subroutineLocations: Map<number, number>;

	//Map Labels to locations in memory
	private labelLocations: Map<string, number>; //For variables, all the way to positional labels

	constructor(f: vscode.TextDocument){
		super();
		//Initialize the machine
		this.memory = new Map<number, LC3Data>(); //Potentially get a file to pre-load system memory into here

		//Initialize the Object
		this.file = f;
		this.subroutineLocations = new Map<number, number>();
		this.labelLocations = new Map<string, number>();

		console.log("Opened and simulating: " + this.file.fileName)
		this.status = this.preprocess()
		if (!this.status.success){
			this.halted = true;
			this.status.context = "Preprocessing"
		}
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
		let codeAllowed: boolean = false; //To restrict code to between .ORIGIN and .END
		let subroutineMark: boolean = false; //To be able to use the subroutineLocations property properly

		for (let i = 0; i < this.file.lineCount; i++){
			let lineOfText = this.file.lineAt(i)
			let txt = lineOfText.text.trim().toLocaleUpperCase();
			let command = txt.split(" ");

			if (lineOfText.isEmptyOrWhitespace || txt.substring(0, 1) == ";") continue; //Ignore Empty Space and Comments

			//The start of routine/subroutine
			if (txt.startsWith(".ORIGIN")){
				if (!codeAllowed){
					currentLocation = this.convertNumber(command[1]);
					subroutineMark = true;
					codeAllowed = true;
	
					if (Number.isNaN(currentLocation)){
						return {success: false, message: "Could not convert number supplied to a valid location in memory.\n(Location must be specified in hex (x))", line: i};
					}else if (currentLocation < 0x3000 || currentLocation > 0xFE00){
						return {success: false, message: "Cannot populate program within system reserved memory\n(Reserved memory [0x0000 -> 0x3000) && (0xFE00 -> 0xFFFF])", line: i};
					}
				}else{
					return {success: false, message: "Did not specify where program op codes ended. Please use '.end' to specify.", line: i};
				}

				continue;
			}
			
			//End of area where code is allowed
			if (txt.startsWith(".END")){
				if (codeAllowed){
					codeAllowed = false;
				}else{
					return {success: false, message: ".END missing corresponding .ORIGIN pseudo-op before it.", line: i};
				}
				
				continue;
			}

			//Variables
			if (txt.match(/.FILL\s*/gm) || txt.match(/.STRINGZ\s*/gm) || txt.match(/.BLKW\s*/gm)){
				//TODO: Create a warning system that informs users of this
				if (codeAllowed) this.emit("warning", {success: false, message: "Please avoid placing .FILL, .STRINGZ, or .BLKW before .END statement.", line: i, context: "Variable Preprocessing"});

				if (command.length < 3) return {success: false, message: ".FILL, .STRINGZ, or .BLKW incorrectly formatted.", line: i};

				if (this.startsWithCommand(txt)) return {success: false, message: "Cannot start .FILL, .STRINGZ, or .BLKW with opcode", line: i};

				if (txt.match(/.FILL\s*/gm)){ //Single Variables
					let numerical = this.convertNumber(command[3]);
					if (Number.isNaN(numerical)) return {success: false, line: i, message: "Number provided is not hex (x), bin (b), or decimal (#)"};

					let ll: LC3Label = {
						fileLine: i,
						label: command[0],
						location: currentLocation,
						details: {
							assembly: txt,
							machine: numerical,
						}
					}
	
					this.memory.set(currentLocation, ll);
					this.labelLocations.set(command[0], currentLocation);
				} else if (txt.match(/.STRINGZ\s*/gm)){ //Strings
					let ll: LC3Label = {
						fileLine: i,
						label: command[0],
						location: currentLocation,
						details: {
							assembly: txt,
							machine: command[2].charCodeAt(0),
						}
					}

					this.memory.set(currentLocation, ll);
					this.labelLocations.set(command[0], currentLocation)

					for (let i = 1; i < command[2].length; i++){
						currentLocation +=1; //It's fine to put it before hand, because outside the "if" it will increase
						this.memory.set(currentLocation, {assembly: command[2].at(i), machine: command[2].charCodeAt(i)})
					}
					currentLocation += 1;
					this.memory.set(currentLocation, {assembly: "\0", machine: 0}) //Remembering the zero section

				} else if (txt.match(/.BLKW\s*/gm)){ //Array/Blocking
					let ll: LC3Label = {
						fileLine: i,
						label: command[0],
						location: currentLocation,
						details: {
							assembly: txt,
							machine: 0,
						}
					}

					this.memory.set(currentLocation, ll);
					this.labelLocations.set(command[0], currentLocation);

					let total = Number(command[2]);
					if (Number.isNaN(total)) return {success: false, line: i, message: "Could not convert number (NaN err). Do not use any specifiers (x,b,#) as this is implicitly converted from decimal."};

					for (let i = 1; i < Number(command[2]); i++){
						currentLocation += 1;
						this.memory.set(currentLocation, {assembly: "", machine: 0});
					}
				}

				currentLocation +=1;
				continue;
			}

			if (!this.startsWithCommand(txt)){
				let ll: LC3Label = {
					fileLine: i,
					location: currentLocation,
					label: command[0],
					details: {
						assembly: txt,
						machine: 0,
					}
				}

				if (command.length > 1 && command[1].substring(0, 1) != ";" && this.startsWithCommand(command[1])){
					currentLocation += 1; //So that it doesn't get overwritten.
				}else if (command.length > 1 && command[1].substring(0, 1) != ";"){
					return {success: false, line: i, message: "Positional label properly labeled, but did not understand following command on same line."};
				}

				continue;
			}else if (subroutineMark){ //If this line has a command, and we've just arrived from a .ORIGIN pseudo
				this.subroutineLocations.set(currentLocation, i);
				subroutineMark = false;
			}

			currentLocation += 1;
		}

		return {success: true};
	}

	private interpretCommand(line: string): Result{
		let manip = line.trim().toLocaleUpperCase();
		if (manip.startsWith(".END")) { return {success: false, message: "Reached End of Program without halting. Forcing an end."}; }
		if (manip.startsWith(".") || manip.startsWith(";") || manip.length <= 0) return {success: true};

		if (!this.startsWithCommand(manip)){
			manip = manip.substring(manip.indexOf(" ")+1) //Removes the label (NOTE: for positional labels)
		}

		//Run this again incase of Pseudo operator .FILL or .STRINGZ or .BLKW
		if (manip.startsWith(".") || manip.startsWith(";") || manip.length <= 0) return {success: true};

		this.pc++;
		//Macros
		if (manip.match(/\s*HALT\s*/gm)){
			//console.log('Halting program')
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

		if (!command[1].startsWith("R") || Number.isNaN(destIndex) || destIndex < 0 || destIndex > 7){
			return {success: false, message: "Destination Register is NaN or out of bounds."}
		}

		if (!command[2].startsWith("R") || Number.isNaN(sourIndex) || sourIndex < 0 || sourIndex > 7){
			return {success: false, message: "First Source Register is NaN or out of bounds."}
		}

		if (Number.isNaN(numerical)){
			return {success: false, message: "Number not given proper hexadecimal (x) or decimal (#) or binary (b) flag."}
		}

		if (command[3].startsWith("R")){
			let temp = Number(command[3].substring(1, 2));

			if (!Number.isNaN(temp) && temp >= 0 && temp <= 7){
				numerical = this.registers[temp]
			}else{
				return {success: false, message: "Second Source Register is NaN or out of bounds."}
			}
		}

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

		//this.registers[registerIndex] = numerical;
		//TODO: Look in Memory

		return {success: true};
	}

	private NOT(line: string): Result{
		let command = line.split(" ");
		let destinationS = command[1].substring(1, 2);
		let sourceS = command[2].substring(1,2);

		let destIndex = Number(destinationS);
		let sourIndex = Number(sourceS);
		if (!command[1].startsWith("R") || Number.isNaN(destIndex) || destIndex > 7 || destIndex < 0){
			return {success: false, message: "Destination Register is NaN or out of bounds."};
		}

		if (!command[2].startsWith("R") || Number.isNaN(sourIndex) || sourIndex > 7 || sourIndex < 0){
			return {success: false, message: "Source Register is NaN or out of bounds."};
		}

		this.registers[destIndex] = ~this.registers[sourIndex];

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
		if (line.startsWith("RTI ")) return true;
		
		if (line.startsWith("ST ")) return true;
		if (line.startsWith("STI ")) return true;
		if (line.startsWith("STR ")) return true;
		
		if (line.startsWith("TRAP ")) return true;

		if (line.match(/\s*HALT\s*/gm)) return true;
		if (line.match(/\s*PUTC\s*/gm)) return true;
		if (line.match(/\s*GETC\s*/gm)) return true;

		return false;
	}

	private removeComment(line: string): string{
		if (line.indexOf(";") >= 0){
			return line.substring(0, line.indexOf(";"));
		}

		return line;
	}
}