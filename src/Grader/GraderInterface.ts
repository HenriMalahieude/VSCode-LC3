import * as cp from 'child_process';
import {promisify} from 'util';
import * as vscode from 'vscode';
import {platform} from "process";

const execFile = promisify(cp.execFile);

/*let proc = cp.spawn('python', ['-i']);
proc.stdout.setEncoding('utf-8');

let dataChars = '';
proc.stdout.on("data", (data) =>{
	dataChars += data;
	if (dataChars[dataChars.length - 1] == "\n"){
		console.log("Full Line: " + dataChars);
		proc.stdin.end();
	}
})

proc.stdin.write("1 + 0\n");

setTimeout(() => {}, 1500); *///This is temporary while I figure out async functions

export class CLIInterface {
	outputChannel: vscode.OutputChannel;

	private CLI_path: vscode.Uri;
	private cli_buffer: string = "";

	private debugger: cp.ChildProcessWithoutNullStreams | undefined = undefined;
	
	constructor(ctx: vscode.ExtensionContext, otc: vscode.OutputChannel){
		this.outputChannel = otc;

		let isWindows = platform === "win32"
		let isMac = platform === "darwin"

		this.CLI_path = ctx.extensionUri;
		if (isWindows){
			this.CLI_path = vscode.Uri.joinPath(this.CLI_path, "./CLIs/Windows");
		}else if (isMac){
			this.CLI_path = vscode.Uri.joinPath(this.CLI_path, "./CLIs/Mac");
		}else{ //Must be linux then...
			this.CLI_path = vscode.Uri.joinPath(this.CLI_path, "./CLIs/Linux");
		}

		//NOTE: May need to detect architecture specifically
	}

	public async Compile(file: vscode.TextDocument): Promise<boolean> {
		let compiler_uri: vscode.Uri = vscode.Uri.joinPath(this.CLI_path, "./assembler.exe") //This will be windows specific unless..... we remove file extensions?
		
		try {
			const {stdout, stderr} = await execFile(compiler_uri.fsPath, ["---print-level=5", compiler_uri.fsPath])

			if (stderr){
				console.log("Compile Std Err: " + stderr);

				this.outputChannel.clear();
				this.outputChannel.show();

				this.outputChannel.appendLine(stderr);
				this.outputChannel.appendLine("System having issues finding the file? \nIt may be due to spaces in a folder name. Please remove them before continuing.");
				return false;
			}

			if (stdout){
				this.outputChannel.clear();
				//this.outputChannel.show();

				this.outputChannel.appendLine(stdout);
			}

			return true;
		}catch (e){
			console.log("Error: " + e);

			this.outputChannel.clear();
			this.outputChannel.show();

			this.outputChannel.appendLine("Error with compiling function: E1001");
			return false;
		}
	}

	public LaunchDebuggerCLI(file: vscode.TextDocument): boolean{
		let debugger_uri = vscode.Uri.joinPath(this.CLI_path, "./simulator.exe");
		let objFile = file.fileName.substring(0, file.fileName.lastIndexOf(".")) + ".obj";

		try{
			this.debugger = cp.spawn(debugger_uri.fsPath, ["--print-level=8", objFile]);
		}catch (e){
			console.log(e);
			return false;
		}
		
		this.debugger.stdout.setEncoding('utf-8');

		this.cli_buffer = "";

		this.debugger.stdout.on("data", (data) =>{
			this.cli_buffer += data;
		})

		this.debugger.stderr.on("data", (data) => {
			console.log(data);
		})

		this.debugger.addListener('error', (err: Error) => {
			console.log("Simulator Error: " + err.message);
		});

		return true;
	}

	public CloseDebuggerCLI(){
		if (this.debugger == undefined) return;

		//NOTE: May want to tell the debugger to quit through the stdin instead of just sigterm-ing it
		this.debugger.stdin.end();
		//this.debugger.kill();
		this.debugger = undefined;
	}
}