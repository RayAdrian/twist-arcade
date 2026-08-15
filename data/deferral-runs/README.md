# `data/deferral-runs/` — committed deferral-discharge evidence

Committed nightly gate-run evidence (`platform-corrections.md` C70, revised per C81's stage-6
review), one file per game per day the nightly gate table actually ran, at
`data/deferral-runs/<gameId>/<yyyy-mm-dd>.json`.

## What this is for

C27 lets a game's expensive, self-play-derived gates report `"deferred"` at the `"ci"` suite
tier and be measured for real at `"nightly"` instead. C68 found nightly has never once
completed a run. C70 built a mechanism so an undischarged deferral ages — visibly, then
fatally — instead of a deferred row printing `OK` forever. A `DeferralRun` file here is the
proof that a specific night's gate table actually measured a specific game's deferred gates for
real; the deferral-discharge ledger (`packages/harness/src/deferral-ledger.ts`) reads every file
under a game's own subdirectory and, if one covers whatever is currently deferred, resets that
deferral's age to the day of the most recent covering run.

## Why this is a directory of small files, not one mutable ledger

The first version of this mechanism (C70) wrote a discharge date into a single mutable
`data/deferral-ledger.json` at suite `"nightly"`. C81's stage-6 review found the fatal flaw:
`.github/workflows/nightly.yml` runs in an **ephemeral** GitHub Actions workspace with **no
commit-back step**, so that write was silently discarded every single night — a kept promise
could never discharge, and the mechanism would have converted "nightly never runs" into "CI is
permanently red and unrecoverable."

This version instead derives discharge from a **committed artifact**, the same way every other
piece of measured evidence in this repository works (`data/certificates/<gameId>/<day>.json`,
`docs/research/games/*.out`): nothing here assumes CI can write to the repo, and nothing here
needs it to. It also makes discharge tamper-evident by construction — there is no single date
field to hand-edit; discharging a promise means producing a whole, dated, reviewable file whose
`measuredGates` genuinely covers what was deferred.

## The manual path (required, since the automated one is blocked on billing)

1. Run the nightly suite locally for the game(s) that still declare a deferral:
   ```
   pnpm harness:ci-gates -- --suite nightly --game <id>
   ```
   This is the same real, full-budget run C27 always intended for nightly — for Mine Run,
   measured at ~4.6 hours at `seedCount=100` (`platform-corrections.md` C27/C29). It writes
   `data/deferral-runs/<gameId>/<today>.json`.
2. Review the printed report, then commit the new file:
   ```
   git add data/deferral-runs/<gameId>/<today>.json
   git commit -m "chore(deferral): <gameId> nightly run <today> — discharges the C27 deferral"
   ```

`.github/workflows/nightly.yml`'s existing `pnpm harness:ci-gates -- --suite nightly` step still
writes the same file into the ephemeral runner's own workspace — that write is harmless and no
longer load-bearing for anything, since discharge no longer depends on it surviving.

## Format

```json
{
  "gameId": "mine-run",
  "lane": "solo-chase",
  "day": "2026-08-15",
  "suite": "nightly",
  "measuredGates": ["strongVsRandomRatio", "distributionOverlap", "..."]
}
```

`measuredGates` is derived from the run's OWN report rows (every row that is not `"n/a"`) —
never a hardcoded canonical list. This is deliberate (C81's A2 finding): a canonical list can
disagree with what a specific manifest's report actually contains that night (a row can
independently be `"n/a"` for a structural reason unrelated to deferral), and discharge is
recognized by **coverage** — this run's `measuredGates` is a superset of whatever is currently
deferred — not by exact-set equality against a constant.
