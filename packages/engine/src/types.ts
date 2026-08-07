// packages/engine/src/types.ts — no imports from react/next/supabase, ever.
// Exact surface per docs/plans/phase-0-platform-spine.md §3.

export type PlayerId = number; // 0-indexed seat; seat -> user mapping is the platform's job.

export type Status =
  | { kind: "ongoing" }
  | { kind: "won"; winner: PlayerId } // solo puzzle solved: winner = 0
  | { kind: "lost" } // SOLO-ONLY terminal failure. Two-player engines never emit it.
  | { kind: "draw" } // solo engines never emit draw.
  | { kind: "scored"; scores: number[] }; // scores.length === numPlayers

export interface Rng {
  next(): number; // [0, 1)
  int(maxExclusive: number): number;
  shuffle<T>(xs: readonly T[]): T[]; // returns a new array
}

// Rng factories (rngFromSeed, rngFor) are implemented in ./rng.ts — the algorithm behind
// them is part of the replay format (see §3.4). Not declared here to avoid a type-only
// declaration shadowing the real implementation.

export type ActiveSpec =
  | { mode: "sequential"; player: PlayerId }
  | { mode: "simultaneous"; players: PlayerId[] };

/** JSON-plain data. Moves and effects must satisfy this (persistence + worker postMessage). */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/**
 * Transient presentation echo of the last apply(). Common vocabulary the shell's animation
 * mapper recognizes: "placed", "removed", "decayed", "moved", "captured", "revealed",
 * "rotated", "banked", "crumbled". Games may add custom types; the shell ignores unknown
 * ones gracefully.
 */
export type Effect = { type: string } & { [k: string]: Json };

export interface WithEffects {
  /** Set (fully overwritten, never appended) by every apply(). setup() sets []. */
  readonly lastEffects: readonly Effect[];
}

export interface GameMeta {
  id: string; // "fadeout" — stable; URLs, replays, registry key
  name: string;
  minPlayers: number; // 1 is legal: solo <=> maxPlayers === 1.
  maxPlayers: number;
  hiddenInformation: boolean; // solo fog games (unrevealed mines) set true
  simultaneous: boolean;
  stochastic: boolean; // any chance events after setup?
  version: number; // bump on ANY rules change; replays store it
}

export interface GameEngine<
  S extends WithEffects,
  M extends Json,
  V extends WithEffects = S, // views carry effects too — see redaction note in the plan
> {
  meta: GameMeta;

  /**
   * All randomness (shuffle, starting player, procedural content) via rng. Solo generation
   * lives here and in apply() — with rngFor's child-seed-per-step rule, replays and
   * leaderboard verification cover generated content with zero new machinery.
   */
  setup(numPlayers: number, rng: Rng): S;

  /** Legal moves for one player. [] means that player cannot act right now. */
  legalMoves(state: S, player: PlayerId): M[];

  /** Cheap membership check; server validation calls this, not legalMoves(). */
  isLegal(state: S, player: PlayerId, move: M): boolean;

  /**
   * Solo engines KEEP active(): return { mode: "sequential", player: 0 } while ongoing. The
   * shell, harness, and replayer loop on active() and must not branch on player count.
   */
  active(state: S): ActiveSpec;

  /**
   * The ONLY transition. One entry for sequential, one per active player for simultaneous.
   * Runs ALL automatic post-move transitions to quiescence. Pure: same (state, moves, rng
   * stream) ⇒ identical result. MUST NOT mutate input. MUST fully overwrite lastEffects.
   */
  apply(state: S, moves: ReadonlyMap<PlayerId, M>, rng: Rng): S;

  status(state: S): Status;

  /**
   * Redaction boundary. player === null is the spectator view. V must contain NO
   * recoverable secret. V's lastEffects is redacted by this same single code path: an
   * effect the player may not see is omitted, not masked.
   */
  playerView(state: S, player: PlayerId | null): V;

  /**
   * Canonical serialization. EXCLUDES lastEffects (effects are recomputable by re-applying).
   * Same logical state ⇒ byte-identical string (solvers hash on this).
   * decode(x).lastEffects === []. Use stableStringify() unless there is a measured reason
   * not to.
   */
  encode(state: S): string;
  decode(encoded: string): S;

  /**
   * Optional per-game eval for minimax/greedy; MCTS needs nothing. Positive = good for player.
   * Only SIGN and ORDERING are contractual — magnitude/range is NOT: implementations must not
   * rely on any particular scale (e.g. "already commensurate with ±1"), because nothing
   * enforces one. Consumers that need a bounded value (packages/bots/src/search-utils.ts's
   * valueOfStatus, used by mcts/flat-mc/beam) squash the result themselves (`Math.tanh`) rather
   * than trusting callers to pre-scale it — do not write a heuristic whose correctness depends
   * on its raw magnitude surviving unchanged.
   */
  heuristic?(state: S, player: PlayerId): number;

  /**
   * NEW (solo-games-lens §4), optional: live score for the HUD, harness learning curves,
   * and the share artifact's progress line. MUST be pure and MUST equal status().scores[0]
   * at a scored terminal (testkit-asserted). Puzzles omit it.
   */
  score?(state: S, player: PlayerId): number;

  /**
   * Declares which of score()/heuristic() a search (packages/bots's valueOfStatus, used by
   * mcts/flat-mc/beam/determinized-flat-mc) should use to value a NON-TERMINAL, horizon-capped
   * rollout leaf (platform-corrections.md C30). REQUIRED when the engine implements BOTH
   * score() and heuristic() — testkit's checkHorizonValueDeclared enforces this, and
   * valueOfStatus itself throws HorizonValueUndeclaredError if it is somehow reached anyway.
   * The finding this closes: valueOfStatus used to default to score() unconditionally whenever
   * it existed, which silently blinded Mine Run's Strong to its entire live-streak mechanic —
   * score() there is `banked` ONLY (correctly: it must equal the "scored" terminal's raw
   * value), while heuristic() carries the streak's continuation value. Only the game's own
   * author knows which quantity is a meaningful mid-game estimate for THEIR game; the platform
   * cannot infer it, and a silent default already produced one wrong answer.
   *
   * Omit this field entirely when the engine implements AT MOST ONE of score()/heuristic() —
   * there is no ambiguity to declare, and the one available hook is used exactly as it always
   * was.
   *
   * Commensurability, not preference, decides how the chosen value is COMBINED
   * (search-utils.ts's valueOfStatus): an engine that implements score() at all has a "scored"
   * terminal by score()'s own contract above ("MUST equal status().scores[0] at a scored
   * terminal"), so whichever hook horizonValue names is used RAW — including
   * horizonValue: "heuristic" — to stay commensurate with that terminal's own raw scale. An
   * engine with no score() at all (a won/lost/draw terminal, ±1 convention) always has its
   * heuristic() squashed via Math.tanh, exactly as before this field existed. Getting this
   * backwards (e.g. squashing whenever "heuristic" is named, regardless of the engine's own
   * terminal convention) would reintroduce the same scale-mixing failure this field exists to
   * prevent, just for scored games instead of won/lost ones.
   */
  horizonValue?: "score" | "heuristic";

  /**
   * Optional: sample a full state consistent with a view — enables determinized MCTS for
   * hidden-info games. Hook in v1; no platform consumer until the ISMCTS fast-follow.
   */
  sampleConsistentState?(view: V, rng: Rng): S;
}
