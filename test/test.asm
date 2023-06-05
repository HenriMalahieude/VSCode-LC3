;Main Program
.orig x3000

AND R6, R6, #0
AND R0, R0, #0

ADD R6, R6, #15
ADD R0, R0, #-1

LOOP ADD R6, R6, R0
BRp LOOP

AND R6, R6, #0
LD R6, PTR2

JSRR R6

HALT

PTR2 .FILL x4000
.end

;Subroutine, Simple
.orig x4000
LD R0, ASCII_R
OUT

LEA R0, HUH
PUTS

RET

ASCII_R .FILL x52
HUH .STRINGZ "Hello, World!"

.end
