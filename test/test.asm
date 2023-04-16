.orig x3000

LD R0, VAR_1
AND R0, R0, #0

;Simple multiplication by 2
Position ADD R0, R0, #1
		 ADD R0, R0, R0
		 ADD R0, R0, R0

;Put it back to zero
AND R0, R0, #0

;This will be testing the NOT
ADD R0, R0, #5

;Negate the number
NOT R0, R0
ADD R0, R0, #1

;This should result in zero
ADD R0, R0, #5

AND R1, R1, #0
ADD R1, R1, x3001
JMP R1

HALT
.end
VAR_1 .FILL #500
VAR_2 .STRINGZ "Word"
VAR_# .BLKW 2