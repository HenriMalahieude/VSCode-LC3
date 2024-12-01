import { TextDocument } from 'vscode';

export interface Result{
	success: boolean;
	line?: number;
	context?: string;
	message?: string;
}

export type TextFile = TextDocument | string[];

export function instanceOfVSCTextDocument(obj: any): obj is TextDocument { return 'fileName' in obj; }

export interface Bit16Location{
	fileIndex: number;
	pc: number;
}

export interface LC3Data{
	assembly: string | undefined;
	machine: number;
	location: Bit16Location;
}

export function EmptyLC3Data(): LC3Data{
	return {
		assembly: "-",
		machine: 0,
		location: {fileIndex: 0, pc: 0x3000},
	}
}

//Expects Signed Number
export function WithinBitLimit(n: number, limit:number): boolean{
	let posLim:number = (Math.pow(2, limit-1)) - 1;
	let negLim = -1 * (Math.pow(2, limit-1));
	if (n > posLim || n < negLim) return false;

	return true;
}

//Assuming that number is between -0x7FFF to 0x7FFE
export function ConvertToUnsigned(n: number): number{
	if (n >= 0){
		return n;
	}else{
		return 0xFFFF + n + 1;
	}
}

//Requires All Upper Case input
export function ConvertLC3ToNumber(param: string): number{
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

export function ConvertLC3ToMachine(location: number, labelLocations: Map<string, Bit16Location>, opcode: string, arg1: string | undefined, arg2: string | undefined, arg3: string | undefined): number{
	if (opcode == "ADD" || opcode == "AND"){
		let opc = (opcode == "AND") ? 0b0101 : 0b0001;
		let DR = Number(arg1?.substring(1,2)) * Math.pow(2, 9)
		let SR1 = Number(arg2?.substring(1,2)) * Math.pow(2, 6)
		let rFlag = 1;
		let numerical = (arg3 != undefined) ? ConvertLC3ToNumber(arg3) : NaN;
		if (Number.isNaN(numerical)){
			numerical = Number(arg3?.substring(1,2))
			rFlag = 0;
		}

		if (!WithinBitLimit(numerical, 5)) numerical = NaN;

		rFlag *= Math.pow(2, 5);
		return (opc) * Math.pow(2, 12) + DR + SR1 + rFlag + numerical;
	}else if (opcode.startsWith("BR")){
		//let opc = 0b0000;
		let flags = 0;
		if (opcode.indexOf("N") > 1) flags += 0b100;
		if (opcode.indexOf("Z") > 1) flags += 0b010;
		if (opcode.indexOf("P") > 1) flags += 0b001;
		flags *= Math.pow(2, 9);

		let obj = (arg1) ? labelLocations.get(arg1) : {pc: 0};
		let direction = (obj) ? obj.pc : 0;
		let pcoffset9 = direction - (location + 1); //because technically pc is next line, but this version has it at last line

		if (!WithinBitLimit(pcoffset9, 9)) pcoffset9 = 0;

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

		let obj = (arg1) ? labelLocations.get(arg1) : {pc: NaN};
		let direction = (obj) ? obj.pc : NaN;
		let pcoffset11 = direction - (location + 1);

		if (!WithinBitLimit(pcoffset11, 11)) pcoffset11 = 0;

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
		let obj = (arg2) ? labelLocations.get(arg2) : undefined;
		if (obj != undefined){
			let direction = (obj) ? obj.pc : NaN;
			pcoffset9 = direction - (location + 1);
		}else{
			pcoffset9 = (arg2) ? Number(arg2) : NaN; //NOTE: IDK why I have this here because I block direct encoding for execution
		}

		if (!WithinBitLimit(pcoffset9, 9)) pcoffset9 = 0;

		if (pcoffset9 < 0){
			pcoffset9 = 0b111111111 + pcoffset9 + 1;
		}

		return opc * Math.pow(2, 12) + dr * Math.pow(2, 9) + pcoffset9;
	}else if (opcode == "LDR" || opcode == "STR"){
		let opc = (opcode == "LDR") ? 0b0110 : 0b0111;

		let dr = (arg1) ? Number(arg1.at(1)) : NaN;
		let br = (arg2) ? Number(arg2.at(1)) : NaN;
		let offset = (arg3) ? ConvertLC3ToNumber(arg3) : NaN;

		if (!WithinBitLimit(offset, 6)) offset = NaN;

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
			numerical = ConvertLC3ToNumber(arg1);
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

//Requires All Upper Case input, and perhaps a space at the end
export function startsWithCommand(line: string): boolean{
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

	if (line.match(/\bHALT\b/gm) && line.startsWith("HALT")) return true;
	if (line.match(/\bPUTS\b/gm) && line.startsWith("PUTS")) return true;
	if (line.match(/\bGETC\b/gm) && line.startsWith("GETC")) return true;
	if (line.match(/\bRET\b/gm) && line.startsWith("RET")) return true;
	if (line.match(/\bOUT\b/gm) && line.startsWith("OUT")) return true;
	if (line.match(/\bIN\b/gm) && line.startsWith("IN")) return true;

	return false;
}