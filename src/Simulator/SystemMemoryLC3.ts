import { LC3Data } from "./LC3Utils";

//Honestly could've made this an internal function to the main export, but whatever lol
function MakeLC3Data(mem: Map<number, LC3Data>,assembly: string, machine: number, pc: number){
	mem.set(pc, {assembly, machine, location: {pc, fileIndex: -1}});
}

//Using LC3 Tools application as template/example or source to copy from
export function SetSystemMemory(memory: Map<number, LC3Data>){
	for (let i = 0; i <= 0x00FF; i++){
		MakeLC3Data(memory, ".FILL BAD_TRAP", 0x038C, i)
	}
	for (let i = 0x0103; i <= 0x01FF; i++){
		MakeLC3Data(memory, ".FILL BAD_INT", 0x0413, i)
	}

	MakeLC3Data(memory, ".FILL TRAP_GETC", 0x0300, 0x20)
	MakeLC3Data(memory, ".FILL TRAP_OUT", 0x0306, 0x21)
	MakeLC3Data(memory, ".FILL TRAP_PUTS", 0x0310, 0x22)
	MakeLC3Data(memory, ".FILL TRAP_IN", 0x031F, 0x23)
	MakeLC3Data(memory, ".FILL TRAP_PUTSP", 0x0340, 0x24)
	MakeLC3Data(memory, ".FILL TRAP_HALT", 0x0366, 0x25)

	MakeLC3Data(memory, ".FILL EX_PRIV", 0x03B3, 0x0100)
	MakeLC3Data(memory, ".FILL EX_ILL", 0x03D6, 0x0101)
	MakeLC3Data(memory, ".FILL EX_ACV", 0x03F4, 0x0102)

	//First System Routine, set up User PSR and PC
	MakeLC3Data(memory, "LD R6, OS_SP", 0x2C07, 0x0200)
	MakeLC3Data(memory, "LD R0, USER_PSR", 0x2007, 0x0201)
	MakeLC3Data(memory, "ADD R6, R6, #-1", 0x1DBF, 0x0202)
	MakeLC3Data(memory, "STR R0, R6, #0", 0x7180, 0x0203)
	MakeLC3Data(memory, "LD R0, USER_PC", 0x2005, 0x0204)
	MakeLC3Data(memory, "ADD R6, R6, #-1", 0x1DBF, 0x0205)
	MakeLC3Data(memory, "STR R0, R6, #0", 0x7180, 0x0206)
	MakeLC3Data(memory, "RTI", 0x8000, 0x0207)
	MakeLC3Data(memory, "OS_SP .FILL x3000", 0x3000, 0x0207)
	MakeLC3Data(memory, "USER_PSR .FILL x8002", 0x8002, 0x0207)
	MakeLC3Data(memory, "USER_PC .FILL x3000", 0x3000, 0x0207)

	//Noting that this is what the above program does
	MakeLC3Data(memory, "USER_PSR", 0x8002, 0x2FFF)
	MakeLC3Data(memory, "USER_PC", 0x3000, 0x2FFE)

	//TRAP Vectors
	//GETC
	MakeLC3Data(memory, "LDI R0, OS_KBSR", 0xA003, 0x0300)
	MakeLC3Data(memory, "BRzp TRAP_GETC", 0x07FE, 0x0301)
	MakeLC3Data(memory, "LDI R0, OS_KBDR", 0xA002, 0x0302)
	MakeLC3Data(memory, "RTI", 0x8000, 0x0303)
	MakeLC3Data(memory, "OS_KBSR .FILL xFE00", 0xFE00, 0x0304)
	MakeLC3Data(memory, "OS_KBDR .FILL xFE02", 0xFE02, 0x0305)

	//OUT
	MakeLC3Data(memory, "ADD R6, R6, #-1", 0x1DBF, 0x0306)  //It looks weird, but that's because I assume the system stack pointer is being auto put into R6...
	MakeLC3Data(memory, "STR R1, R6, #0", 0x7380, 0x0307) 
	MakeLC3Data(memory, "LDI R1, OS_DSR", 0xA205, 0x0308)
	MakeLC3Data(memory, "BRzp TRAP_OUT_WAIT", 0x07FE, 0x0309)
	MakeLC3Data(memory, "STI R0, OS_DDR", 0xB004, 0x030A)
	MakeLC3Data(memory, "LDR R1, R6, #0", 0x6380, 0x030B)
	MakeLC3Data(memory, "ADD R6, R6, #1", 0x1DA1, 0x030C)
	MakeLC3Data(memory, "RTI", 0x8000, 0x030D)
	MakeLC3Data(memory, "OS_DSR .FILL xFE04", 0xFE04, 0x030E)
	MakeLC3Data(memory, "OS_DDR .FILL xFE06", 0xFE06, 0x030F)

	//MakeLC3Data(memory, "", 0x0, 0x0)
	//TODO: The rest

	//PUTS
	MakeLC3Data(memory, "ADD R6, R6, #-1", 0x1DBF, 0x0310)
	MakeLC3Data(memory, "STR R0, R6, #0", 0x7180, 0x0311)
	MakeLC3Data(memory, "ADD R6, R6, #-1", 0x1DBF, 0x0312)
	MakeLC3Data(memory, "STR R1, R6, #0", 0x7380, 0x0313)
	MakeLC3Data(memory, "ADD R1, R0, #0", 0x1220, 0x0314)
	MakeLC3Data(memory, "LDR R0, R1, #0", 0x6040, 0x0315)
	MakeLC3Data(memory, "BRz TRAP_PUTS_DONE", 0x0403, 0x0316)
	MakeLC3Data(memory, "OUT", 0xF021, 0x0317)
	MakeLC3Data(memory, "ADD R1, R1, #1", 0x1261, 0x0318)
	MakeLC3Data(memory, "BRnzp TRAP_PUTS_LOOP", 0x0FFB, 0x0319)
	MakeLC3Data(memory, "LDR R1, R6, #0", 0x6380, 0x031A)
	MakeLC3Data(memory, "ADD R6, R6, #1", 0x1DA1, 0x031B)
	MakeLC3Data(memory, "LDR R0, R6, #0", 0x6180, 0x031C)
	MakeLC3Data(memory, "ADD R6, R6, #0", 0x1DA1, 0x031D)
	MakeLC3Data(memory, "RTI", 0x8000, 0x031E)

	//IN
	MakeLC3Data(memory, "LEA R0, TRAP_IN_MSG", 0xE00B, 0x031F)
	MakeLC3Data(memory, "PUTS", 0xF022, 0x0320)
	MakeLC3Data(memory, "GETC", 0xF020, 0x0321)
	MakeLC3Data(memory, "OUT", 0xF021, 0x0322)
	MakeLC3Data(memory, "ADD R6, R6, #-1", 0x1DBF, 0x0323) //Here it's outputting a new line
	MakeLC3Data(memory, "STR R0, R6, #0", 0x7180, 0x0324)
	MakeLC3Data(memory, "AND R0, R0, #0", 0x5020, 0x0325)
	MakeLC3Data(memory, "ADD R0, R0, #10", 0x102A, 0x0326)
	MakeLC3Data(memory, "OUT", 0xF021, 0x0327)
	MakeLC3Data(memory, "LDR R0, R6, #0", 0x6180, 0x0328)
	MakeLC3Data(memory, "ADD R6, R6, #1", 0x1DA1, 0x0329)
	MakeLC3Data(memory, "RTI", 0x8000, 0x032A)
	
	let string = "\nInput a character> "
	for (let i = 0; i < string.length; i++){
		MakeLC3Data(memory, string.charAt(i), string.charCodeAt(i), 0x032B + i);
	}


	//PUTSP
	MakeLC3Data(memory, "PUTSP unused by Sim", 0x0, 0x0340)

	//HALT
	MakeLC3Data(memory, "LEA R0, TRAP_HALT_MSG", 0xE008, 0x0366)
	MakeLC3Data(memory, "PUTS", 0xF022, 0x0367)
	MakeLC3Data(memory, "LDI R0, OS_MCR", 0xA004, 0x0368)
	MakeLC3Data(memory, "LD R1, MASK_HI", 0x2204, 0x0369)
	MakeLC3Data(memory, "AND R0, R0, R1", 0x5001, 0x036A)
	MakeLC3Data(memory, "STI R0, OS_MCR", 0xB001, 0x036B)
	MakeLC3Data(memory, "BRnzp TRAP_HALT", 0x00FF9, 0x036C)
	MakeLC3Data(memory, "OS_MCR .FILL xFFFE", 0xFFFE, 0x036D)
	MakeLC3Data(memory, "MASK_HI .FILL x7FFF", 0x7FFF, 0x036E)

	string = "\n\n--- Halting the LC-3 ---\n\n"
	for (let i = 0; i < string.length; i++){
		MakeLC3Data(memory, string.charAt(i), string.charCodeAt(i), 0x036F + i);
	}

	//BAD_TRAP
	MakeLC3Data(memory, "LEA R0, BAD_TRAP_MSG", 0xE002, 0x038C)
	MakeLC3Data(memory, "PUTS", 0xF022, 0x038D)
	MakeLC3Data(memory, "HALT", 0xF025, 0x038E)

	string = "\n\n--- Undefined trap executed ---\n\n"
	for (let i = 0; i < string.length; i++){
		MakeLC3Data(memory, string.charAt(i), string.charCodeAt(i), 0x038F + i);
	}

	MakeLC3Data(memory, "Privilege Violation Message", 0x0, 0x03B3)

	MakeLC3Data(memory, "Illegal Opcode Message", 0x0, 0x03D6)

	MakeLC3Data(memory, "Access Violation Message", 0x0, 0x03F4)

	MakeLC3Data(memory, "RTI ;From BAD_INT", 0x8000, 0x0413)
}