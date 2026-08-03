# Daily bot changelog

Every entry corresponds to an `era` bump in `data/daily/era.json` — plan §2.3's era-snapshot
guard (`packages/daily/src/era-guard.ts`) fails CI on any `era.json` edit that isn't paired with
a line here in the same diff. This file is the human-readable review trail for what "Standard
tier, era N" actually was for each two-player daily game — read it before trusting a comparison
across two dailies that pin different eras of the same game.

## fadeout

- **era 1** (2026-08-03, seed data for DY0-DY2 tooling) — initial pinned record: `standard` tier,
  `mcts` policy, `rollouts: 1000` budget, no blunder, `botsVersion: "0.1.0"`, `humanSeat: 0`.
  Pending F4 tuning (plan §11.1 DY2) — this era number is expected to bump again once Fadeout's
  Standard tier is actually tuned; today's value exists only to exercise the guard tooling ahead
  of real content.
