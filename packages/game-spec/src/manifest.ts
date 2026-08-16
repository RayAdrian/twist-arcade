// packages/game-spec/src/manifest.ts — GameManifest (plan §5.2), pure data.

import type { HarnessThresholds, SoloThresholds } from "./thresholds";

export interface DifficultyTier {
  id: "casual" | "standard" | "ruthless";
  policy: PolicySpec;
  budget: SearchBudget;
  minReplyMs: number; // artificial floor (~250 on casual) — UX feature
  blunder?: { epsilon: number; temperature: number }; // ε-softmax over root visit counts
}

export type SearchBudget =
  | { kind: "deadlineMs"; ms: number } // interactive play — responsive on weak devices
  | { kind: "rollouts"; n: number }; // DETERMINISTIC — same move on every machine

export type PolicySpec =
  | { kind: "random" }
  | { kind: "minimax"; maxDepth?: number } // requires engine.heuristic
  // leafEvaluation forwards to MctsOptions.leafEvaluation (packages/bots/src/mcts.ts): skip the
  // post-tree rollout and score the newly-expanded leaf directly. Omitted (the default) is
  // byte-identical to today — platform-corrections.md C95: this was previously a named,
  // tested MctsOptions field with NO PolicySpec arm to carry it, so no manifest could reach it.
  | { kind: "mcts"; explorationC?: number; leafEvaluation?: boolean }
  | { kind: "beam"; width?: number } // solo Strong (also the hint/ghost feature)
  | { kind: "flat-mc"; rolloutsPerAction?: number }
  | { kind: "mix"; components: { weight: number; policy: PolicySpec }[] };

/** Game-theoretic value under optimal play — `"unknown"` (the default, granting no relief from
 *  any gate) unless PROVEN by an artifact this claim points at. */
export type SolvedValue = "draw" | "p0-win" | "p1-win" | "unknown";

export interface SolvedValueClaim {
  readonly value: SolvedValue;
  /** Pointer to the artifact that PROVES this value — a doc path, optionally with a section
   *  reference (e.g. `"docs/research/games/fadeout-solve-report.md §1.1 (remove-first/solid/
   *  threefold: draw, 128,170 states, all 9 openings drawn)"`). REQUIRED whenever
   *  `value !== "unknown"` — the harness refuses loudly (suites.ts's
   *  `MissingSolvedValueProofError`) rather than trust an assertion with no pointer
   *  (platform-corrections.md C23: "asserting a value is not proving one" — the same
   *  confidence that failed on Wrap's predicted-but-unmeasured FPA; a "none by construction"
   *  balance claim like Bid-Tac-Toe's gets no relief under this rule either). Optional in the
   *  TYPE only so `{ value: "unknown" }` never has to carry a meaningless empty string — the
   *  RUNTIME check is what actually enforces "required for every non-unknown value". */
  readonly proof?: string;

  /** Optional, previously-MEASURED self-play attainment rate for this proven value, WITH
   *  provenance — the same posture `proof` and `ciGateBudget`'s own `reason` fields already
   *  take: a number is evidence about the conditions it was measured under (platform-
   *  corrections.md C25), so a bare rate with no pointer is not accepted (the harness refuses,
   *  same seam as `MissingSolvedValueProofError`).
   *
   *  This is what lets `solved-value-reached` (platform-corrections.md C57) tell apart two
   *  claims a single absolute floor collapsed into the same FAIL: "this game's bots USED TO
   *  reach the value and no longer do" (a real regression — needs a baseline to regress FROM)
   *  vs. "this game's bots have NEVER reached it" (a statement about search adequacy for this
   *  tree, not a regression). Declare this once self-play has genuinely reached the value at a
   *  healthy rate (Fadeout: `{ rate: 1.0, proof: "…C23 sweep, 100% at every tested budget" }`);
   *  a future drop below it is then reported as a loud, real `"fail"` naming the baseline. Omit
   *  it (the default) for a game that has never established one — falling short of
   *  `SOLVED_VALUE_SELF_PLAY_FLOOR` then reports the harness's distinct `"unattained"` status
   *  instead of `"fail"`: visible, never a silent pass, but not a claim of regression either.
   *
   *  `rate` MUST be `> 0` and `<= 1` — the harness refuses loudly
   *  (`InvalidAttainmentBaselineError`) rather than let a declared `0` baseline make every
   *  future measurement look "at or above baseline" and silence the regression check forever.
   *  That refusal is the whole point: a game earns the regression-detecting behavior only by
   *  recording a real, positive, cited number, never by asserting one to duck the gate. */
  readonly attainmentBaseline?: { readonly rate: number; readonly proof: string };
}

