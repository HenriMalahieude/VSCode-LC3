<img src="./pictures/ucr_logo.png" width="20%" height="10%">

# LC3 VSCode Integration
## Syntax Highlighting/Coloring
![Example](./pictures/example_program.png)

## Code Diagnostics
![FirstError](./pictures/error1.png) ![SecondError](./pictures/error2.png)

## Integrated Simulated "Debugger"
### Use VSCode's Debugger to Simulate LC-3 Programs
![HowTo](./pictures/How%20to%20Sim%20LC3.gif)

### Simple Register and Memory View
![SimView](./pictures/Memory_View.gif) ![MemView](./pictures/memory_view2.png)

### Memory Table/Search
![MemBefore](./pictures/mem_search_before.png)  ![MemDuring](./pictures/mem_search_during.png)  ![MemAfter](./pictures/mem_search_after.png)
### Easy to access stack
![stack](./pictures/stack_view.png)

### Editable memory
![Edit](./pictures/edit_vars.png)

### Breakpoints
![bp1](./pictures/breakpoints2.png) ![bp2](./pictures/breakpoints1.png)


## Notes on use:
1. Press F5 on the File or open Debug panel and click "Launch and Debug"
2. Select "Simulator" or "Grader"
	1. Simulator provides deeper info and interaction with code
	2. Grader uses [LC3-Tools](https://github.com/chiragsakhuja/lc3tools) CLI to match UCR's Auto-Grader as close as possible
3. Input relative path from workspace folder to .asm or .lc3 file (``./test.asm`` or ``Folder/OtherFolder/LabNumber400_and_6.lc3``)
	1. Please avoid spaces (``./test file.asm``), this will result in an error, use ``_`` instead
4. If you'd like to avoid this input, you can create a launch.json (it's an option in the Debug Panel when not debugging) and it will infer the active text editor as the file to debug
5. Debug your program