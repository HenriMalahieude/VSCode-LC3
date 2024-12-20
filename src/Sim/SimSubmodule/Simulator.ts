import * as vscode from 'vscode'
import { EventEmitter } from 'stream';

import { Result, LC3Data, TextFile, Bit16Location, 
	ConvertLC3ToMachine, ConvertToUnsigned, ConvertLC3ToNumber, 
	WithinBitLimit, EmptyLC3Data, instanceOfVSCTextDocument, startsWithCommand } from './LC3Utils'

import { SetSystemMemory } from './SystemMemoryLC3';

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

//You may notice that I am not consistent with my public/private/protected... this just makes my life easier
export class LC3Simulator extends EventEmitter{
	status: Result = {success: true};
	halted: boolean = false;

	registers: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
	protected condition_codes = {"N": false, "Z": true, "P": false};
	memory: Map<number, LC3Data>;
	pc: number = 0x2FFF; //NOTE: Know that this is not "really" the PC since it tracks the last command instead of the next
	psr: number = 0x8002; //[15] = Privelege, [2:0] = NZP
	mcr: number = 0x8000; //Located at 0xFFFE, used externally
	mcc: number = 0; //Located at 0xFFFF

	file: TextFile | undefined;
	currentLine: number = -1;
	protected processed: boolean = false;

	//Map .ORIG x#### locations to file line numbers (for return/jumping/conditionals)
	protected subroutineLocations: Map<number, number>; //NOTE: May be possible to delete

	//Map Labels to locations in memory
	protected labelLocations: Map<string, Bit16Location>; //For variables, all the way to positional labels

	protected recursionLimit: number = 10000;
	protected runRecursionMultiplier: number = 10; //When you click run

	//Debug control
	protected breakpoints: number[] = [];
	protected jumpStack: number[] = []; //Stack of PCs

	//Output control
	protected stdout: number[] = [];
	protected stdin: number[] = [];
	protected stdinExpect: boolean = false; //Is true if stdin is expected and stdin is currently empty

	constructor(f: TextFile | undefined){
		super();
		//Initialize the machine
		this.memory = new Map<number, LC3Data>(); //Potentially get a file to pre-load system memory into here

		//Initialize the Object
		if (f) this.file = f;
		this.subroutineLocations = new Map<number, number>();
		this.labelLocations = new Map<string, Bit16Location>();

		if (f){
			SetSystemMemory(this.memory);
		}

		this.EventConnect();
	}

	public InitializeSimulator(){
		if (this.halted || this.processed) return;

		this.status = this.preprocess(undefined);
		if (!this.status.success){
			this.halted = true;
			this.status.context = "Preprocessing"
		}

		this.processed = true;
	}

	private EventConnect(){
		this.on("stdin update", () => {
			this.stdinExpect = false;
		})
	}
	//-----------------------Public Functions for Simulator Control-----------------------

	public getCurrentLine(): number{
		return this.currentLine+1;
	}

	public getNextStdOut(): number | undefined {
		return this.stdout.shift();
	}

	public addNextStdIn(item: number){
		this.stdin.push(item);
		this.stdinExpect = false;
	}

	public isExpectingInput(): boolean{
		return this.stdinExpect;
	}

	public getCurrentInstruction(offset:number = 0): string{
		if (!this.file || (this.currentLine + offset >= this.GetTotalLines())) return "";
		let lineString = this.GetLineOfText(this.currentLine + offset);

		return lineString;
	}

	public addBreakpoint(line: number){
		this.breakpoints.push(line - 1);
	}

	public clearBreakpoints(){
		this.breakpoints = [];
	}

