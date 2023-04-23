import { EventEmitter } from 'stream';
import * as vscode from 'vscode'

export interface Result{
	success: boolean;
	line?: number;
	context?: string;
	message?: string;
}

export interface Bit16Location{
	fileIndex: number;
	pc: number;
}

export interface LC3Data{
	assembly: string | undefined;
	machine: number;
	location: Bit16Location;
}

export const emptyLC3Data: LC3Data = { //For Memory Traversal TODO
	assembly: "",
	machine: 0,
	location: {fileIndex: 0, pc: 0x3000},
}

//TODO: Initialize PC to first .ORIG Encountered
export class LC3Simulator extends EventEmitter{
	status: Result = {success: true};
	halted: boolean = false;

	registers: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
	condition_codes = {"N": false, "Z": true, "P": false}; //TODO: See what the condition codes are initialized to in LC3Tools
	memory: Map<number, LC3Data>;
	pc: number = 0x2FFF;
	psr: number = 0;
	mcr: number = 0;

	public file: vscode.TextDocument | undefined;
	protected currentLine: number = -1;
	protected processed: boolean = false;

	//Map .ORIG x#### locations to file line numbers (for return/jumping/conditionals)
	protected subroutineLocations: Map<number, number>;

	//Map Labels to locations in memory
	protected labelLocations: Map<string, Bit16Location>; //For variables, all the way to positional labels

	constructor(f: vscode.TextDocument | undefined){
		super();
		//Initialize the machine
		this.memory = new Map<number, LC3Data>(); //Potentially get a file to pre-load system memory into here

		//Initialize the Object
		if (f) this.file = f;
		this.subroutineLocations = new Map<number, number>();
		this.labelLocations = new Map<string, Bit16Location>();

		if (f && this.file) {
			console.log("Opened and ready to simulate: " + this.file.fileName);
		}else{
			//console.log("Opened simulator in testing mode.");
		}
	}

	public InitializeSimulator(){
		if (this.halted || this.processed) return;

		this.status = this.preprocess();
		if (!this.status.success){
			this.halted = true;
			this.status.context = "Preprocessing"
		}

		this.processed = true;
	}

	//-----------------------Public Functions for Simulator Control-----------------------

	public getCurrentLine(): number{
		return this.currentLine+1;
	}

	public getCurrentInstruction(offset:number = 0): string{
		if (!this.file) return "";
		let lineString = this.file.lineAt(this.currentLine + offset);

		return lineString.text;
	}

