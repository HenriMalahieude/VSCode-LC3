import * as vscode from "vscode"
import * as Sim from "../Simulator"

export class SimulationTester extends Sim.LC3Simulator {
	constructor(){
		super(undefined);
		this.resetSimulationState();
	}

	public runAllTests(){
		console.log("Running Simulator Test Suite")
		let testState = {"TOTAL": 0, "FAIL": 0};

		function check(name: string, item: Sim.Result){
			testState["TOTAL"] += 1;
			if (!item.success){
				testState["FAIL"] += 1;
				console.log("\t\tFailed " + name +"\n\t\t\tInfo: " + item.message + "\n");
			}
		}
		
		console.log("\tOp-Code Test");
		
		check("ADD", this.testADD());
		check("AND", this.testAND());
		check("BR", this.testBR());
		check("JMP", this.testJMP());
		check("JSR", this.testJSR());
		check("JSRR", this.testJSRR());
		check("LD", this.testLD());
		check("LDI", this.testLDI());
		check("LDR", this.testLDR());
		check("LEA", this.testLEA());
		check("NOT", this.testNOT());
		check("RTI", this.testRTI());
		check("ST", this.testST());
		check("STI", this.testSTI());
		check("STR", this.testSTR());
		check("TRAP", this.testTRAP());

		console.log("Simulator Test Suite Success: (" + (testState["TOTAL"] - testState["FAIL"]) + "/" + testState["TOTAL"] + ")")
	}

	private testADD(): Sim.Result{
		//Test all registers
		for (let i = 0; i < 8; i++){
			this.resetSimulationState();
			let register = "R"+String(i);
			let test0 = this.ADD("ADD " + register + ", " + register + ", #1");
			if (!test0.success) return test0;
			if (this.registers[i] != 1) return {success: false, message: "Register " + register + " failed 0 ADD 1?"};
		}

		//Test Negative Numbers
		this.resetSimulationState();
		let test1 = this.ADD("ADD R0, R0, #-1");
		if (!test1.success) return test1;
		if (this.registers[0] != -1) return {success: false, message: "Negative ADD failed?"};

		//Test Register Additions
		this.resetSimulationState();
		this.registers[0] = 1; this.registers[1] = 2;
		let test2 = this.ADD("ADD R2, R1, R0");
		if (!test2.success) return test2;
		if (this.registers[2] != 3 || this.registers[1] != 2 || this.registers[0] != 1) return {success: false, message: "Pure register ADD failed?"};

		//Test 5-bit limit
		this.resetSimulationState();
		let test3 = this.ADD("ADD R7, R7, x3000");
		if (test3.success || this.registers[7] == 0x3000) return {success: false, message: "Five-bit limit for ADDs failed?"};

		return {success: true};
	}

	private testAND(): Sim.Result{
		//Test all registers
		for (let i = 0; i < 8; i++){
			this.resetSimulationState();
			let register = "R"+String(i);
			this.registers[i] = 1;
			let test0 = this.AND("AND " + register + ", " + register + ", #0");
			if (!test0.success) return test0;
			if (this.registers[i] != 0) return {success: false, message: "Register " + register + " failed 0 AND 1?"};
		}

		//Test Negative Ands
		this.resetSimulationState();
		this.registers[3] = -1; //Equivalent to 0xFFFE
		this.registers[4] = 1;
		let test1 = this.AND("AND R0, R3, R4");
		if (!test1.success) return test1;
		if (this.registers[0] != 0) return {success: false, message: "Negative AND failed? (1 & -1 =? " + this.registers[0] +")"};

		//Test Register Ands
		this.resetSimulationState();
		this.registers[0] = 1;
		this.registers[1] = 2;
		let test2 = this.AND("AND R2, R1, R0");
		if (!test2.success) return test2;
		if (this.registers[2] != 0) return {success: false, message: "Pure register AND failed?"};

		//Test 5-bit limit
		this.resetSimulationState();
		this.registers[5] = 1;
		let test3 = this.AND("AND R6, R5, #16");
		if (test2.success || this.registers[6] != 1) return {success: false, message: "Five bit limit for ANDs failed?"};

		return {success: true};
	}

	private testBR(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	private testJMP(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	private testJSR(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	private testJSRR(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	private testLD(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	private testLDI(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	private testLDR(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	private testLEA(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	private testNOT(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	private testRTI(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	private testST(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	private testSTI(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	private testSTR(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	private testTRAP(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	//TODO: Test Macros
	
	//Helper Functions
	private resetSimulationState(){
		this.status = {success: true};
		this.halted = false;
		
		this.registers = [0, 0, 0, 0, 0, 0, 0, 0];
		this.memory.clear();
		this.pc = 0x2FFF;
		this.psr = 0;
		this.mcr = 0;
		
		this.currentLine = -1;
		this.processed = true;
		
		this.subroutineLocations.clear();
		this.labelLocations.clear();
	}
}