;Main Program
.orig x3000

AND R6, R6, #0
LD R6, PTR2

IN

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