export interface GameManifest {
  id: string; // === engine.meta.id (contract test asserts equality)
  title: string; // "Fadeout", "Crackstep", "Mine Run"
  // "Tic-Tac-Toe", "Minesweeper" — drives shelves (buildShelves groups games by this string
  // verbatim, so it must stay a real classic-game name for that grouping to read sensibly).
  //
  // `null` means this game has NO classic-game ancestor to attribute — an original design, not
  // a twist ON anything (e.g. Crackstep, an original floor-coverage path puzzle). `null` is a
  // first-class signal, not a fallback encoded in a string:
  //   - `buildShelves` (packages/shell/src/shelves.ts) routes every `classic: null` game
  //     straight to the "All games" remainder shelf, and NEVER groups two `null` games
  //     together — two originals sharing "no classic" are not a shared classic family, and
  //     grouping them by the shared `null` key would produce a shelf titled "Twists on null",
  //     the same species of garbled copy platform-corrections.md C77 item 4 fixed one level up.
  //   - `classicAttributionLine(classic)` (packages/shell/src/manifest-copy.ts) returns `null`
  //     (render nothing) for a `null` classic. Any shell UI rendering an "a twist on {classic}"
  //     attribution line MUST go through that function rather than template-stringing this
  //     field directly.
  //   - `pickNextTwist` (packages/shell/src/next-twist.ts) never ranks two `null`-classic games
  //     as "the same classic" for the same reason.
  //
  // Historical note: this field used to be a plain `string`, and "no classic" was encoded as an
  // explanatory string STARTING WITH "N/A" (case-insensitive) — a deliberate stopgap
  // (platform-corrections.md C77 item 4) pending this exact migration (task #23). That
  // string-sentinel convention is retired as of this change; `null` is now the only "no
  // classic" signal, and no code should test `classic` against an "N/A"-shaped string.
  classic: string | null;
  ruleSentence: string; // <=90 chars — hard constraint
  tags: string[]; // ["decay"], ["press-your-luck"] — facets, next-twist loop
  estMinutes: number;
  modes: { bot: boolean; hotseat: boolean; asyncLink: boolean }; // solo games: no opponent
  //   modes at all — daily/endless framing is shell scope
  players: { min: number; max: number };
  difficultyTiers: DifficultyTier[]; // DATA consumed by packages/bots (2P games)
  thresholds?: Partial<HarnessThresholds | SoloThresholds>; // overrides platform defaults
  exceptions?: { gate: string; justification: string }[]; // visible in review

