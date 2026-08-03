# `data/daily/` — daily manifest buffer

Committed daily manifests (plan `docs/plans/daily-and-share.md` §1.2/§1.4), one file per day at
`data/daily/<yyyy-mm-dd>.json`, plus `era.json` (pinned two-player bot records, §2.2) and
`CHANGELOG.md` (the human review trail for every era bump).

**Current status: 5 fixture/demo days (2026-09-01 through 2026-09-05, fadeout vs-bot), not the
real >=90-day buffer.** These exist to give the DY1 CI guard tooling
(`packages/daily/src/bin/*.ts`) something real to check end-to-end — they are not yet actual
launch content. Running `pnpm --filter @twist-arcade/daily run guard:manifests` against this
directory today correctly reports `buffer=fail` (5 days < the 7-day hard-fail floor) — that is
the guard doing its job, not a bug. Real scheduling starts once `pnpm daily:schedule` has real
game content (registered games, tuned bot eras, Crackstep certificates) to draw from.

**Immutability (plan §2.3): once a day's real wall-clock date reaches or passes that file's
`day`, the file is frozen forever.** `pnpm --filter @twist-arcade/daily run guard:immutability`
enforces this against `git diff` vs a base ref — see that script's own header comment, and the
final implementation report for a live demonstration of it firing on a retuned "shipped" manifest.
