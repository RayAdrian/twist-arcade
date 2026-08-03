// games/mine-run/test/engine-contract.test.ts
//
// The assignment's central requirement: "Your engine must pass engineContract(engine) from
// @twist-arcade/engine/testkit." Runs against the real launch configuration (10x10, 20 mines,
// budget 60 — R1/R10), wired with the secretExtractor (hiddenInformation: true makes it
// mandatory) and scoreMonotone: true (R11 — score() === banked, which never decreases).

import { engineContract } from "@twist-arcade/engine/testkit";
import { mineRun } from "../engine";
import { makeMineRunSecretExtractor } from "../secret";

const TOTAL_CELLS = 10 * 10;

engineContract(mineRun, {
  runs: 150,
  maxPlies: 200, // R12: a real run is structurally <= 121 moves; 200 is generous headroom
  secretExtractor: makeMineRunSecretExtractor(TOTAL_CELLS),
  scoreMonotone: true,
});
