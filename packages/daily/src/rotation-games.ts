// packages/daily/src/rotation-games.ts — the local game-role table `pnpm daily:schedule` runs
// against today (plan §11.1 DY0: "rotation generator + daily:schedule CLI (against fixture
// certificates)" — this stage is explicitly scoped to run against FIXTURE data, not the real
// game registry). `games/registry.ts` is still empty (no game has been wired into the app's
// catalog yet); GameManifest also carries no "flagship"/rotation-frequency concept of its own
// (deliberately — that's a daily-specific classification, same pattern as share.ts's local
// GLYPH_TABLE for the same reason: game-spec is a frozen platform-owned seam, and this attribute
// is scoped to this team, not the platform).
//
// THIS IS PROVISIONAL, NOT THE FULL LAUNCH SLATE: only fadeout and mine-run currently have real
// engine code in this repo (games/fadeout, games/mine-run); crackstep is referenced throughout
// this package's tests/fixtures as an upcoming solo-puzzle game but has no `games/crackstep`
// directory yet. Extend this table (and swap its source for the real registry once populated) as
// each of the plan's eight launch games actually lands — that is an additive edit here, not a
// rewrite of rotation.ts's policy engine.

import type { RotationGame } from "./rotation";

export const LAUNCH_GAMES: readonly RotationGame[] = [
  { gameId: "fadeout", kind: "vs-bot", role: "flagship" },
  { gameId: "crackstep", kind: "solo-puzzle", role: "solo-frequent" },
  { gameId: "mine-run", kind: "solo-chase", role: "regular" },
];
