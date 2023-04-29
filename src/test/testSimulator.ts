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

		console.log("\tPreprocessor Test");
		check("Preprocess", this.testPreprocess());
		
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

	private testPreprocess(): Sim.Result{

		return {success: false, message: "TODO"};
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
		let test3 = this.AND("AND R5, R5, #16");
		if (test3.success || this.registers[5] != 1) return {success: false, message: "Five bit limit for ANDs failed?"};

		return {success: true};
	}

	private testBR(): Sim.Result{
		this.resetSimulationState();
		this.memory.set(0x3000, {assembly: "", machine: 0, location: {pc: 0x3000, fileIndex: 0}});
		this.labelLocations.set("TEST", {pc: 0x3000, fileIndex: 0});
		this.condition_codes = {"N": true, "Z": false, "P": false};
		
		this.pc = 0;
		let test0 = this.BR("BRN TEST");
		if (!test0.success) return test0;
		if (this.pc != 0x2FFF) return {success: false, message: "BR failed Negative Jump"};

		this.pc = 0;
		this.condition_codes = {"N": false, "Z": true, "P": false};
		let test1 = this.BR("BRZ TEST");
		if (!test1.success) return test1;
		if (this.pc != 0x2FFF) return {success: false, message: "BR failed Zero Jump"};

		this.pc = 0;
		this.condition_codes = {"N": false, "Z": false, "P": true};
		let test2 = this.BR("BRP TEST");
		if (!test2.success) return test2;
		if (this.pc != 0x2FFF) return {success: false, message: "BR failed Positive Jump"};

		this.pc = 0;
		this.condition_codes = {"N": false, "Z": false, "P": false};
		let test3 = this.BR("BRNZP TEST");
		if (!test3.success) return test3;
		if (this.pc == 0x2FFF) return {success: false, message: "BR failed no Jump"};

		this.resetSimulationState();
		this.condition_codes = {"N": false, "Z": false, "P": false};
		let test4 = this.BR("BRNZP TEST");
		if (test4.success) return {success: false, message: "BR jumped to undefined location in memory."};

		return {success: true};
	}

	private testJMP(): Sim.Result{
		for (let i = 0; i < 8; i++){
			this.resetSimulationState();
			let register = "R"+String(i);
			this.registers[i] = 0x3000;
			this.memory.set(0x3000, {assembly: "", machine: 0, location: {pc:0x3000, fileIndex: 0}});
			let test0 = this.JMP("JMP " + register);
			if (!test0.success) return test0;
			if (this.pc != 0x2FFF) return {success: false, message: "Failed Register JMP"};
		}

		return {success: true};
	}

	private testJSR(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	private testJSRR(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	private testLD(): Sim.Result{
		for (let i = 0; i < 8; i++){
			this.resetSimulationState();
			this.memory.set(0x3000, {assembly: "", machine: 1234, location: {pc: 0x3000, fileIndex: -1}});
			this.labelLocations.set("TEST", {pc: 0x3000, fileIndex: -1});
			let register = "R"+String(i);
			let test0 = this.LD("LD " + register + ", TEST");
			if (!test0.success) return test0;
			if (this.registers[i] != 1234) return {success: false, message: register + " failed LD of 1234 for label TEST"};
		}

		this.resetSimulationState();
		this.memory.set(0x5000, {assembly: "", machine: 1234, location: {pc: 0x5000, fileIndex: -1}});
		this.labelLocations.set("TEST", {pc: 0x5000, fileIndex: -1});
		this.pc = 0x3000;
		let test1 = this.LD("LD R0, TEST")
		if (test1.success || this.registers[0] == 1234) return {success: false, message: "Failed LD 9bit limit"};

		return {success: true};
	}

	private testLDI(): Sim.Result{
		for (let i = 0; i < 8; i++){
			this.resetSimulationState();
			this.memory.set(0x3000, {assembly: "", machine: 0x3001, location: {pc: 0x3000, fileIndex: -1}});
			this.memory.set(0x3001, {assembly: "", machine: 1234, location: {pc: 0x3001, fileIndex: -1}})
			this.labelLocations.set("TEST", {pc: 0x3000, fileIndex: -1});
			let register = "R"+String(i);
			let test0 = this.LDI("LDI " + register + ", TEST");
			if (!test0.success) return test0;
			if (this.registers[i] != 1234) return {success: false, message: register + " failed LDI of 1234 for label TEST"};
		}

		this.resetSimulationState();
		this.memory.set(0x5000, {assembly: "", machine: 0x5001, location: {pc: 0x5000, fileIndex: -1}});
		this.memory.set(0x5001, {assembly: "", machine: 1234, location: {pc: 0x5001, fileIndex: -1}})
		this.labelLocations.set("TEST", {pc: 0x5000, fileIndex: -1});
		this.pc = 0x3000;
		let test1 = this.LDI("LDI R0, TEST")
		if (test1.success || this.registers[0] == 1234) return {success: false, message: "Failed LDI 9bit limit"};

		return {success: true};
	}

	private testLDR(): Sim.Result{
		for (let i = 0; i < 8; i++){
			this.resetSimulationState();
			this.memory.set(0x3000, {assembly: "", machine: 0x3001, location: {pc: 0x3000, fileIndex: -1}});
			this.memory.set(0x3001, {assembly: "", machine: 1234, location: {pc: 0x3001, fileIndex: -1}})
			
			let r1Index = i;
			let r2Index = (i+1) % 8

			this.registers[r2Index] = 0x3000

			let register1 = "R"+String(r1Index);
			let register2 = "R"+String(r2Index);
			let test0 = this.LDR("LDR " + register1 + ", " + register2 + ", #0");
			if (!test0.success) return test0;
			if (this.registers[r1Index] != 0x3001) return {success: false, message: register1 + " failed LDR #0 of 0x3001 from " + register2};

			let test1 = this.LDR("LDR " + register1 + ", " + register2 + ", #1");
			if (!test1.success) return test1;
			if (this.registers[r1Index] != 1234) return {success: false, message: register1 + " failed LDR #1 of 1234 from " + register2};
		}

		return {success: true};
	}

	private testLEA(): Sim.Result{
		for (let i = 0; i < 8; i++){
			this.resetSimulationState();
			this.labelLocations.set("TEST", {pc: 0x3000, fileIndex: -1});
			let register = "R"+String(i);
			let test0 = this.LEA("LEA " + register + ", TEST");
			if (!test0.success) return test0;
			if (this.registers[i] != 0x3000) return {success: false, message: register + " failed LEA for label TEST at 0x3000"};
		}

		this.resetSimulationState();
		this.labelLocations.set("TEST", {pc: 0x5000, fileIndex: -1});
		this.pc = 0x3000;
		let test1 = this.LEA("LEA R0, TEST")
		if (test1.success || this.registers[0] == 0x5000) return {success: false, message: "Failed LEA 9bit limit"};

		return {success: true};
	}

	private testNOT(): Sim.Result{
		//Test all registers
		for (let i = 0; i < 8; i++){
			this.resetSimulationState();
			let register = "R"+String(i);
			this.registers[i] = 123;
			let test0 = this.NOT("NOT " + register + ", " + register);
			if (!test0.success) return test0;
			if (this.registers[i] != ~(123)) return {success: false, message: "Register " + register + " failed not. ~123 =? " + this.registers[i]};
		}

		//Test Negative Number
		this.resetSimulationState();
		this.registers[0] = 5;
		let test1 = this.NOT("NOT R0, R0");
		if (!test1.success) return test1;
		let test2 = this.ADD("ADD R0, R0, #6");
		if (!test2.success) return test2;
		if (this.registers[0] != 0) return {success: false, message: "Failed to do proper subtraction with NOT. ~5 + 6 =? " + this.registers[0]};

		return {success: true};
	}

	private testRTI(): Sim.Result{

		return {success: false, message: "TODO"};
	}

	private testST(): Sim.Result{
		for (let i = 0; i < 8; i++){
			this.resetSimulationState();
			this.memory.set(0x3000, {assembly: "", machine: 1234, location: {pc: 0x3000, fileIndex: -1}});
			this.labelLocations.set("TEST", {pc: 0x3000, fileIndex: -1});
			let register = "R"+String(i);
			let test0 = this.ST("ST " + register + ", TEST");
			if (!test0.success) return test0;
			if (this.memory.get(0x3000)?.machine == 1234) return {success: false, message: register + " failed ST of 1234 for label TEST"};
		}

		this.resetSimulationState();
		this.memory.set(0x5000, {assembly: "", machine: 1234, location: {pc: 0x5000, fileIndex: -1}});
		this.labelLocations.set("TEST", {pc: 0x5000, fileIndex: -1});
		this.pc = 0x3000;
		let test1 = this.ST("ST R0, TEST")
		if (test1.success || this.memory.get(0x5000)?.machine != 1234) return {success: false, message: "Failed ST 9bit limit (" + test1.success + " " + this.memory.get(0x5000)?.machine + ")"};

		return {success: true};
	}

	private testSTI(): Sim.Result{
		for (let i = 0; i < 8; i++){
			this.resetSimulationState();
			this.memory.set(0x3000, {assembly: "", machine: 0x3001, location: {pc: 0x3000, fileIndex: -1}});
			this.memory.set(0x3001, {assembly: "", machine: 1234, location: {pc: 0x3001, fileIndex: -1}})
			this.labelLocations.set("TEST", {pc: 0x3000, fileIndex: -1});
			let register = "R"+String(i);
			let test0 = this.STI("STI " + register + ", TEST");
			if (!test0.success) return test0;
			if (this.memory.get(0x3001)?.machine == 1234) return {success: false, message: register + " failed STI of 1234 for label TEST"};
		}

		this.resetSimulationState();
		this.memory.set(0x5000, {assembly: "", machine: 0x5001, location: {pc: 0x5000, fileIndex: -1}});
		this.memory.set(0x5001, {assembly: "", machine: 1234, location: {pc: 0x5001, fileIndex: -1}})
		this.labelLocations.set("TEST", {pc: 0x5000, fileIndex: -1});
		this.pc = 0x3000;
		let test1 = this.STI("STI R0, TEST")
		if (test1.success || this.memory.get(0x5001)?.machine != 1234) return {success: false, message: "Failed STI 9bit limit"};

		return {success: true};
	}

	private testSTR(): Sim.Result{
		for (let i = 0; i < 8; i++){
			this.resetSimulationState();
			this.memory.set(0x3000, {assembly: "", machine: 0x3001, location: {pc: 0x3000, fileIndex: -1}});
			this.memory.set(0x3001, {assembly: "", machine: 1234, location: {pc: 0x3001, fileIndex: -1}})
			
			let r1Index = i;
			let r2Index = (i+1) % 8

			this.registers[r2Index] = 0x3000;

			let register1 = "R"+String(r1Index);
			let register2 = "R"+String(r2Index);
			let test0 = this.STR("STR " + register1 + ", " + register2 + ", #0");
			if (!test0.success) return test0;
			if (this.memory.get(0x3000)?.machine == 0x3001) return {success: false, message: register1 + " failed STR #0 of 0 to " + register2};
			this.memory.set(0x3000, {assembly: "", machine: 0x3001, location: {pc: 0x3000, fileIndex: -1}});

			let test1 = this.STR("STR " + register1 + ", " + register2 + ", #1");
			if (!test1.success) return test1;
			if (this.memory.get(0x3001)?.machine == 1234) return {success: false, message: register1 + " failed STR #1 of 0 to " + register2};
		}

		return {success: true};
	}

	private testTRAP(): Sim.Result{
		this.resetSimulationState();

		let test0 = this.TRAP("TRAP X25");
		if (!test0.success) return test0;
		if (!this.halted) return {success: false, message: "Failed to HALT program/computer."};

		//NOTE: Can't really test the other stuff.....

		return {success: true};
	}

	//TODO: Test Macros
	
	//Helper Functions
	private resetSimulationState(){
		this.status = {success: true};
		this.halted = false;
		
		this.registers = [0, 0, 0, 0, 0, 0, 0, 0];
		this.condition_codes = {"N": false, "Z": true, "P": false};
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