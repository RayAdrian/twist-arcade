import { miniCrackstep } from "../testkit/fixtures/mini-crackstep";
import { engineContract } from "../testkit/contract";

engineContract(miniCrackstep, { maxPlies: 30, runs: 30 });
