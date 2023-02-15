import { create } from 'domain';
import * as vscode from 'vscode'

export interface Result{
	success: boolean;
	message: string;
}

function createResult(s: boolean, m?: string): Result{
	return {success: s, message: (m ? m : "")};
}

export class LC3Simulator {
	registers: number[];
	memory: Map<number, number>;
	pc: number;
	psr: number;
	mcr: number;

	private file: vscode.TextDocument;
	private currentLine: number;
	private subroutineLocations: Map<number, number>;
	private labelLocations: Map<number, number>;

	constructor(f: vscode.TextDocument){
		//Initialize the machine
		this.registers = [0, 0, 0, 0, 0, 0, 0]; //7 Registers
		this.memory = new Map<number, number>(); //Potentially get a file to pre-load things into here
		this.pc = 0x3000;
		this.psr = 0;
		this.mcr = 0;

		//Initialize the Object
		this.file = f;
		this.currentLine = 0;
		this.subroutineLocations = new Map<number, number>();
		this.labelLocations = new Map<number, number>();
		//TODO: Pre-processing so that we can map file locations with .origin commands
	}

	public stepOver(forward: boolean): Result{


		return createResult(true);
	}

	public stepIn(forward: boolean): Result{

		return createResult(true);
	}

	public stepOut(forward: boolean): Result{

		return createResult(true);
	}

	public run(): Result{

		return createResult(true);
	}

	private interpretCommand(line: string): boolean{


		return true;
	}
}