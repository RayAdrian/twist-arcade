import { bankRun } from "../testkit/fixtures/bank-run";
import { engineContract } from "../testkit/contract";

engineContract(bankRun, { maxPlies: 20, runs: 30, scoreMonotone: true });