  /** CI-GATE-ONLY measurement budgets (platform-corrections.md C19). Cost scales with
   *  `cells x plies x rollouts`, so the platform-wide fixed budget (ruthless at 10,000
   *  rollouts/move) that is comfortable on Fadeout's 3x3 board took Wrap's 6x6 43+ minutes.
   *  These fields let a bigger-board game scale DOWN the search depth the CI ("ci") suite
   *  measures with — the gates measure RELATIVE strength, so a smaller absolute budget is
   *  fine — while `suite: "nightly"` always ignores this and runs the tier's own real,
   *  SHIPPED budget (the plan's "nightly keeps the full-budget table"). Omitted entirely
   *  (the default): behavior is 100% unchanged — a small/cheap game like Fadeout never needs
   *  to touch this. Scaling must never touch the shipped tier itself (C20: "the shipped
   *  ruthless tier was never touched — measurement ran through an in-memory manifest clone");
   *  these fields exist so the harness can build exactly that clone. */
  ciGateBudget?: {
    /** Two-player lane: rollouts substituted for the "ruthless" tier's OWN `budget.n` when
     *  the CI suite runs (never nightly). `runCiSuite`/`runTwoPlayerCiGate` refuse loudly
     *  (TierBudgetCollapseError) rather than run a matchup if this scales ruthless down to or
     *  below the "standard" tier's own budget — a tier gate is meaningless once two tiers
     *  share a budget (C20's Wrap finding: ruthless-vs-standard read a meaningless 50% once
     *  a scaled-down 1,000 collided with standard's own 1,000). */
    twoPlayerCiRollouts?: number;
    /** Solo score-chase lane: rollouts substituted for Strong/Always-Safe's per-decision
     *  search budget when the CI suite runs (never nightly). For a `hiddenInformation: true`
     *  engine this SAME number also sets the determinization sample count K (K = n /
     *  legalMoves.length — packages/bots/src/determinized-flat-mc.ts) — cutting rollouts cuts
     *  K in the same step. `runSoloChaseCiGate` refuses loudly if this drops K below the
     *  floor known (empirically) to keep Strong a meaningful yardstick for the Always-Safe
     *  gate, rather than silently reporting a ratio measured against a too-weak Strong. */
    soloChaseCiRollouts?: number;
    /** platform-corrections.md C27: this lane's self-play-derived gates (two-player: strong-
     *  vs-random / first-player-win-rate / draw-rate / mean-plies / ruthless-vs-standard /
     *  solved-value-reached; solo score-chase: every row that needs a `strong` roster summary)
     *  are too expensive to measure at ALL at suite "ci" for this game's real board/budget —
     *  not merely scaled down (that's `twoPlayerCiRollouts`/`soloChaseCiRollouts` above), but
     *  skipped entirely, with every affected row reporting the harness's `"deferred"` status
     *  (naming nightly as the tier that measures it) instead of `"n/a"` — `"n/a"` means "this
     *  gate does not apply"; a deferred gate DOES apply and WILL be measured, just not here.
     *  `reason` should cite the measured cost (e.g. "Strong-dependent; ~4.6h at seedCount=100
     *  in CI — platform-corrections.md C27") — it is folded verbatim into every deferred row's
     *  detail string, so it is what a reader of the CI report actually sees.
     *
     *  Omitted entirely (the default): behavior is 100% unchanged — a game that never opts in
     *  always measures for real at suite "ci", exactly as before this field existed.
     *
     *  suite "nightly" ALWAYS ignores this field (same rule as the two siblings above) and
     *  measures the full lane for real — enforced twice: structurally, by `runCiSuite`/
     *  `runSoloChaseCiGate` only ever consulting this field when `suite === "ci"`, and
     *  independently by `evaluateCiGates`/`evaluateSoloGates` themselves refusing
     *  (`TwoPlayerDeferredGateAtNightlyError` / `SoloDeferredGateAtNightlyError`) if a caller
     *  ever tries to defer at "nightly" too — a row deferred at EVERY tier is a gate that never
     *  runs, and that must be a loud failure, never a quiet status.
     *
     *  `since` (platform-corrections.md C70): the UTC day ("YYYY-MM-DD") THIS deferral — this
     *  exact `reason`/gate set — was declared, i.e. when a team is authoring or materially
     *  changing this field, they set `since` to that same day (git blame on this field is the
     *  audit trail; `since` is what a machine reads without shelling out to git). This is the
     *  anchor `@twist-arcade/harness`'s deferral-discharge ledger (`deferral-ledger.ts`) ages
     *  an undischarged deferral FROM — a deferral is a promise about the future ("nightly will
     *  measure this"), and C68 established nightly can go dark for arbitrarily long (billing,
     *  not code); `since` is what lets the ledger say how long the promise has gone unkept
     *  without trusting whatever day it happens to first be READ.
     *
     *  Optional only because the ledger degrades safely without it — omitting `since` makes the
     *  ledger anchor to the day it FIRST OBSERVES this deferral, which UNDERSTATES age for any
     *  deferral that predates the ledger's own rollout (exactly the trap this field exists to
     *  avoid). Every real deferral should set it; test fixtures that never touch the ledger do
     *  not need to. */
    deferGatesToNightly?: { reason: string; since?: string };
  };

