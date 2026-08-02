# Platform corrections — found during game planning

*Orchestrator-owned. Three corrections to `phase-0-platform-spine.md`, each surfaced by a
game team's planning pass after that plan was written and approved. None affects M1; all
are binding on the milestone named. 2026-08-02.*

Why this file exists: the game plans found real errors in the platform plan. That is the
system working — a plan reviewed only by its author is a plan reviewed by nobody — but the
findings must reach the platform implementer at the right milestone rather than living in
a chat log.

---

## C1 — Policies for hidden-information games must receive the view, not the state

**Milestone: M2 (bots) and M3b/M3c (harness). Severity: critical — fails silently.**

*Found by: Mine Run plan, §4.4.*

Harness policies currently receive the full canonical state. For a game with
`hiddenInformation: true`, that means a "Strong" agent can read unrevealed secrets —
mine positions, an opponent's hidden pile — and play at a level no human could reach.

The consequence is not a crash. It is a **passing gate on a broken game**: Strong posts a
Strong/Random ratio far above threshold, the CI gate goes green, the game ships, and it is
unplayable blind. Nothing errors. The number simply means something other than what
everyone reading it believes.

**Fix, in preference order:**

1. **Type-level (preferred).** Policies evaluated against a hidden-info game receive
   `playerView(state, seat)`, not `state`. View-honesty stops being a discipline the
   policy author must remember and becomes something the compiler enforces.
2. **Runtime probe (keep regardless).** The resampling test from the Mine Run plan: fix a
   view, re-deal the hidden worlds consistent with it, assert the policy returns an
   identical move. A compile-time guarantee plus a runtime probe is the right
   belt-and-braces for a failure this quiet.

This also means the harness cannot use a single policy-invocation signature across
perfect- and hidden-information games without care — that seam is where the bug would come
back.

---

## C2 — Solo CI gates must be selected by `manifest.solo.format`, not by player count

**Milestone: M3c (solo suite). Severity: blocking for the solo games.**

*Found by: Crackstep plan.*

Crackstep and Mine Run are both `maxPlayers: 1` and share almost no gates. Crackstep is a
deterministic puzzle: it has no `score()`, no `safeMove`, and structural termination, so
the score-chase gates (Strong/Random ratio, score-distribution overlap, Always-Safe, Grind,
run-length CV, ceiling pile-up) are not merely unmet — they are **inapplicable**. Mine Run
is a score chase and needs all of them.

Keying the gate table on player count would run score-chase gates against a puzzle and
hard-error it for lacking a `safeMove` hook it has no business having.

**Fix:** the `solo-ci` / `solo-design` runners select their gate table from
`manifest.solo.format` (`puzzle` | `chase`). A gate that does not apply to a format must be
reported as **explicitly N/A**, never silently skipped — a skipped gate and a passed gate
must never look the same in a report.

---

## C3 — `harness solve` is not generic; history-dependent games compose it locally

**Milestone: M3a (solver). Severity: documentation and API shape.**

*Found by: Fadeout plan, §3.4 / §14.*

Platform plan §7.6 implies `harness solve <game>` works for any game under the state-space
ceiling. It does not. Under **superko**, legality depends on the history of positions
reached, so that history lives in the state — and `encode` is therefore *not* a valid
position key. Deduplicating on `encode` would conflate genuinely different game states and
silently misvalue the solve.

**Fix:** ship `harness solve` with an explicit caveat and expose the reach/retrograde
building blocks as importable pieces, so a history-dependent game composes a game-local
solver instead of receiving a broken promise. Fadeout's solve is such a script.

The general test for a future author, worth stating in the docs: **if legality or outcome
depends on the path taken rather than the position reached, `encode` is not a position
key.** Fadeout (superko) is one pattern; Crackstep is the other — its positions can never
repeat, so `encode` is a sound key and the generic dedup works directly.

---

## Related, already routed to their owning teams

- **`firstOccurrence` becomes an array** (shell). Games have more than one teachable
  first — Crackstep alone has the first crumble and the first stone-tile survival. Each
  entry carries its own once-per-device flag key.
- **Determinized Strong lives in `packages/bots`** (M2), not in any game. It is reused by
  every hidden-info game and it becomes the shipped hint feature; a game-local copy would
  fork the thing players actually touch.
- **A documented exception to the 48 px cell floor** exists for Mine Run (10×10 cannot fit
  at a 320 px viewport), conditional on mandatory two-tap commit on every platform. The
  shell team owns the floor and must know it has exactly one sanctioned violation.
