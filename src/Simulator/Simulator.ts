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

export function emptyLC3Data(): LC3Data{
	return {
		assembly: "-",
		machine: 0,
		location: {fileIndex: 0, pc: 0x3000},
	}
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

//You may notice that I am not consistent with my public/private/protected... this just makes my life easier
export class LC3Simulator extends EventEmitter{
	status: Result = {success: true};
	halted: boolean = false;

	registers: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
	protected condition_codes = {"N": false, "Z": true, "P": false};
	memory: Map<number, LC3Data>; //TODO: Fill with System Memory
	pc: number = 0x2FFF; //NOTE: Know that this is not "really" the PC since it tracks the last command instead of the next
	psr: number = 0x8002; //[15] = Privelege, [2:0] = NZP
	mcr: number = 0; //Located at 0xFFFE
	mcc: number = 0; //Located at 0xFFFF

	file: vscode.TextDocument | undefined;
	currentLine: number = -1;
	protected processed: boolean = false;

	//Map .ORIG x#### locations to file line numbers (for return/jumping/conditionals)
	protected subroutineLocations: Map<number, number>;

	//Map Labels to locations in memory
	protected labelLocations: Map<string, Bit16Location>; //For variables, all the way to positional labels

	protected recursionLimit: number = 10000;
	protected runRecursionMultiplier: number = 10; //When you click run

	//Debug control
	protected breakpoints: number[] = [];
	protected currentBreakpoint: number | undefined;
	protected jumpStack: number[] = [];

	//Output control
	protected stdout: number[] = [];
	protected stdin: number[] = [];
	protected stdinExpect: boolean = false; //Is true if stdin is expected and stdin is currently empty

	constructor(f: vscode.TextDocument | undefined){
		super();
		//Initialize the machine
		this.memory = new Map<number, LC3Data>(); //Potentially get a file to pre-load system memory into here

		//Initialize the Object
		if (f) this.file = f;
		this.subroutineLocations = new Map<number, number>();
		this.labelLocations = new Map<string, Bit16Location>();

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
		if (!this.file || (this.currentLine + offset >= this.file.lineCount)) return "";
		let lineString = this.file.lineAt(this.currentLine + offset);

		return lineString.text;
	}

	public addBreakpoint(line: number){
		this.breakpoints.push(line - 1);
	}

	public clearBreakpoints(){
		this.breakpoints = [];
		this.currentBreakpoint = undefined;
	}

	//TODO: Have it stop on the next command after a RET
	public async stepOver(forward: boolean, pc: number | undefined): Promise<Result>{
		if (!this.status.success || this.halted || !this.file) {return this.status;}

		if (this.file.lineCount < this.currentLine) {
			this.status = {success: false, context: "EOF", message: "Reached end of file before halt?", line: this.file.lineCount}
			this.halted = true;
			return this.status;
		}
		
		//Two Step Over Modes: Step to Next Command, Step over Whitespace
		let currentText = this.file.lineAt(Math.max(this.currentLine+1, 0)).text;
		let overWhiteSpace = currentText.startsWith(".") || currentText.startsWith(";") || currentText.length <= 0;
		if ((pc == undefined && !overWhiteSpace) || pc != undefined){ //We need to skip to the next command
			let nextPc = (pc != undefined) ? pc : (this.pc + 1); //Note where we need to stop
			for (let i = 0; i < this.recursionLimit; i++){ //Now keep going until recursion limit is reached or.... until we find the PC
				this.currentLine++;

				//First pass for break points
				if (this.onBreakpoint()){
					//Check that we haven't stopped there before, and that we are "recursing"
					if (this.currentBreakpoint != this.currentLine && i > 0){
						this.currentBreakpoint = this.currentLine;
						this.currentLine--;
						return {success: true};
					}

					this.currentBreakpoint = undefined;
				}

				let state = await this.interpretCommand(this.file.lineAt(this.currentLine).text);
				if (!state.success){
					state.line = this.currentLine+1;
					state.context = "Runtime"
					this.status = state;
					this.halted = true;
					return state;
				}

				//We've located the command we need to stop on, therefore find next command
				if (this.pc == nextPc){
					for (let i = this.currentLine+1; i < this.file.lineCount; i++){
						this.currentLine = i;

						//If the whitespace were gonna skip is a breakpoint or not
						if (this.onBreakpoint()){ 
							this.currentLine--;
							return state;
						}

						currentText = this.file.lineAt(Math.max(this.currentLine, 0)).text;
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
			for (let i = this.currentLine+1; i < this.file.lineCount; i++){
				this.currentLine = i;
				currentText = this.file.lineAt(Math.max(this.currentLine, 0)).text; //can't reuse the old because of new currentLine
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

		if (this.file.lineCount < this.currentLine) {
			this.status = {success: false, context: "EOF", message: "Reached end of file before halt?", line: this.file.lineCount}
			this.halted = true;
			return this.status;
		}

		this.currentLine += 1;

		let succ = await this.interpretCommand(this.file.lineAt(this.currentLine).text);
		if (!succ.success){
			succ.line = this.currentLine+1; //translating from 0-index to 1-index
			succ.context = "Runtime"
			this.status = succ;
			this.halted = true;
		}

		this.currentBreakpoint = undefined;

		return succ;
	}

	public async stepOut(forward: boolean): Promise<Result>{
		if (!this.status.success || this.halted) {return this.status;}

		//Detect if this command is part of a subroutine

		//TODO: Make a stack of PCs that this can jump to, only pushed into by JSRR and JSR and JUMP

		return {success: true};
	}

	public async run(): Promise<Result>{
		if (!this.status.success || this.halted || !this.file) {return this.status;}

		this.currentBreakpoint = undefined;

		for (let i = 0; i < this.recursionLimit * this.runRecursionMultiplier; i++){
			this.currentLine += 1;

			//Check that we aren't "starting up" from a breakpoint
			//However if we aren't then stop ofc
			if (this.onBreakpoint() && i > 0){
				return {success: true};
			}

			let state = await this.interpretCommand(this.file.lineAt(this.currentLine).text);
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

			if (this.file.lineCount < this.currentLine) {
				this.status = {success: false, context: "EOF", message: "Reached end of file before halt?", line: this.file.lineCount};
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
		if (!this.file && !testingFile) return {success: false, message: "Opened in testing mode without testing file."};

		let currentLocation: number = -1; //Sentinel Number
		let codeAllowed: boolean = false; //To restrict code to between .ORIG and .END
		let subroutineMark: boolean = false; //To be able to use the subroutineLocations property properly

		let max:number = this.file ? this.file.lineCount : (testingFile ? testingFile.length: -1);

		function getLine(dex:number, file: vscode.TextDocument | undefined, testFile: string[] | undefined): string{
			if (file){
				return file.lineAt(dex).text;
			}else if (testFile){
				return testFile[dex]; 
			}
			return "";
		}

		//First pass for labels/symbols
		for (let i = 1; i-1 < max; i++){
			let unformattedTxt = getLine(i-1, this.file, testingFile);
			let txt = unformattedTxt.trim().toLocaleUpperCase();
			let command = txt.split(" ");
			//Ignore Empty Space and Comments
			if (txt.search("^\s*$") > -1 || txt.substring(0, 1) == ";") continue; 

			//The start of routine/subroutine
			if (txt.startsWith(".ORIG ") && command.length == 2){
				if (command.length == 2){
					if (!codeAllowed){
						currentLocation = this.convertNumber(command[1]);
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

				if (this.startsWithCommand(txt)) return {success: false, message: "Cannot start .FILL, .STRINGZ, or .BLKW with opcode", line: i};

				if (txt.match(/\s.FILL\s+/gm)){ //Single Variables
					let numerical = this.convertNumber(command[2]);
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

					let total = this.convertNumber(command[2]);
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
				if (!this.startsWithCommand(txt)){
					if (command.length > 1 && command[1].substring(0, 1) != ";" && this.startsWithCommand(command[1]+" ")){ //If there are opcodes after this label
						/*this.memory.set(currentLocation, 
							{
								assembly: txt,
								machine: this.convertCommandToMachine(txt, currentLocation),
								location: {pc: currentLocation, fileIndex:i-1},
							});//*/ //NOTE: I've decided to move where we mark commands
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
			let unformattedTxt = getLine(i-1, this.file, testingFile);
			let txt = unformattedTxt.trim().toLocaleUpperCase();
			let command = txt.split(" ");

			//Ignore Empty Space and Comments
			if (txt.search("^\s*$") > -1 || txt.substring(0, 1) == ";") continue;

			if (txt.startsWith(".ORIG ")){
				currentLocation = this.convertNumber(command[1]);
				subroutineMark = true;
				codeAllowed = true;

				continue;
			}

			if (txt.match(/\.END\s*/gm) && txt.startsWith(".END")){
				codeAllowed = false;

				continue;
			}

			if (!this.startsWithCommand(txt) ){ //Perhaps Positional Label
				command.shift();

				if (!this.startsWithCommand(command[0]+" ") || command.length <= 0){ //Catching anything
					//if (codeAllowed) currentLocation++;
					continue;
				}

				txt = txt.substring(txt.indexOf(" ")+1); //For proper assembly setting
			}
			
			let entry: LC3Data = {
				assembly: txt,
				location: {pc: currentLocation, fileIndex: i-1},
				machine: this.convertCommandToMachine(currentLocation, command[0], command.at(1), command.at(2), command.at(3))
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

		if (!this.startsWithCommand(manip)){
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
		}else if (manip.search(/RTI\b/gm) != -1){
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
			numerical = this.convertNumber(command[3]);

			if (Number.isNaN(numerical)){
				return {success: false, message: "Number not given proper hexadecimal (x) or decimal (#) or binary (b) flag"}
			}

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
			numerical = this.convertNumber(command[3]);
			if (Number.isNaN(numerical)){
				return {success: false, message: "Number not given proper hexadecimal (x) or decimal (#) or binary (b) flag."}
			}

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

		if (!command[1].startsWith("R") || Number.isNaN(destIndex) || destIndex < 0 || destIndex > 7){
			return {success: false, message: "Destination Register is NaN or out of bounds."}
		}

		if (!command[2].startsWith("R") || Number.isNaN(sourIndex) || sourIndex < 0 || sourIndex > 7){
			return {success: false, message: "First Source Register is NaN or out of bounds."}
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

	protected JSR(line: string): Result{
		let command = line.split(" ");
		let destination = command[1];

		let loc = this.labelLocations.get(destination);
		if (loc == undefined){
			return {success: false, message: "Attempting to jump to unregistered location in memory. Forcing simulation end."};
		}

		if (!this.bitLimit(loc.pc - this.pc, 11)) return {success: false, message: "Label does not fit within 11 bit limit.\n[-1024, 1023]"};

		let savePc = this.pc+1;
		this.registers[7] = savePc;

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

		if (!this.bitLimit(addr.pc - this.pc, 9)) return {success: false, message: "Label is too far away.\n(Label must be in a 9 bit two's complement range from LD [-256, 255])"};

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

			if (!this.bitLimit(loc.pc - this.pc, 9)) return {success: false, message: "Label is too far away.\n(Label must be in a 9 bit two's complement range from LDI [-256, 255])"};

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

		let numerical = this.convertNumber(command[3]);
		if (!this.bitLimit(numerical, 6)) return {success: false, message: "Offset not within 6 bit limit\n[-32, 31]"};
		
		let address = this.registers[registerIndex2] + numerical;
		if (address < 0x3000 || address >= 0xFE00) return {success: false, message: "Attempted to load system reserved memory."};

		let data = this.memory.get(address);
		if (!data) {
			data = emptyLC3Data();
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

		if (!this.bitLimit(loc.pc - this.pc, 9)) return {success: false, message: "Label is too far away.\n(Label must be in a 9 bit two's complement range from LEA [-256, 255])"};

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

		if (!this.bitLimit(addr.pc - this.pc, 9)) return {success: false, message: "Label is too far away.\n(Label must be in a 9 bit two's complement range from ST [-256, 255])"};

		let data: LC3Data | undefined = this.memory.get(addr.pc);
		if (data == undefined){
			data = emptyLC3Data();
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

		if (!this.bitLimit(addr.pc - this.pc, 9)) return {success: false, message: "Label is too far away.\n(Label must be in a 9 bit two's complement range from LD [-256, 255])"};

		let data: LC3Data | undefined = this.memory.get(addr.pc);
		if (data == undefined){
			return {success: false, message: "Attempted to use 0x0000 as pointer/address.\n(Is that memory location registered?)"};
		}

		let savedAddr = data.machine
		data = this.memory.get(savedAddr);

		if (data == undefined){
			data = emptyLC3Data();
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

		let numerical = this.convertNumber(command[3]);
		if (!this.bitLimit(numerical, 6)) return {success: false, message: "Offset not within 6 bit limit\n[-32, 31]"};
		
		let address = this.registers[registerIndex2] + numerical;
		if (address < 0x3000 || address >= 0xFE00) return {success: false, message: "Attempted to set system reserved memory."};

		let data = this.memory.get(address);
		if (data == undefined){
			data = emptyLC3Data();
			this.memory.set(address, {assembly: "", machine: 0, location: {pc: address, fileIndex: -1}});
			this.warn({success: false, line: this.currentLine+1, context: "Runtime Warning", message: "Attempted to load undefined memory. Defining to zero."});
		}

		data.machine = this.registers[registerIndex1];
		this.memory.set(address, data);
		
		return {success: true};
	}

	protected async TRAP(line: string): Promise<Result>{
		const waitCount: number = 250;
		let command = line.split(" ");
		let numerical = this.convertNumber(command[1].toLocaleUpperCase());

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
		} else {
			return {success: false, message: "Unknown trap vector. Ending simulation."};
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

		if (line.match(/BR[|NZP]/g) && line.startsWith("BR")) return true;
		if (line.startsWith("JMP ")) return true;
		if (line.startsWith("JSR ")) return true;
		if (line.startsWith("JSRR ")) return true;

		if (line.startsWith("LD ")) return true;
		if (line.startsWith("LDI ")) return true;
		if (line.startsWith("LDR ")) return true;
		if (line.startsWith("LEA ")) return true;

		if (line.startsWith("NOT ")) return true;
		if (line.startsWith("RTI ")) return true;
		
		if (line.startsWith("ST ")) return true;
		if (line.startsWith("STI ")) return true;
		if (line.startsWith("STR ")) return true;
		
		if (line.startsWith("TRAP ")) return true;

		if (line.match(/\s*HALT\s*/gm) && line.startsWith("HALT")) return true;
		if (line.match(/\s*PUTS\s*/gm) && line.startsWith("PUTS")) return true;
		if (line.match(/\s*GETC\s*/gm) && line.startsWith("GETC")) return true;
		if (line.match(/\s*RET\s*/gm) && line.startsWith("RET")) return true;
		if (line.match(/\s*OUT\s*/gm) && line.startsWith("OUT")) return true;
		if (line.match(/\s*IN\s*/gm) && line.startsWith("IN")) return true;

		return false;
	}

	protected removeComment(line: string): string{
		if (line.indexOf(";") >= 0){
			return line.substring(0, line.indexOf(";"));
		}

		return line;
	}

	protected convertCommandToMachine(location: number, opcode: string, arg1: string | undefined, arg2: string | undefined, arg3: string | undefined): number{
		if (opcode == "ADD" || opcode == "AND"){
			let opc = (opcode == "AND") ? 0b0101 : 0b0001;
			let DR = Number(arg1?.substring(1,2)) * Math.pow(2, 9)
			let SR1 = Number(arg2?.substring(1,2)) * Math.pow(2, 6)
			let rFlag = 1;
			let numerical = (arg3 != undefined) ? this.convertNumber(arg3) : NaN;
			if (Number.isNaN(numerical)){
				numerical = Number(arg3?.substring(1,2))
				rFlag = 0;
			}

			if (!this.bitLimit(numerical, 5)) numerical = NaN;

			rFlag *= Math.pow(2, 5);
			return (opc) * Math.pow(2, 12) + DR + SR1 + rFlag + numerical;
		}else if (opcode.startsWith("BR")){
			//let opc = 0b0000;
			let flags = 0;
			if (opcode.indexOf("N") > 1) flags += 0b100;
			if (opcode.indexOf("Z") > 1) flags += 0b010;
			if (opcode.indexOf("P") > 1) flags += 0b001;
			flags *= Math.pow(2, 9);

			let obj = (arg1) ? this.labelLocations.get(arg1) : {pc: 0};
			let direction = (obj) ? obj.pc : 0;
			let pcoffset9 = direction - (location + 1); //because technically pc is next line, but this version has it at last line

			if (!this.bitLimit(pcoffset9, 9)) pcoffset9 = 0;

			if (pcoffset9 < 0){ //NOTE: Not sure if negative numbers should be fixed or not
				pcoffset9 = 0b111111111 + pcoffset9 + 1;
			}

			return flags + pcoffset9;
		}else if (opcode == "JMP"){
			let opc = 0b1100
			let register = (arg1) ? Number(arg1.at(1)) : NaN;
			return opc * Math.pow(2, 12) + register * Math.pow(2, 6);
		}else if (opcode == "JSR"){
			let opc = 0b01001; //Note extra 1 is actually Label/Register Flag

			let obj = (arg1) ? this.labelLocations.get(arg1) : {pc: NaN};
			let direction = (obj) ? obj.pc : NaN;
			let pcoffset11 = direction - (location + 1);

			if (!this.bitLimit(pcoffset11, 11)) pcoffset11 = 0;

			if (pcoffset11 < 0){
				pcoffset11 = 0b11111111111 + pcoffset11 + 1;
			}

			return opc * Math.pow(2, 11) + pcoffset11;
		}else if (opcode == "JSRR"){
			let opc = 0b0100;
			let register = (arg1) ? Number(arg1.at(1)) : NaN;
			return opc * Math.pow(2, 12) + register * Math.pow(2, 6);
		}else if (opcode == "LD" || opcode == "LDI" || opcode == "LEA" || opcode == "ST" || opcode == "STI"){
			let opc = (opcode == "LD") ? 0b0010 : 0b1010;
			if (opcode == "LEA") opc = 0b1110;
			if (opcode == "ST") opc = 0b0011;
			if (opcode == "STI") opc = 0b1011;

			let dr = (arg1) ? Number(arg1.at(1)) : NaN;
			
			let pcoffset9;
			let obj = (arg2) ? this.labelLocations.get(arg2) : undefined;
			if (obj != undefined){
				let direction = (obj) ? obj.pc : NaN;
				pcoffset9 = direction - (location + 1);
			}else{
				pcoffset9 = (arg2) ? Number(arg2) : NaN; //NOTE: IDK why I have this here because I block direct encoding for execution
			}

			if (!this.bitLimit(pcoffset9, 9)) pcoffset9 = 0;

			if (pcoffset9 < 0){
				pcoffset9 = 0b111111111 + pcoffset9 + 1;
			}

			return opc * Math.pow(2, 12) + dr * Math.pow(2, 9) + pcoffset9;
		}else if (opcode == "LDR" || opcode == "STR"){
			let opc = (opcode == "LDR") ? 0b0110 : 0b0111;

			let dr = (arg1) ? Number(arg1.at(1)) : NaN;
			let br = (arg2) ? Number(arg2.at(1)) : NaN;
			let offset = (arg3) ? this.convertNumber(arg3) : NaN;

			if (!this.bitLimit(offset, 6)) offset = NaN;

			if (offset < 0){
				offset = 0b111111 + offset + 1;
			}

			return opc * Math.pow(2, 12) + dr * Math.pow(2, 9) + br * Math.pow(2, 6) + offset;
		}else if (opcode == "NOT"){
			let opc = 0b1001;
			let dr = (arg1) ? Number(arg1.at(1)) : NaN;
			let sr = (arg2) ? Number(arg2.at(1)) : NaN;

			return opc * Math.pow(2, 12) + dr * Math.pow(2, 9) + sr * Math.pow(2, 6) + 0b111111;
		}else if (opcode == "RET"){
			return 0b1100000111000000;
		}else if (opcode == "TRAP" || opcode == "HALT" || opcode == "PUTS" || opcode == "GETC" || opcode == "OUT" || opcode == "IN"){
			let opc = 0b1111;

			let numerical = NaN;
			if (arg1){
				numerical = this.convertNumber(arg1);
			}else{
				if (opcode == "HALT") numerical = 0x25;
				if (opcode == "PUTS") numerical = 0x22;
				if (opcode == "GETC") numerical = 0x20;
				if (opcode == "OUT") numerical = 0x21;
				if (opcode == "IN") numerical = 0x23;
			}

			if (numerical < 0){
				numerical = 0x111111111111 - numerical + 1;
			}

			return opc * Math.pow(2, 12) + numerical;
		}

		return NaN;
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

	//False if out of bounds of limit, for signed numbers only
	protected bitLimit(n: number, limit:number): boolean{
		let posLim:number = (Math.pow(2, limit-1)) - 1;
		let negLim = -1 * (Math.pow(2, limit-1));
		if (n > posLim || n < negLim) return false;

		return true;
	}

	//Assuming that number is between -0x7FFF to 0x7FFE
	protected convertToUnsigned(n: number): number{
		if (n >= 0){
			return n;
		}else{
			return 0xFFFF + n + 1;
		}
	}

	protected warn(r: Result){
		this.emit("warning", r);
	}

	protected IncrementMCC(){
		this.mcc++;
		let entry = emptyLC3Data();
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
}