<img src="./pictures/ucr_logo.png" width="20%" height="10%">

# LC3 Vscode Integration
## Syntax Highlighting/Coloring
![Example](./pictures/example_program.png)

## Code Diagnostics
![FirstError](./pictures/error1.png)
![SecondError](./pictures/error2.png)

## Integrated Simulated "Debugger"
* Use VSCode's Debugger to Simulate LC-3 Programs
	* ![HowTo](./pictures/How%20to%20Sim%20LC3.gif)
* Simple Register and Memory View
	* ![SimView](./pictures/Memory_View.gif) ![MemView](./pictures/memory_view2.png)
* Memory Table/Search
	* TODO
* Easy to access stack
	* TODO
* Editable memory
	* ![Edit](./pictures/edit_vars.png)
* Breakpoints
	* TODO


## Notes on use:
1. Press F5 on the File
2. Or open Debug panel and click "Launch and Debug"
3. Input relative path from workspace folder to .asm or .lc3 file (./test.asm) 
4. Avoid this input by creating a launch.json (it's an option in Debug Panel when not debugging)
5. Debug