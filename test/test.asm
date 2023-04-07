.orig x3000

AND R0, R0, #0

;Simple multiplication by 2
ADD R0, R0, #1
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

HALT
.end