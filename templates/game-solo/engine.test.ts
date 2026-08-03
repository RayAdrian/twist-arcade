// games/__GAME_ID__/engine.test.ts — the shared contract suite, pre-wired RED (plan §8): the
// solo branch of engineContract() auto-activates because meta.maxPlayers === 1. It fails
// until status() has real rules (engine.ts's own module doc explains exactly why, and exactly
// which single property should fail). This is the TDD stage-2 starting point — do not delete
// or weaken this file to make it pass; implement engine.ts's TODO instead.
//
// `runs: 100` is explicit rather than relying on engineContract's own default (G-14: CI must
// never depend on a library default for its sample count) — a floor future edits to this file
// should preserve, not loosen.

import { engineContract } from "@twist-arcade/engine/testkit";
import { __CAMEL_ID__ } from "./engine";

engineContract(__CAMEL_ID__, { runs: 100, maxPlies: 200 });
