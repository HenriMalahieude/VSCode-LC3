import { Test } from 'mocha';
import { SimulationTester } from './testSimulator'

async function main() {
	try {

		let SimSuite = new SimulationTester();
		SimSuite.runAllTests();

	}catch(e){
		console.error("Failed to run tests? " + e);
		process.exit(1);
	}
}

main();