	public async stepOver(forward: boolean, pc: number | undefined): Promise<Result>{
		if (!this.status.success || this.halted || !this.file) {return this.status;}

		if (this.GetTotalLines() < this.currentLine) {
			this.status = {success: false, context: "EOF", message: "Reached end of file before halt?", line: this.GetTotalLines()}
			this.halted = true;
			return this.status;
		}
		
		//Two Step Over Modes: Step to Next Command, Step over Whitespace
		let currentText = this.GetLineOfText(Math.max(this.currentLine+1, 0));
		let overWhiteSpace = currentText.startsWith(".") || currentText.startsWith(";") || currentText.length <= 0;
		if ((pc == undefined && !overWhiteSpace) || pc != undefined){ //We need to skip to the next command
			let nextPc = (pc != undefined) ? pc : (this.pc + 1); //Note where we need to stop
			for (let i = 0; i < this.recursionLimit; i++){ //Now keep going until recursion limit is reached or.... until we find the PC
				this.currentLine++;

				//First pass for break points
				//Check that we aren't stepping from a breakpoint
				if (this.onBreakpoint() && i > 0){
					this.currentLine--;
					return {success: true};
				}

				let commandToInterpret = this.GetLineOfText(this.currentLine);

				let state = await this.interpretCommand(commandToInterpret);
				if (!state.success){
					state.line = this.currentLine+1;
					state.context = "Runtime"
					this.status = state;
					this.halted = true;
					return state;
				}

				//Detect if it's RET or JMP, remove any labels in front
				if (commandToInterpret.split(" ").length <= 1 && !startsWithCommand(commandToInterpret)){
					commandToInterpret = commandToInterpret.substring(commandToInterpret.indexOf(" ") + 1)
				}
				if (commandToInterpret.startsWith("JMP ") || commandToInterpret.search(/RET\b/gm) == 0){
					//Stop Here:
					return {success: true};
				}

				//We've located the command we need to stop on, therefore find next command
				if (this.pc == nextPc){
					for (let i = this.currentLine+1; i < this.GetTotalLines(); i++){
						this.currentLine = i;

						//If the whitespace were gonna skip is a breakpoint or not
						if (this.onBreakpoint()){ 
							this.currentLine--;
							return state;
						}

						currentText = this.GetLineOfText(Math.max(this.currentLine, 0));
						if (!currentText.startsWith(".") && !currentText.startsWith(";") && currentText.length > 0){
							this.currentLine--;
							return state;
						}
					}
					return {success: false, message: "Reached end of file before halt? (2)"};
				}

				//Check that we havent just ended the program
				if (this.status.success && this.halted) return {success: true};
			}
		}else{ 
			//Just skip over the white space until the next command, it's fine to skip breakpoints here
			for (let i = this.currentLine+1; i < this.GetTotalLines(); i++){
				this.currentLine = i;
				currentText = this.GetLineOfText(Math.max(this.currentLine, 0)); //can't reuse the old because of new currentLine
				if (!currentText.startsWith(".") && !currentText.startsWith(";") && currentText.length > 0) {
					this.currentLine--;
					return {success: true}
				}
			}
		}

		return {success: false, message: "Recursion limit reached.", line: this.currentLine+1, context: "Runtime"};
	}

	public async stepIn(forward: boolean): Promise<Result>{
		if (!this.status.success || this.halted || !this.file) {return this.status;}

		if (this.GetTotalLines() < this.currentLine) {
			this.status = {success: false, context: "EOF", message: "Reached end of file before halt?", line: this.GetTotalLines()}
			this.halted = true;
			return this.status;
		}

		this.currentLine += 1;

		let succ = await this.interpretCommand(this.GetLineOfText(this.currentLine));
		if (!succ.success){
			succ.line = this.currentLine+1; //translating from 0-index to 1-index
			succ.context = "Runtime"
			this.status = succ;
			this.halted = true;
		}

		return succ;
	}

	public async stepOut(forward: boolean): Promise<Result>{
		if (!this.status.success || this.halted) {return this.status;}

		//Detect if this command is part of a subroutine
		for (let i = 0; i < this.recursionLimit; i++){
			let oldStackCount = this.jumpStack.length;

			let stat = await this.stepIn(true);

			if (!stat.success){
				return stat;
			}

			if (oldStackCount > this.jumpStack.length){
				return {success: true};
			}

			//NOTE: Maybe add in breakpoints?
		}

		return {success: false, message: "Could not locate ", line: this.currentLine, context: "Runtime"};
	}

	public async run(): Promise<Result>{
		if (!this.status.success || this.halted || !this.file) {return this.status;}

		for (let i = 0; i < this.recursionLimit * this.runRecursionMultiplier; i++){
			this.currentLine += 1;

			//Check that we aren't "starting up" from a breakpoint
			//However if we aren't then stop ofc
			if (this.onBreakpoint() && i > 0){
				this.currentLine--;
				return {success: true};
			}

			let state = await this.interpretCommand(this.GetLineOfText(this.currentLine));
			if (!state.success){
				state.line = this.currentLine+1;
				state.context = "Runtime";
				this.status = state;
				this.halted = true;
				return state;
			}

			if (this.halted){
				return {success: true};
			}

			if (this.GetTotalLines() < this.currentLine) {
				this.status = {success: false, context: "EOF", message: "Reached end of file before halt?", line: this.GetTotalLines()};
				this.halted = true;
				return this.status;
			}
		}

		return {
			success: false, 
			message: "Reached recursion limit of run. You may have an infinite loop in your code.\n(Intended Behavior? Try adding breakpoints to reset recursion limit.)", 
			context: "Runtime", 
			line: this.currentLine + 1
		};
	}

	//-----------------------Meta-Functions-----------------------