	public stepOver(forward: boolean): Result{
		//console.log("Asked To Step Over Line " + this.currentLine);
		if (!this.status.success || this.halted || !this.file) {return this.status;}

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

	public run(): Result{//TODO: Add in Breakpoints
		console.log("Asked to Run!")
		if (!this.status.success || this.halted) {return this.status;}

		//For Loop until HALT or end of program lines or max loop reached

		return {success: true};
	}

	//-----------------------Meta-Functions-----------------------

	protected preprocess(): Result{
		if (!this.file) return {success: false, message: "Opened in testing mode."};

		let currentLocation: number = -1; //Sentinel Number
		let codeAllowed: boolean = false; //To restrict code to between .ORIG and .END
		let subroutineMark: boolean = false; //To be able to use the subroutineLocations property properly

		for (let i = 1; i-1 < this.file.lineCount; i++){
			let lineOfText = this.file.lineAt(i-1)
			let txt = lineOfText.text.trim().toLocaleUpperCase();
			let command = txt.split(" ");

			//Ignore Empty Space and Comments
			if (lineOfText.isEmptyOrWhitespace || txt.substring(0, 1) == ";") continue; 

			//The start of routine/subroutine
			if (txt.startsWith(".ORIG ") && command.length == 2){
				if (command.length == 2){
					if (!codeAllowed){
						currentLocation = this.convertNumber(command[1]);
						subroutineMark = true;
						codeAllowed = true;
						if (Number.isNaN(currentLocation)){
							return {success: false, message: "Could not convert number supplied to a valid location in memory.\n(Location must be specified in hex (x))", line: i};
						}else if (currentLocation < 0x3000 || currentLocation > 0xFE00){
							return {success: false, message: "Cannot populate program within system reserved memory\n(Reserved memory [0x0000 -> 0x3000) && (0xFE00 -> 0xFFFF])", line: i};
						}
	
						if (command[1].startsWith("B") || command[1].startsWith("#")) this.emit("warning", {success: false, line: i, message: ".ORIG pseudo ops should provide number in hexdecimal format (x).", context: "Preprocessing Warning"})
					}else{
						return {success: false, message: "Did not specify where previous routine op codes ended. Please use '.end' to specify.", line: i};
					}
				}else{
					return {success: false, line: i, message: "Incorrect amount of parameters given to .ORIG pseudo\n(Format expected: .ORIG x3000)"};
				}
				
				continue;
			}
			
			//End of area where code is allowed
			if (txt.match(/.END\s*/gm)){
				if (codeAllowed){
					codeAllowed = false;
				}else{
					return {success: false, message: ".END missing corresponding .ORIG pseudo-op before it.", line: i};
				}
				
				continue;
			}

			//Variables
			if (txt.match(/\s+.FILL\s+/gm) || txt.match(/\s+.STRINGZ\s+/gm) || txt.match(/\s+.BLKW\s+/gm)){
				//TODO: Create a warning system that informs users of this
				if (codeAllowed) {
					this.emit("warning", {success: false, message: "Please avoid placing .FILL, .STRINGZ, or .BLKW before .END statement.", line: i, context: "Preprocessing Warning"});
				}

				if (currentLocation <= -1) return {success: false, line: i, message: "Don't know where label is labelling."};

				if (command.length < 3) return {success: false, message: ".FILL, .STRINGZ, or .BLKW incorrectly formatted.", line: i};

				if (this.startsWithCommand(txt)) return {success: false, message: "Cannot start .FILL, .STRINGZ, or .BLKW with opcode", line: i};

				if (txt.match(/\s+.FILL\s+/gm)){ //Single Variables
					let numerical = this.convertNumber(command[2]);
					if (Number.isNaN(numerical)) return {success: false, line: i, message: "Number provided is not hex (x), bin (b), or decimal (#)"};

					let ll: LC3Data = { 
						assembly: txt,
						machine: numerical,
						location: {pc: currentLocation, fileIndex: i-1},
					}
	
					this.memory.set(currentLocation, ll);
					this.labelLocations.set(command[0], {pc: currentLocation, fileIndex: i-1});
				} else if (txt.match(/\s+.STRINGZ\s+/gm)){ //Strings
					let ss = command[2].replaceAll(/"/gm, "");
					let ll: LC3Data = {
						assembly: ss.at(0),
						machine: ss.charCodeAt(0),
						location: {pc: currentLocation, fileIndex: i-1},
					}

					//console.log(ss, ll, currentLocation);

					this.memory.set(currentLocation, ll);
					this.labelLocations.set(command[0], {pc: currentLocation, fileIndex: i-1})

					for (let j = 1; j < ss.length; j++){
						currentLocation +=1; //It's fine to put it before hand, because outside the "if" it will increase
						this.memory.set(currentLocation, 
							{
								assembly: ss.at(j),
								machine: ss.charCodeAt(j),
								location: {pc: currentLocation, fileIndex: -1},
							})
					}
					currentLocation += 1;
					this.memory.set(currentLocation, 
						{
							assembly: "\0",
							machine: 0,
							location: {pc: currentLocation, fileIndex: -1},
						}) //Remembering the zero section

				} else if (txt.match(/\s+.BLKW\s+/gm)){ //Array/Blocking
					let ll: LC3Data = {
						assembly: command[0] + " BLKW 0",
						machine: 0,
						location: {pc: currentLocation, fileIndex: i-1},
					}
					
					this.memory.set(currentLocation, ll);
					this.labelLocations.set(command[0], {pc: currentLocation, fileIndex: i-1});

					let total = Number(command[2]);
					if (Number.isNaN(total)) return {success: false, line: i, message: "Could not convert number (NaN err). Do not use any specifiers (x,b,#) as this is implicitly converted from decimal."};

					for (let j = 1; j < Number(command[2]); j++){
						currentLocation += 1;
						this.memory.set(currentLocation, 
							{
								assembly: command[0] + " BLKW " + String(j),
								machine: 0,
								location: {pc: currentLocation, fileIndex:i-1},
							});
					}
				}

				currentLocation += 1;
				continue;
			}

			//Positional Labels
			if (currentLocation > 0x2FFF){
				if (!this.startsWithCommand(txt)){
					if (command.length > 1 && command[1].substring(0, 1) != ";" && this.startsWithCommand(command[1]+" ")){ //If there are opcodes after this label
						this.memory.set(currentLocation, 
							{
								assembly: txt,
								machine: this.convertCommandToMachine(txt),
								location: {pc: currentLocation, fileIndex:i-1},
							});
					}else if (command.length > 1 && command[1].substring(0, 1) != ";"){
						return {success: false, line: i, message: "Positional label properly labeled, but did not understand following command on same line."};
					}

					this.labelLocations.set(command[0], {pc: currentLocation, fileIndex: i-1});
					
					if (command.length > 1 && command[1].substring(0, 1) != ";" && this.startsWithCommand(command[1]+" ")){
						currentLocation += 1
					}
					continue;
				}else if (subroutineMark){ //If this line has a command, and we've just arrived from a .ORIG pseudo
					this.subroutineLocations.set(currentLocation, i);
					subroutineMark = false;
				}
			}else{
				return {success: false, line: i, message: "Missing location to place opcodes at. (.ORIG x3000?)"};
			}
			
			//Otherwise, it's a command/opcode and we just record it into memory
			this.memory.set(currentLocation, 
				{
					assembly: txt,
					machine: this.convertCommandToMachine(txt),
					location: {pc: currentLocation, fileIndex:i-1},
				})

			currentLocation +=1;
		}

		//console.log(this.memory);
		//console.log(this.labelLocations);
		//console.log(this.subroutineLocations);

		return {success: true};
	}

	protected interpretCommand(line: string): Result{
		let manip = line.trim().toLocaleUpperCase();
		if (manip.startsWith(".END")) { return {success: false, message: "Reached End of Program without halting. Forcing an end."}; }
		if (manip.startsWith(".") || manip.startsWith(";") || manip.length <= 0) return {success: true};

		if (!this.startsWithCommand(manip)){
			if (manip.split(" ").length > 1){
				manip = manip.substring(manip.indexOf(" ")+1) //Removes the label (NOTE: for positional labels)	
			}else{
				return {success: true};
			}
		}

		//Run this again incase of Pseudo operator .FILL or .STRINGZ or .BLKW
		if (manip.startsWith(".") || manip.startsWith(";") || manip.length <= 0) return {success: true};

		this.pc++;
		//Macros
		if (manip.match(/\s*GETC\s*/gm)){
			return this.TRAP("TRAP X20");
		}else if (manip.match(/\s*OUT\s*/gm)){
			return this.TRAP("TRAP X21");
		}else if (manip.match(/\s*PUTS\s*/gm)){
			return this.TRAP("TRAP X22");
		}else if (manip.match(/\s*IN\s*/gm)){
			return this.TRAP("TRAP X23");
		}else if (manip.match(/\s*HALT\s*/gm)){
			return this.TRAP("TRAP X25");
		}else if (manip.match(/\s*RET\s*/gm)){
			return this.JMP("JMP R7");
		}

		//Real Opcodes
		//Note: This isn't really scalable, or very easy to work with. But since the opcodes are finite.... it's fine.
		if (manip.startsWith("ADD ")){
			return this.ADD(manip);
		}else if (manip.startsWith("AND ")){
			return this.AND(manip);
		}else if (manip.match(/BR[|NZP]/g)){
			return this.BR(manip);
		}else if (manip.startsWith("JMP ")){
			return this.JMP(manip);
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

	protected ADD(line: string): Result{
		let command  = line.split(" ");
		let destinationS = command[1].substring(1, 2);
		let sourceS = command[2].substring(1, 2);
		let numerical

		if (!command[3].startsWith("R")){
			numerical = this.convertNumber(command[3]);
			if (!this.bitLimit(numerical, 5)){
				return {success: false, message: "IMM does not fit within 5-bit bounds. [-16, 15]"};
			}
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

		this.updateConditionCodes(destIndex);

		return {success: true};
	}

	protected AND(line: string): Result{
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
				numerical = this.registers[temp];
			}else{
				return {success: false, message: "Second Source Register is NaN or out of bounds."}
			}
		}

		if (!this.bitLimit(numerical, 5)){
			return {success: false, message: "IMM does not fit within 5-bit bounds. [-16, 15]"};
		}
		
		this.registers[destIndex] = this.convertToUnsigned(this.registers[sourIndex]) & this.convertToUnsigned(numerical); //Bitwise And

		this.updateConditionCodes(destIndex);

		return {success: true};
	}

	protected BR(line: string): Result{
		let command = line.split(" ");
		
		//Check nzp valid order, watch this:
		let orderCheck = command[0].replace("BR", "").replace("N", "1").replace("Z", "2").replace("P", "3");
		let orderNumerical = Number(orderCheck);
		if (orderNumerical != 123 && orderNumerical != 23 && orderNumerical != 13 && orderNumerical != 12 && orderNumerical > 3){
			return {success: false, message: "Please have proper ordering of condition codes.\n(n before z before p)"};
		} //You know, I thought this would be a clever trick.... not sure anymore....

		let whereTo = this.labelLocations.get(command[1]);
		if (whereTo === undefined){
			return {success: false, message: "Attempting to jump to registered location in memory. Forcing simulation end."};
		}

		let execute = false;
		if ((this.condition_codes["N"] && command[0].indexOf("N") > -1) ||
			(this.condition_codes["Z"] && command[0].indexOf("Z") > -1) ||
			(this.condition_codes["P"] && command[0].indexOf("P") > -1)){
				execute = true;
		}

		if (execute){
			this.pc=whereTo.pc-1;
			this.currentLine=whereTo.fileIndex-1;
		}

		return {success: true};
	}

	protected JMP(line: string): Result{
		let command = line.split(" ");
		let destination = command[1];

		let destIndex = Number(destination.substring(1,2));
		if (!destination.startsWith("R") || Number.isNaN(destIndex) || destIndex < 0 || destIndex > 7){
			return {success: false, message: "First Source Register is NaN or out of bounds."}
		}

		let whereTo:LC3Data | undefined = this.memory.get(this.registers[destIndex]);
		if (whereTo === undefined){
			return {success: false, message: "Attempting to jump to unregistered location in memory. Forcing simulation end."};
		}
		
		this.pc=whereTo.location.pc-1;
		this.currentLine = whereTo.location.fileIndex-1;

		return {success: true};
	}
	
	protected LD(line: string): Result{
		let command = line.split(" ");
		let destinationS = command[1].substring(1, 2);
		
		let registerIndex = Number(destinationS);//Get R#
		if (!command[1].startsWith("R") || Number.isNaN(registerIndex) || registerIndex > 7 || registerIndex < 0){
			return {success: false, message: "Destination Register is NaN or out of bounds."};
		}

		let addr = this.labelLocations.get(command[2]);
		if (!addr){
			return {success: false, message: "Attempted to get locate non-existent label."}
		}
		let numerical = this.memory.get(addr.pc);

		this.registers[registerIndex] = numerical ? numerical.machine : 0;

		this.updateConditionCodes(registerIndex);

		return {success: true};
	}

	protected LDI(line: string): Result{
		//Note: Edit Condition Codes
		return {success: true};
	}

	protected LDR(line: string): Result{
		//Note: Edit Condition Codes
		return {success: true};
	}

	protected LEA(line: string): Result{
		//Note: Edit Condition Codes
		return {success: true};
	}

	protected NOT(line: string): Result{
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

		this.updateConditionCodes(destIndex);

		return {success: true}
	}

	protected TRAP(line: string): Result{
		let command = line.split(" ");
		let numerical = this.convertNumber(command[1].toLocaleUpperCase());

		if (numerical == 0x20){ //GETC: Read one character
			return {success: false, message: "TODO"};
		} else if (numerical == 0x21){ //OUT: Output one character
			return {success: false, message: "TODO"};
		} else if (numerical == 0x22){ //PUTS: Output an entire string to console
			return {success: false, message: "TODO"};
		} else if (numerical == 0x23){ //IN: Read and echo one character
			return {success: false, message: "TODO"};
		} else if (numerical == 0x25){ //HALT: Stop computer
			this.halted = true;
		}

		return {success: true};
	}

	//-----------------------HELPER FUNCTIONS-----------------------

	//Requires All Upper Case input
	protected convertNumber(param: string): number{
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
	protected startsWithCommand(line: string): boolean{
		if (line.startsWith("ADD ")) return true;
		if (line.startsWith("AND ")) return true;

		if (line.match(/BR[|NZP]/g)) return true;
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

	protected removeComment(line: string): string{
		if (line.indexOf(";") >= 0){
			return line.substring(0, line.indexOf(";"));
		}

		return line;
	}

	protected convertCommandToMachine(line: string): number{
		return 0b00;
	}

	protected updateConditionCodes(registerIndex: number){
		if (this.registers[registerIndex] > 0xFFFF || this.registers[registerIndex] < -0xFFFF){
			this.registers[registerIndex] %= 0xFFFF; //Wrap it around
		}

		this.condition_codes["N"] = false;
		this.condition_codes["Z"] = false;
		this.condition_codes["P"] = false;

		if (this.registers[registerIndex] < 0){
			this.condition_codes["N"] = true;
		}else if (this.registers[registerIndex] > 0){
			this.condition_codes["P"] = true;
		}else{
			this.condition_codes["Z"] = true;
		}
	}

	protected bitLimit(n: number, limit:number): boolean{
		let posLim:number = (Math.pow(2, limit-1)) - 1;
		let negLim = -1 * (Math.pow(2, limit-1));
		//console.log(posLim, negLim, n);
		if (n > posLim || n < negLim) return false;

		return true;
	}

	protected convertToUnsigned(n: number): number{
		return n >= 0 ? n : 0xFFFF - n;
	}
}