  /** Game-theoretic value under optimal play, WHEN PROVEN (platform-corrections.md C23).
   *  Omitted (the default) is equivalent to `{ value: "unknown" }` and grants no relief from
   *  any gate. When proven, three two-player CI gates that are UNSATISFIABLE BY CONSTRUCTION
   *  for that value report `n/a` instead of failing forever (never `pass`, never a silent
   *  skip — C2's rule extended from `solo.format` to solved value), and a new gate INVERTS the
   *  check: does self-play actually reach the proven value at a healthy rate, which is the
   *  real regression signal a proven-decided game needs (see suites.ts's
   *  `SOLVED_VALUE_SELF_PLAY_FLOOR`). Fadeout is the first user: `remove-first/solid/threefold`
   *  is an exact-solved draw over 128,170 states (all 9 openings drawn) — see
   *  `docs/research/games/fadeout-solve-report.md` §1.1. */
  solvedValue?: SolvedValueClaim;

  /** Declares that the mirror-bot degeneracy probe (roadmap §6's design gate, "mirror bot
   *  <40% as P2") does not apply to this game (platform-corrections.md C48, routed at C62).
   *  Omitted (the default, and the ONLY way to get `applicable: true` — there is no such
   *  variant to set) means mirroring is presumed meaningful; nothing about this field's
   *  absence changes any existing behavior.
   *
   *  C48's ruling: "where mirroring is provably not value-preserving, the probe cannot
   *  measure its claim... a WARN invites someone to tune away a number that never meant
   *  anything." The correct report is `n/a`, citing why — never a silent skip and never
   *  folded into a passing score (C2's rule, same shape as `solvedValue`'s relief above).
   *
   *  `reason` is REQUIRED and MUST be non-empty — the harness refuses loudly
   *  (suites.ts's `EmptyMirrorProbeReasonError`) rather than accept a bare opt-out, the same
   *  posture `exceptions[].justification` and `solvedValue.proof` already take at this exact
   *  seam: a declaration that silences a probe must be visible and reviewable, never a
   *  waiver a game can reach for just because a real mirror strategy would score badly.
   *  Duel Draft (no prior move WITHIN a round to mirror under simultaneity) is the one known
   *  user reachable from this branch today — see `games/duel-draft/probes.ts`'s own module doc
   *  for the reasoning in full. Bid-Tac-Toe is expected to be a second user (spatially symmetric
   *  board, but bids/the star have no reflective analogue) once that game's branch merges — it
   *  does not exist on any branch reachable from here yet, so there is no `probes.ts` of its own
   *  to point at until then. */
  mirrorProbe?: { readonly applicable: false; readonly reason: string };

  /** Present iff players.max === 1. Drives which harness model and gate table apply. */
  solo?: {
    format: "daily-puzzle" | "score-chase";
    moveCap?: number; // default 2000 (chases); structural termination is still
    //   mandatory — the cap is a tripwire, not a rule
    scoreMonotone?: boolean; // enables the testkit monotonicity property
    /** §3.2 scale caveat from the solo lens: ratios need a score linear in achievements.
     *  Exponential-score games (2048-family) declare a linear proxy the harness compares
     *  on instead. */
    comparisonMetric?: "score" | { proxy: string };
    /** chase games: per-game Always-Safe hook is REQUIRED (harness enforces, §7.4) */
  };
}

/** 90-char rule check, asserted by the contract test on any manifest passed to it (also
 *  usable standalone). Kept here (data-adjacent) rather than in testkit so game-spec stays
 *  the single owner of manifest-shape invariants. */
export function assertRuleSentenceLength(manifest: Pick<GameManifest, "ruleSentence">): void {
  if (manifest.ruleSentence.length > 90) {
    throw new Error(
      `manifest.ruleSentence must be <=90 chars, got ${manifest.ruleSentence.length}: "${manifest.ruleSentence}"`
    );
  }
}
