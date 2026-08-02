import { classicTicTacToe } from "../testkit/fixtures/classic-ttt";
import { engineContract } from "../testkit/contract";

engineContract(classicTicTacToe, { maxPlies: 9, runs: 30 });
