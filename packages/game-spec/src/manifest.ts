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
  | { kind: "mcts"; explorationC?: number }
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
}

export interface GameManifest {
  id: string; // === engine.meta.id (contract test asserts equality)
  title: string; // "Fadeout", "Crackstep", "Mine Run"
  classic: string; // "Tic-Tac-Toe", "Minesweeper" — drives shelves
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
