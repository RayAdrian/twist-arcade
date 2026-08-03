# Wiring the DY1 guards into CI

**Status: written, not wired.** `.github/workflows/ci.yml` currently runs typecheck / lint /
test / engine-purity / build / e2e — none of `guard:immutability`, `guard:era-changelog`, or
`guard:manifests` (all three `pnpm --filter @twist-arcade/daily run guard:*` scripts, defined in
`packages/daily/package.json`) are invoked anywhere. That means a committed retune of a shipped
manifest, or an unreviewed `era.json` edit, merges green today — DY1's entire deliverable is
this enforcement, and none of it currently runs. `ci.yml` is owned by another agent right now
(M4 work); this file is the exact diff for whoever routes it in, plus the three traps a
naive wiring falls into.

## The three traps

1. **Shallow clone.** `actions/checkout@v4` defaults to `fetch-depth: 1` — a single commit, no
   history for `origin/main`. Both `guard:immutability` and `guard:era-changelog` run
   `git diff <base>...HEAD`, which needs the base ref's history actually present locally or the
   command either errors ("is the base ref fetched?" — `check-daily-immutability.ts`'s own
   message) or, worse, silently produces the wrong diff. Fix: `fetch-depth: 0` (full history) on
   the checkout step, or an explicit `git fetch origin main` before running the guards. Prefer
   `fetch-depth: 0` — simplest, and this repo is small enough that the cost is negligible.

2. **`guard:manifests` fails today, correctly.** `verify-manifests.ts` hard-fails when the
   upcoming-manifest buffer drops below 7 days (`buffer.ts`'s `classifyBuffer`), alerts (does not
   fail) below 30. Right now there is only a demo buffer of a handful of days — wiring this guard
   unconditionally into required CI breaks every PR immediately, for a reason that has nothing to
   do with the PR's own diff.

   **Recommendation: wire it in as a required step from day one, buffer floor unchanged (7).**
   Do not special-case or loosen the threshold — that is exactly the kind of "recorded allowance"
   that quietly becomes permanent. Instead, treat the red build as the correct, honest signal
   that the manifest buffer needs to catch up (`pnpm --filter @twist-arcade/daily run
   daily:schedule` + hand-composing real manifests) before this guard can be required — i.e. fix
   the data, not the gate. If the buffer genuinely cannot be caught up before this lands, the
   fallback is a time-boxed, explicitly-dated exception recorded in this file (e.g. "alert-only
   until 2026-09-01, hard floor after") — never a silent threshold edit in `buffer.ts` itself.

3. **`--today` must come from the pipeline, not the runner's local clock.** Both
   `check-daily-immutability.ts` and `verify-manifests.ts` default `--today` to the real UTC date
   if the flag is omitted — fine for local use, but a CI runner's wall clock is not something to
   trust for "which days count as shipped" (a runner in a misconfigured timezone or with a
   skewed clock could either free a day that's actually already shipped, or freeze a day that
   isn't). Pass `--today $(date -u +%F)` explicitly from the workflow step (computed by the
   workflow itself, immediately before the guard runs) rather than omitting the flag.

## The exact steps to add

Insert after the existing `Test` step (or wherever the routing agent judges the right position —
before `Build`, since a guard failure should short-circuit before spending build minutes):

```yaml
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # guard:immutability / guard:era-changelog diff against origin/main

      # ...(existing pnpm/node setup steps, install, typecheck, lint, test unchanged)...

      - name: Compute today's UTC date (guards must not trust the runner's local clock)
        id: today
        run: echo "date=$(date -u +%F)" >> "$GITHUB_OUTPUT"

      - name: Daily manifest immutability guard (DY1 — shipped days are frozen forever)
        run: pnpm --filter @twist-arcade/daily run guard:immutability -- --base origin/main --today ${{ steps.today.outputs.date }}

      - name: Daily era-changelog review guard (DY1 — a bot retune must always be a reviewed, visible event)
        run: pnpm --filter @twist-arcade/daily run guard:era-changelog -- --base origin/main

      - name: Daily manifest validity + buffer guard (DY1 — formula re-derivation, era cross-check, 7-day floor)
        run: pnpm --filter @twist-arcade/daily run guard:manifests -- --today ${{ steps.today.outputs.date }}
```

Notes on the exact form above:

- `--base origin/main` is explicit even though it's each script's own default — a workflow
  should never depend on a CLI default silently doing the right thing; if the default ever
  changes, an explicit flag here doesn't silently follow it.
- `guard:manifests` takes no `--base` (it only reads the working tree + `today`, no diff), hence
  the shorter flag set.
- On `pull_request` events, `origin/main` needs to actually resolve — `actions/checkout@v4` on a
  `pull_request` trigger checks out the merge ref by default and fetches `origin/main` as part of
  the standard checkout when `fetch-depth: 0` is set, so no extra fetch step should be needed;
  confirm this against whatever `ci.yml` looks like by the time this is routed in, since another
  agent is actively editing it.

## The guard-exists-but-uncalled regression test

`test/guards-wired.test.ts` (new, in this package) reads `package.json`'s `scripts` for every key
matching `^guard:`, then greps `.github/workflows/*.yml` for each script name as a literal
substring of a `run:` line. It fails, naming the missing script(s), if any `guard:*` entry has no
corresponding invocation anywhere in the workflow directory. This is a regression test for
exactly this bug: a guard nobody calls is silent by construction, so the thing that must be
loud is "a guard was added/exists and nothing invokes it" — a lint on the CI config itself, not a
lint on the guards' own logic (which is already covered by `immutability.test.ts` /
`era-guard.test.ts`'s planted-violation tests).

This test currently **fails** (0 of 3 `guard:*` scripts are invoked anywhere in
`.github/workflows/`) — expected, since this file describes work not yet routed into `ci.yml`.
Once the steps above are added, it goes green. It is intentionally left red rather than skipped:
a skipped test here would be exactly as silent as the bug it exists to catch.
