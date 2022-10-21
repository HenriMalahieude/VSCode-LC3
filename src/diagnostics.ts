import * as vscode from 'vscode';

export function subscribeToDiagnostics(ctx: vscode.ExtensionContext, dList: vscode.DiagnosticCollection): void {
	//On enabling, check currently active text editor
	if (vscode.window.activeTextEditor){
		refreshDiagnostics(vscode.window.activeTextEditor.document, dList);
	}

	//Any change in specific file we are editting
	ctx.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor && editor.document.fileName.endsWith(".asm")){
				refreshDiagnostics(editor.document, dList);
			}
		})
	);

	//Change in the Document
	ctx.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(doc =>{
			if (doc && doc.document.fileName.endsWith(".asm")){
				refreshDiagnostics(doc.document, dList);
			}
		})	
	)

	//Remove unnecessary information
	ctx.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument(doc =>{
			dList.delete(doc.uri);
		})
	);
}

export function refreshDiagnostics(doc: vscode.TextDocument, dList: vscode.DiagnosticCollection): void {
	const neoStuff: vscode.Diagnostic[] = [];

	for (let i = 0; i < doc.lineCount; i++) {
		let issue = diagnose(doc, i);
		if (issue != null){
			neoStuff.push(issue);
		}
	}

	dList.set(doc.uri, neoStuff);
}

function diagnose(doc: vscode.TextDocument, lineIndex: number): null | vscode.Diagnostic {
	let lineOfText = doc.lineAt(lineIndex);
	let startIndex = lineOfText.firstNonWhitespaceCharacterIndex;
	let txt = lineOfText.text.substring(startIndex);
	const fullLineRange = new vscode.Range(lineIndex, startIndex, lineIndex, lineOfText.text.length);
	const opcodeRange = new vscode.Range(lineIndex, startIndex, lineIndex, startIndex + 3);
	const err = vscode.DiagnosticSeverity.Error;

	//-------------------------------------------------------------------------------Base Cases
	//Nothing or a Comment
	if (lineOfText.isEmptyOrWhitespace || txt.substring(0, 1) == ";") return null;

	//If starts with number
	if (txt.substring(0,1).search("[0-9]") != -1){
		return new vscode.Diagnostic(lineOfText.range, "Label cannot start with a number.", err);
	}
	
	//-------------------------------------------------------------------------------Op Code Special Cases
	if (txt.substring(0, 2).toLocaleUpperCase() == "BR"){
		//Check condition codes
		const parameter: string = txt.substring(2, 5).toLocaleLowerCase().split(" ")[0];
		if (!(parameter === "n" || parameter === "z" || parameter === "p"
			|| parameter === "nz" || parameter === "np" || parameter === "zp" || parameter === "nzp")){
			
			return new vscode.Diagnostic(opcodeRange, "BR has no condition codes.", err);
		}
	}

	//-------------------------------------------------------------------------------Op Codes in General
	let fullOperation = txt.trim().replace(",", "").split(" ");

	//Remove any comments
	for (let i = 0; i < fullOperation.length; i++){
		let comIndex = fullOperation[i].indexOf(";");
		if (comIndex != -1){
			fullOperation[i] = fullOperation[i].substring(0, comIndex); //remove the rest of the comment
			fullOperation = fullOperation.slice(0, i+1); //remove anything else
			break;
		}
	}

	if (fullOperation[fullOperation.length-1] == ""){
		fullOperation.pop();
	}

	const op = fullOperation[0];
	const opform = op.toLocaleUpperCase();

	//Check continousness, WouLdn'T wAnT tHIs riGhT?
	function checkContinuity(): null | vscode.Diagnostic{
		if (op != opform && op != op.toLocaleLowerCase() && opform.substring(0, 2) != "BR"){
			return new vscode.Diagnostic(opcodeRange, "Must be continuously upper or lower case.", err)
		}
		return null;
	}

	function checkRegister(s:string): boolean{
		let n = parseInt(s.substring(1, 2));
		return s.substring(0, 1).toLocaleLowerCase() != "r" || (s.length < 2 || n === undefined || n > 7 || n < 0);
	}

	if (opform === "ADD" || opform === "AND" || opform === "NOT"){
		let c = checkContinuity();
		if (c != null){
			return c;
		}

		if ((opform != "NOT" && fullOperation.length != 4) || (opform === "NOT" && fullOperation.length != 3)){
			return new vscode.Diagnostic(fullLineRange, "Incomplete Statement. Format needed: \nOPC DR, SR, SR\nOPC DR, SR, imm5\nNOT DR, SR", err)
		}

		//Check that DR1 and SR1 are genuinely registers
		if (checkRegister(fullOperation[1])){
			return new vscode.Diagnostic(fullLineRange, "Incorrect Destination Register", err);
		}else if (checkRegister(fullOperation[2])){
			return new vscode.Diagnostic(fullLineRange, "Incorrect Source Register 1", err)
		}
	}else if (opform.substring(0, 2) === "BR" || opform === "JSR"){
		let c = checkContinuity();
		if (c != null){
			return c;
		}

		if (fullOperation.length != 2){
			return new vscode.Diagnostic(fullLineRange, "Incomplete Statement. Format needed: \nOPC label", err);
		}

		if (fullOperation[1].substring(0,1).search("[0-9]") != -1){
			return new vscode.Diagnostic(fullLineRange, "Label cannot start with a number.", err)
		}
	}else if (opform === "JMP" || opform === "JSRR"){
		let c = checkContinuity();
		if (c != null){
			return c;
		}

		if (fullOperation.length != 2){
			return new vscode.Diagnostic(fullLineRange, "Incomplete Statement. Format needed: \nOPC BR", err);
		}

		if (checkRegister(fullOperation[1])){
			return new vscode.Diagnostic(fullLineRange, "Incorrect Base Register", err);
		}
	}else if (opform == "LD" || opform == "LDI" || opform == "LEA" || opform == "ST" || opform == "STI"){
		let c = checkContinuity();
		if (c != null){
			return c;
		}

		if (fullOperation.length != 3){
			return new vscode.Diagnostic(fullLineRange, "Incomplete Statement. Format needed: \nOPC DR, label", err);
		}

		if (checkRegister(fullOperation[1])){
			return new vscode.Diagnostic(fullLineRange, "Incorrect Destination Register", err);
		}
	}

	//-------------------------------------------------------------------------------Pseudo Operators
	const pseudo_op = txt.substring(0, 8).toLocaleUpperCase().split(" ")[0]; //this is wrong
	if (pseudo_op == ".ORIG"){

	}else if (pseudo_op == ".FILL" || pseudo_op == ".STRINGZ"){ //pre-compiler actions

	}else if (pseudo_op == ".END"){

	}

	return null;
}