	protected preprocess(testingFile: string[] | undefined): Result{
		if (this.file == undefined && testingFile == undefined) return {success: false, message: "Opened in testing mode without testing file."};
		
		if (testingFile){
			this.file = testingFile;
		}

		let currentLocation: number = -1; //Sentinel Number
		let codeAllowed: boolean = false; //To restrict code to between .ORIG and .END
		let subroutineMark: boolean = false; //To be able to use the subroutineLocations property properly

		let max:number = this.GetTotalLines();

		//First pass for labels/symbols
		for (let i = 1; i-1 < max; i++){
			let unformattedTxt = this.GetLineOfText(i-1);
			let txt = unformattedTxt.trim().toLocaleUpperCase();
			let command = txt.split(" ");
			//Ignore Empty Space and Comments
			if (txt.search("^\s*$") > -1 || txt.substring(0, 1) == ";") continue; 

			//The start of routine/subroutine
			if (txt.startsWith(".ORIG ") && command.length == 2){
				if (command.length == 2){
					if (!codeAllowed){
						currentLocation = ConvertLC3ToNumber(command[1]);
						if (currentLocation < this.pc){
							this.pc = currentLocation - 1;
							this.currentLine = i-1;
						}

						subroutineMark = true;
						codeAllowed = true;
						if (Number.isNaN(currentLocation)){
							return {success: false, message: "Could not convert number supplied to a valid location in memory.\n(Location must be specified in hex (x))", line: i};
						}else if (currentLocation < 0x3000 || currentLocation >= 0xFE00){
							return {success: false, message: "Cannot populate program within system reserved memory\n(Reserved memory [0x0000, 0x3000) && [0xFE00, 0xFFFF])", line: i};
						}
	
						if (command[1].startsWith("B") || command[1].startsWith("#")) this.warn({success: false, line: i, message: ".ORIG pseudo ops should provide number in hexadecimal format (x).", context: "Preprocessing Warning"})
					}else{
						return {success: false, message: "Did not specify where previous routine op codes ended. Please use '.end' to specify end before another '.orig'.", line: i};
					}
				}else{
					return {success: false, line: i, message: "Incorrect amount of parameters given to .ORIG pseudo\n(Format expected: .ORIG x3000)"};
				}
				
				continue;
			}
			
			//End of area where code is allowed
			if (txt.match(/\.END\s*/gm) && txt.indexOf(".END") == 0){
				if (codeAllowed){
					codeAllowed = false;
				}else{
					return {success: false, message: ".END missing corresponding .ORIG pseudo-op before it.", line: i};
				}
				
				continue;
			}

			//Variables
			if (txt.match(/\s.FILL\s+/gm) || txt.match(/\s.STRINGZ\s+/gm) || txt.match(/\s.BLKW\s+/gm)){
				if (!codeAllowed) return {success: false, message: "Cannot determine address. (Avoid placing .FILL, .STRINGZ, or .BLKW after .END statement)", line: i};

				if (currentLocation <= -1) return {success: false, line: i, message: "Don't know where label is labelling."};

				if (command.length < 3) return {success: false, message: ".FILL, .STRINGZ, or .BLKW incorrectly formatted.", line: i};

				if (startsWithCommand(txt)) return {success: false, message: "Cannot start .FILL, .STRINGZ, or .BLKW with opcode", line: i};

				if (txt.match(/\s.FILL\s+/gm)){ //Single Variables
					let numerical = ConvertLC3ToNumber(command[2]);
					if (Number.isNaN(numerical)) return {success: false, line: i, message: "Number provided is not hex (x), bin (b), or decimal (#)"};

					let ll: LC3Data = { 
						assembly: txt,
						machine: numerical,
						location: {pc: currentLocation, fileIndex: i-1},
					}
	
					this.memory.set(currentLocation, ll);
					this.labelLocations.set(command[0], {pc: currentLocation, fileIndex: i-1});
				} else if (txt.match(/\s.STRINGZ\s+/gm)){ //Strings
					let ss = unformattedTxt.split("\"")[1].replaceAll(/"/gm, "");
					let ll: LC3Data = {
						assembly: ss.at(0),
						machine: ss.charCodeAt(0),
						location: {pc: currentLocation, fileIndex: i-1},
					}

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

				} else if (txt.match(/\s.BLKW\s+/gm)){ //Array/Blocking
					let ll: LC3Data = {
						assembly: command[0] + " BLKW 0",
						machine: 0,
						location: {pc: currentLocation, fileIndex: i-1},
					}
					
					this.memory.set(currentLocation, ll);
					this.labelLocations.set(command[0], {pc: currentLocation, fileIndex: i-1});

					let total = ConvertLC3ToNumber(command[2]);
					if (Number.isNaN(total)) return {success: false, line: i, message: "Could not convert number (NaN err). Missing (b, x, #) number specifier."};

					for (let j = 1; j < total; j++){
						currentLocation += 1;
						this.memory.set(currentLocation, 
							{
								assembly: command[0] + " BLKW " + String(j),
								machine: 0,
								location: {pc: currentLocation, fileIndex:i-1},
							});
					}
				}

				if (!codeAllowed) return {success: false, message: "No longer allowing code, yet have code?", line: i};

				currentLocation += 1;
				
				continue;
			}

			//Positional Labels
			if (currentLocation > 0x2FFF){
				if (!startsWithCommand(txt)){
					if (command.length > 1 && command[1].substring(0, 1) != ";" && startsWithCommand(command[1]+" ")){ //If there are opcodes after this label
						/*this.memory.set(currentLocation, 
							{
								assembly: txt,
								machine: ConvertLC3ToMachine(txt, currentLocation),
								location: {pc: currentLocation, fileIndex:i-1},
							});//*/ //NOTE: I've decided to move where we mark commands
					}else if (command.length > 1 && command[1].substring(0, 1) != ";"){
						return {success: false, line: i, message: "Positional label properly labeled, but did not understand following command on same line."};
					}

					this.labelLocations.set(command[0], {pc: currentLocation, fileIndex: i-1});
					
					if (command.length > 1 && command[1].substring(0, 1) != ";" && startsWithCommand(command[1]+" ")){
						currentLocation += 1
					}
					continue;
				}else if (subroutineMark){ //If this line has a command, and we've just arrived from a .ORIG pseudo
					this.subroutineLocations.set(currentLocation, i);
					subroutineMark = false;
				}
			}else{
				return {success: false, line: i, message: "Missing location for label reference at.\n(.ORIG x3000?)"};
			}

			//Otherwise, it's a command/opcode and we just record it into memory in the later loop
			currentLocation +=1;
		}

		if (codeAllowed) return {success: false, message: "Did not end program properly.\n(Did you remember to put a .END pseudo at the end?)"}

		//Reload so we then mark all opcodes into memory
		codeAllowed = false;
		currentLocation = -1;
		subroutineMark = false;

		//Second Pass for opcodes/syntax
		for (let i = 1; i-1 < max; i++){
			let unformattedTxt = this.GetLineOfText(i-1);
			let txt = unformattedTxt.trim().toLocaleUpperCase();
			let command = txt.split(" ");

			//Ignore Empty Space and Comments
			if (txt.search("^\s*$") > -1 || txt.substring(0, 1) == ";") continue;

			if (txt.startsWith(".ORIG ")){
				currentLocation = ConvertLC3ToNumber(command[1]);
				subroutineMark = true;
				codeAllowed = true;

				continue;
			}

			if (txt.match(/\.END\s*/gm) && txt.startsWith(".END")){
				codeAllowed = false;

				continue;
			}

			if (!startsWithCommand(txt) ){ //Perhaps Positional Label
				command.shift();

				if (!startsWithCommand(command[0]+" ") || command.length <= 0){ //Catching anything
					//if (codeAllowed) currentLocation++;
					continue;
				}

				txt = txt.substring(txt.indexOf(" ")+1); //For proper assembly setting
			}
			
			let entry: LC3Data = {
				assembly: txt,
				location: {pc: currentLocation, fileIndex: i-1},
				machine: ConvertLC3ToMachine(currentLocation, this.labelLocations, command[0], command.at(1), command.at(2), command.at(3))
			}
			
			if (Number.isNaN(entry.machine)) return {success: false, message: "Could not convert assembly into machine code (binary)?", line: i};

			this.memory.set(currentLocation, entry)

			if (codeAllowed) currentLocation++;
		}

		return {success: true};
	}

	protected async interpretCommand(line: string): Promise<Result>{
		let manip = line.trim().toLocaleUpperCase();
		if (manip.startsWith(".END")) { return {success: false, message: "Reached End of Program without halting. Forcing an end."}; }
		if (manip.startsWith(".") || manip.startsWith(";") || manip.length <= 0) return {success: true};

		if (!startsWithCommand(manip)){
			if (manip.split(" ").length > 1){
				manip = manip.substring(manip.indexOf(" ")+1) //Removes the label (NOTE: for positional labels)	
			}else{
				return {success: true};
			}
		}

		//Run this again incase of Pseudo operator .FILL or .STRINGZ or .BLKW
		if (manip.startsWith(".")) return {success: false, message: "Reached a pseudo-op. Preventing undefined behavior, forcing simulation end."};
		if (manip.startsWith(";") || manip.length <= 0) return {success: true};

		this.pc++;
		this.IncrementMCC();
		this.UpdatePSR();

		//Safety checks in case they add lines or change anything
		let memEntry = this.memory.get(this.pc);
		//NOTE: If we wanna remove this, we can just have the "Variable Set Function" run preprocess again, and then set the PC and fileIndex there
		if (memEntry == undefined){ 
			return {
				success: false, 
				message: "Line of Code was not detected in memory.\n(Did you add a line during simulation? Preprocessor didn't catch it, try restarting debugger before running the line.)", 
				line: this.currentLine+1
			};
		}else if (memEntry.assembly != manip){
			return {
				success: false,
				message: "Line of Code did not match memory.\n(Did you change something during simulation? Preprocessor didn't catch it, try restarting debugger before running the line.)",
				line: this.currentLine+1
			}
		} //TODO: Ensure that machine is still the same for these commands

		//Macros
		if (manip.match(/\s*GETC\s*/gm) && manip.startsWith("GETC")){
			return await this.TRAP("TRAP X20");
		}else if (manip.match(/\s*OUT\s*/gm) && manip.startsWith("OUT")){
			return await this.TRAP("TRAP X21");
		}else if (manip.match(/\s*PUTS\s*/gm) && manip.startsWith("PUTS")){
			return await this.TRAP("TRAP X22");
		}else if (manip.match(/\s*IN\s*/gm) && manip.startsWith("IN")){
			return await this.TRAP("TRAP X23");
		}else if (manip.match(/\s*HALT\s*/gm) && manip.startsWith("HALT")){
			return await this.TRAP("TRAP X25");
		}else if (manip.match(/\s*RET\s*/gm) && manip.startsWith("RET")){
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
			return this.JSR(manip);
		}else if (manip.startsWith("JSRR ")){
			return this.JSRR(manip);
		}else if (manip.startsWith("LD ")){
			return this.LD(manip);
		}else if (manip.startsWith("LDI ")){
			return this.LDI(manip);
		}else if (manip.startsWith("LDR ")){
			return this.LDR(manip);
		}else if (manip.startsWith("LEA ")){
			return this.LEA(manip);
		}else if (manip.startsWith("NOT ")){
			return this.NOT(manip);
		}else if (manip.search(/\bRTI\b/gm) != -1){
			return {success: false, message: "Simulator does not simulate System Memory."};
		}else if (manip.startsWith("ST ")){
			return this.ST(manip);
		}else if (manip.startsWith("STI ")){
			return this.STI(manip);
		}else if (manip.startsWith("STR ")){
			return this.STR(manip);
		}else if (manip.startsWith("TRAP ")){
			return await this.TRAP(manip);
		}

		return {success: false, message: "Couldn't understand line. Is that a valid OPCode?"};
	}

	//-----------------------ALL THE OPCODES-----------------------

	protected ADD(line: string): Result{
		let command  = line.split(" ");
		let destinationS = command[1].substring(1, 2);
		let sourceS = command[2].substring(1, 2);
		let numerical;

		if (!command[3].startsWith("R")){
			numerical = ConvertLC3ToNumber(command[3]);

			if (Number.isNaN(numerical)){
				return {success: false, message: "Number not given proper hexadecimal (x) or decimal (#) or binary (b) flag"}
			}

			if (!WithinBitLimit(numerical, 5)){
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

		if (!command[1].startsWith("R") || Number.isNaN(destIndex) || destIndex < 0 || destIndex > 7){
			return {success: false, message: "Destination Register is NaN or out of bounds."}
		}

		if (!command[2].startsWith("R") || Number.isNaN(sourIndex) || sourIndex < 0 || sourIndex > 7){
			return {success: false, message: "First Source Register is NaN or out of bounds."}
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
			numerical = ConvertLC3ToNumber(command[3]);
			if (Number.isNaN(numerical)){
				return {success: false, message: "Number not given proper hexadecimal (x) or decimal (#) or binary (b) flag."}
			}

			if (!WithinBitLimit(numerical, 5)){
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

		if (!command[1].startsWith("R") || Number.isNaN(destIndex) || destIndex < 0 || destIndex > 7){
			return {success: false, message: "Destination Register is NaN or out of bounds."}
		}

		if (!command[2].startsWith("R") || Number.isNaN(sourIndex) || sourIndex < 0 || sourIndex > 7){
			return {success: false, message: "First Source Register is NaN or out of bounds."}
		}
		
		this.registers[destIndex] = ConvertToUnsigned(this.registers[sourIndex]) & ConvertToUnsigned(numerical); //Bitwise And

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
		if (whereTo === undefined || whereTo.location.pc < 0x3000 || whereTo.location.pc >= 0xFE00){
			return {success: false, message: "Attempting to jump to unregistered location in memory or system memory. Forcing simulation end."};
		}

		//In case we are returning from anything
		if (this.jumpStack.length > 0){
			let lastElement = this.jumpStack.pop();
			if (lastElement != undefined && whereTo.location.pc != lastElement){
				this.jumpStack.push(lastElement);
			}
		}

		this.pc=whereTo.location.pc-1;
		this.currentLine = whereTo.location.fileIndex-1;

		return {success: true};
	}

	protected JSR(line: string): Result{
		let command = line.split(" ");
		let destination = command[1];

		let loc = this.labelLocations.get(destination);
		if (loc == undefined || loc.pc < 0x3000 || loc.pc >= 0xFE00){
			return {success: false, message: "Attempting to jump to unregistered location in memory or system memory. Forcing simulation end."};
		}

		if (!WithinBitLimit(loc.pc - this.pc, 11)) return {success: false, message: "Label does not fit within 11 bit limit.\n[-1024, 1023]"};

		let savePc = this.pc+1;
		this.registers[7] = savePc;

		this.jumpStack.push(savePc);

		this.pc = loc.pc-1;
		this.currentLine = loc.fileIndex-1;

		return {success: true}
	}

	protected JSRR(line: string): Result{
		let command = line.split(" ");
		let destinationS = command[1].substring(1, 2);

		let destIndex = Number(destinationS);
		if (!command[1].startsWith("R") || Number.isNaN(destIndex) || destIndex < 0 || destIndex > 7){
			return {success: false, message: "First Source Register is NaN or out of bounds."}
		}

		let addr = this.registers[destIndex];
		if (addr >= 0xFE00 || addr < 0x3000){
			return {success: false, message: "Attempting to jump to system reserved memory without System Priviliges. Forcing simulation end."};
		}

		let whereTo = this.memory.get(addr);
		if (whereTo == undefined || whereTo.location.fileIndex < 0){
			return {success: false, message: "Attempting to jump to unregistered location in memory. Forcing simulation end."};
		}

		let savePc = this.pc+1;
		this.registers[7] = savePc;
		this.jumpStack.push(savePc);

		this.pc = whereTo.location.pc-1;
		this.currentLine = whereTo.location.fileIndex-1;

		return {success: true}
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
			return {success: false, message: "Attempted to locate non-existent label."}
		}

		if (!WithinBitLimit(addr.pc - this.pc, 9)) return {success: false, message: "Label is too far away.\n(Label must be in a 9 bit two's complement range from LD [-256, 255])"};

		let numerical = this.memory.get(addr.pc);

		this.registers[registerIndex] = numerical ? numerical.machine : 0;

		this.updateConditionCodes(registerIndex);

		return {success: true};
	}

	protected LDI(line: string): Result{
		let command = line.split(" ");
		let destinationS = command[1].substring(1, 2);

		let registerIndex = Number(destinationS);//Get R#
		if (!command[1].startsWith("R") || Number.isNaN(registerIndex) || registerIndex > 7 || registerIndex < 0){
			return {success: false, message: "Destination Register is NaN or out of bounds."};
		}

		let whereTo = this.removeComment(command[2]);
		let loc = this.labelLocations.get(whereTo)
		let numerical:number = 0xffff + 1;
		
		if (loc != undefined){

			if (!WithinBitLimit(loc.pc - this.pc, 9)) return {success: false, message: "Label is too far away.\n(Label must be in a 9 bit two's complement range from LDI [-256, 255])"};

			let data = this.memory.get(loc.pc)

			if (data != undefined){
				if (data.machine > 0xFFE0 || data.machine < 0x3000) return {success: false, message: "Attempted to load system reserved memory."};

				let savedAddr = data.machine
				data = this.memory.get(savedAddr);

				if (data != undefined){
					numerical = data.machine;
				}else{
					numerical = 0;
					this.warn({success: false, line: this.currentLine+1, context: "Runtime Warning", message: "Attempted to load undefined memory. Defining to zero."});
					this.memory.set(savedAddr, {assembly: "", machine: 0, location: {pc: savedAddr, fileIndex: -1}});
				}
			}else{
				return {success: false, message: "Label not registered in memory, but registered in system?"};
			}
		}else{
			return {success: false, message: "Attempted to use an unregistered label location."};
		}

		this.registers[registerIndex] = numerical;
		this.updateConditionCodes(registerIndex);

		return {success: true};
	}

	protected LDR(line: string): Result{
		let command = line.split(" ");
		let destinationS1 = command[1].substring(1, 2);
		let destinationS2 = command[2].substring(1, 2);

		let registerIndex1 = Number(destinationS1);//Get R#
		if (!command[1].startsWith("R") || Number.isNaN(registerIndex1) || registerIndex1 > 7 || registerIndex1 < 0){
			return {success: false, message: "Destination Register is NaN or out of bounds."};
		}

		let registerIndex2 = Number(destinationS2);
		if (!command[2].startsWith("R") || Number.isNaN(registerIndex2) || registerIndex2 > 7 || registerIndex2 < 0){
			return {success: false, message: "Source Register is NaN or out of bounds."};
		}

		let numerical = ConvertLC3ToNumber(command[3]);
		if (!WithinBitLimit(numerical, 6)) return {success: false, message: "Offset not within 6 bit limit\n[-32, 31]"};
		
		let address = this.registers[registerIndex2] + numerical;
		if (address < 0x3000 || address >= 0xFE00) return {success: false, message: "Attempted to load system reserved memory."};

		let data = this.memory.get(address);
		if (!data) {
			data = EmptyLC3Data();
			data.machine = 0;
			this.memory.set(address, {assembly: "", machine: 0, location: {pc: address, fileIndex: -1}});
			this.warn({success: false, line: this.currentLine+1, context: "Runtime Warning", message: "Attempted to load undefined memory. Defining to zero."});
		}

		this.registers[registerIndex1] = data.machine;
		this.updateConditionCodes(registerIndex1);

		return {success: true};
	}

	protected LEA(line: string): Result{
		let command = line.split(" ");
		let destinationS = command[1].substring(1, 2);

		let registerIndex = Number(destinationS);//Get R#
		if (!command[1].startsWith("R") || Number.isNaN(registerIndex) || registerIndex > 7 || registerIndex < 0){
			return {success: false, message: "Destination Register is NaN or out of bounds."};
		}

		let whereTo = this.removeComment(command[2]);
		let loc = this.labelLocations.get(whereTo)
		let numerical:number = 0;
		if (loc != undefined){
			numerical = loc.pc;
		}else{
			return {success: false, message: "Attempted to use an unregistered label location."};
		}

		if (!WithinBitLimit(loc.pc - this.pc, 9)) return {success: false, message: "Label is too far away.\n(Label must be in a 9 bit two's complement range from LEA [-256, 255])"};

		this.registers[registerIndex] = numerical;
		this.updateConditionCodes(registerIndex);

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

		return {success: true};
	}

	protected ST(line: string): Result{
		let command = line.split(" ");
		let destinationS = command[1].substring(1, 2);
		
		let registerIndex = Number(destinationS);//Get R#
		if (!command[1].startsWith("R") || Number.isNaN(registerIndex) || registerIndex > 7 || registerIndex < 0){
			return {success: false, message: "Source Register is NaN or out of bounds."};
		}

		let addr = this.labelLocations.get(command[2]);
		if (!addr){
			return {success: false, message: "Attempted to locate non-existent label."}
		}

		if (!WithinBitLimit(addr.pc - this.pc, 9)) return {success: false, message: "Label is too far away.\n(Label must be in a 9 bit two's complement range from ST [-256, 255])"};

		let data: LC3Data | undefined = this.memory.get(addr.pc);
		if (data == undefined){
			data = EmptyLC3Data();
			this.memory.set(addr.pc, {assembly: "", machine: 0, location: addr});
			this.warn({success: false, line: this.currentLine+1, context: "Runtime Warning", message: "Attempted to load undefined memory. Defining to zero."});
		}

		data.machine = this.registers[registerIndex];
		this.memory.set(addr.pc, data);

		return {success: true};
	}

	protected STI(line: string): Result{
		let command = line.split(" ");
		let destinationS = command[1].substring(1, 2);
		
		let registerIndex = Number(destinationS);//Get R#
		if (!command[1].startsWith("R") || Number.isNaN(registerIndex) || registerIndex > 7 || registerIndex < 0){
			return {success: false, message: "Destination Register is NaN or out of bounds."};
		}

		let addr = this.labelLocations.get(command[2]);
		if (!addr){
			return {success: false, message: "Attempted to locate non-existent label."}
		}

		if (!WithinBitLimit(addr.pc - this.pc, 9)) return {success: false, message: "Label is too far away.\n(Label must be in a 9 bit two's complement range from LD [-256, 255])"};

		let data: LC3Data | undefined = this.memory.get(addr.pc);
		if (data == undefined){
			return {success: false, message: "Attempted to use 0x0000 as pointer/address.\n(Is that memory location registered?)"};
		}

		let savedAddr = data.machine
		data = this.memory.get(savedAddr);

		if (data == undefined){
			data = EmptyLC3Data();
			this.memory.set(savedAddr, {assembly: "", machine: 0, location: {pc: savedAddr, fileIndex: -1}});
			this.warn({success: false, line: this.currentLine+1, context: "Runtime Warning", message: "Attempted to load undefined memory. Defining to zero."});
		}

		data.machine = this.registers[registerIndex];
		this.memory.set(savedAddr, data);

		return {success: true};
	}

	protected STR(line: string): Result{
		let command = line.split(" ");
		let sourceS = command[1].substring(1, 2);
		let destinationS2 = command[2].substring(1, 2);

		let registerIndex1 = Number(sourceS);//Get R#
		if (!command[1].startsWith("R") || Number.isNaN(registerIndex1) || registerIndex1 > 7 || registerIndex1 < 0){
			return {success: false, message: "Source Register is NaN or out of bounds."};
		}

		let registerIndex2 = Number(destinationS2);
		if (!command[2].startsWith("R") || Number.isNaN(registerIndex2) || registerIndex2 > 7 || registerIndex2 < 0){
			return {success: false, message: "Destination Register is NaN or out of bounds."};
		}

		let numerical = ConvertLC3ToNumber(command[3]);
		if (!WithinBitLimit(numerical, 6)) return {success: false, message: "Offset not within 6 bit limit\n[-32, 31]"};
		
		let address = this.registers[registerIndex2] + numerical;
		if (address < 0x3000 || address >= 0xFE00) return {success: false, message: "Attempted to set system reserved memory."};

		let data = this.memory.get(address);
		if (data == undefined){
			data = EmptyLC3Data();
			this.memory.set(address, {assembly: "", machine: this.registers[registerIndex1], location: {pc: address, fileIndex: -1}});
			//this.warn({success: false, line: this.currentLine+1, context: "Runtime Warning", message: "Attempted to load undefined memory. Defining to zero."});
		}

		data.machine = this.registers[registerIndex1];
		this.memory.set(address, data);
		
		return {success: true};
	}

	protected async TRAP(line: string): Promise<Result>{
		const waitCount: number = 250;
		let command = line.split(" ");
		let numerical = ConvertLC3ToNumber(command[1].toLocaleUpperCase());

		if (numerical == 0x20){ //GETC: Read one character
			let v = this.stdin.at(0);

			if (v == undefined) this.emit("stdin");

			while (v == undefined){
				this.stdinExpect = true;
				await sleep(waitCount);
				v = this.stdin.at(0);
			}

			this.registers[0] = v;
			this.stdin.shift();
			
			this.stdinExpect = false;
		} else if (numerical == 0x21){ //OUT: Output one character
			this.stdout.push(this.registers[0]);
		} else if (numerical == 0x22){ //PUTS: Output an entire string to console
			for (let i = 0; i < 250; i++){
				let out = this.memory.get(this.registers[0] + i);
				
				if (out == undefined) return {success: false, message: "Attempted to PUTS invalid information. Halting simulation."};
				
				this.stdout.push(out.machine);
				
				if (out.machine == 0){
					return {success: true};
				}
			}
			return {success: false, message: "Reached PUTS string size limit (250). Halting Simulation"};
		} else if (numerical == 0x23){ //IN: Read and echo one character
			let v = this.stdin.at(0);
			if (v == undefined) this.emit("stdin");

			while (v == undefined){
				this.stdinExpect = true;
				await sleep(waitCount);
				v = this.stdin.at(0);
			}

			this.stdout.push(v);
			this.registers[0] = v;
			this.stdin.shift();

			this.stdinExpect = false;
		} else if (numerical == 0x25){ //HALT: Stop computer
			this.halted = true;

			let haltString = "\n------- Halting the LC-3 Simulator -------\n";
			//this.stdout.push('\n'.charCodeAt(0));
			for (let i = 0; i < haltString.length; i++){
				this.stdout.push(haltString.charCodeAt(i));
			}
		} else {
			return {success: false, message: "Unknown trap vector. Ending simulation."};
		}

		return {success: true};
	}

	//-----------------------HELPER FUNCTIONS-----------------------

	protected removeComment(line: string): string{
		if (line.indexOf(";") >= 0){
			return line.substring(0, line.indexOf(";"));
		}

		return line;
	}

	protected updateConditionCodes(registerIndex: number){
		if (this.registers[registerIndex] > 0xFFFF || this.registers[registerIndex] < -0x7FFF){
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

	protected warn(r: Result){
		this.emit("warning", r);
	}

	protected IncrementMCC(){
		this.mcc++;
		let entry = EmptyLC3Data();
		entry.machine = this.mcc;

		this.memory.set(0xFFFF, entry)
		//No need to assign MCR, because it'll always be zero
	}

	protected UpdatePSR(){
		this.psr = 0x8000; //We will never set the privilege of the system to Supervisor, so this is fine. Nor do we need any Interrupt stuff
		if (this.condition_codes.N) this.psr += 0b100;
		if (this.condition_codes.Z) this.psr += 0b010;
		if (this.condition_codes.P) this.psr += 0b001;
	}

	protected onBreakpoint(offset: number = 0): boolean{
		for (let i = 0; i < this.breakpoints.length; i++){
			if ((this.currentLine + offset) == this.breakpoints[i]){
				return true;
			}
		}

		return false;
	}

	protected GetLineOfText(index: number): string{
		if (this.file == undefined) return "";

		if (instanceOfVSCTextDocument(this.file)){
			return this.file.lineAt(index).text;
		}

		return this.file[index]; 
	}

	protected GetTotalLines(): number{
		if (this.file == undefined) return 0;
		
		if (instanceOfVSCTextDocument(this.file)){
			return this.file.lineCount;
		}

		return this.file.length;
	}
}