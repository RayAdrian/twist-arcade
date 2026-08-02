// packages/engine/testkit/contract.ts — the shared property-test kit (plan §4).
//
// Design note: every property is implemented as a plain, framework-free function that
// THROWS a descriptive Error when the property is violated. `engineContract()` is a thin
// vitest adapter that wraps each one in `it(...)`. This split is deliberate: the testkit's
// own self-tests (test/testkit-self-test.test.ts) call the raw check functions directly
// against deliberately-broken mutant engines and assert they throw — "the kit's own suite
// asserts each mutant fails the right property" (plan §4) is only possible to express
// cleanly if the properties are callable outside of vitest's `it()` registration.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see verifyCertificate below
import type { Effect, GameEngine, Json, PlayerId, Rng, WithEffects } from "../src/types";
import { rngFor, rngFromSeed } from "../src/rng";
import { stableStringify } from "../src/encode";
import { replay, type ReplayRecord } from "../src/replay";
import { describe, expect, it } from "vitest";

export interface ContractOptions {
  runs?: number; // fast-check-style iteration count per property (default: 20)
  maxPlies?: number; // default 200; solo score-chases should pass their manifest's moveCap
  playerCounts?: number[]; // default: [meta.minPlayers .. meta.maxPlayers]
  /**
   * Hidden-info AND solo-fog games: extract secret strings (opponent secrets, or unrevealed
   * generated content) from canonical S for a given viewer. The kit asserts
   * JSON.stringify(playerView(S, p)) — INCLUDING its lastEffects array — contains none of
   * them, across random playouts. Required when meta.hiddenInformation is true.
   */
  secretExtractor?: (state: unknown, player: PlayerId) => string[];
  /**
   * NOT in the plan's literal ContractOptions listing, added here to make the score
   * monotonicity property (plan §3's score rule: "if the manifest declares
   * solo.scoreMonotone: true, never decreases") actually checkable — engineContract() has
   * no manifest to read. Games whose manifest sets solo.scoreMonotone should pass
   * `{ scoreMonotone: true }` here too. Documented as a deviation in the handoff report.
   */
  scoreMonotone?: boolean;
}

// ---------------------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------------------

/** Permissive structural canonicalization for deep-equality checks in this file only —
 *  NOT the game-facing encode() contract (that lives in src/encode.ts and is stricter about
 *  the Json type). Accepts arbitrary values so it can compare full states/views generically. */
function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
  }
  throw new TypeError(`canonical(): unsupported value of type ${typeof value}`);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

class ContractViolation extends Error {
  constructor(property: string, detail: string) {
    super(`[engineContract] "${property}" violated: ${detail}`);
    this.name = "ContractViolation";
  }
}

// ---------------------------------------------------------------------------------------
// Random playout — mirrors replay.ts's rng scheme exactly (setup <- rngFromSeed(seed),
// step k's apply <- rngFor(seed, k)) so a playout's move log is directly replay()-able.
// ---------------------------------------------------------------------------------------

interface PlayoutResult<S extends WithEffects> {
  states: S[];
  record: ReplayRecord;
  capHit: boolean;
}

function randomPlayout<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  matchSeed: string,
  numPlayers: number,
  maxPlies: number
): PlayoutResult<S> {
  const driverRng: Rng = rngFromSeed(`${matchSeed}:driver`);
  let state = engine.setup(numPlayers, rngFromSeed(matchSeed));
  const states: S[] = [state];
  const steps: ReplayRecord["steps"] = [];

  let ply = 0;
  for (; ply < maxPlies; ply++) {
    if (engine.status(state).kind !== "ongoing") break;

    const active = engine.active(state);
    const actors = active.mode === "sequential" ? [active.player] : active.players;
    const movesEntries: [PlayerId, Json][] = [];
    const movesMap = new Map<PlayerId, M>();

    for (const p of actors) {
      const legal = engine.legalMoves(state, p);
      if (legal.length === 0) {
        throw new ContractViolation(
          "no-hidden-pass",
          `active() listed player ${p} but legalMoves() returned [] while status was ongoing ` +
            `at ply ${ply} (encoded state: ${engine.encode(state)}). A player active() lists ` +
            "must always have >=1 legal move while ongoing."
        );
      }
      const idx = driverRng.int(legal.length);
      const move = legal[idx]!;
      movesEntries.push([p, move as unknown as Json]);
      movesMap.set(p, move);
    }

    const stepRng = rngFor(matchSeed, ply);
    state = engine.apply(state, movesMap, stepRng);
    states.push(state);
    steps.push({ moves: movesEntries });
  }

  return {
    states,
    record: {
      gameId: engine.meta.id,
      gameVersion: engine.meta.version,
      engineVersion: "testkit",
      numPlayers,
      seed: matchSeed,
      steps,
    },
    capHit: ply >= maxPlies && engine.status(state).kind === "ongoing",
  };
}

function playerCountsFor<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  opts: ContractOptions
): number[] {
  if (opts.playerCounts) return opts.playerCounts;
  const out: number[] = [];
  for (let n = engine.meta.minPlayers; n <= engine.meta.maxPlayers; n++) out.push(n);
  return out;
}

// ---------------------------------------------------------------------------------------
// Property check functions — each throws ContractViolation on failure.
// ---------------------------------------------------------------------------------------

/** Purity: apply() must not mutate its `state` or `moves` arguments. Detected by deep-
 *  freezing the input before calling apply(); a mutation attempt throws a TypeError in
 *  strict mode (ESM modules are always strict), which we re-surface as a ContractViolation. */
export function checkPurity<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  opts: ContractOptions = {}
): void {
  const maxPlies = opts.maxPlies ?? 200;
  for (const numPlayers of playerCountsFor(engine, opts)) {
    const seed = `purity-${numPlayers}`;
    let state = deepFreeze(engine.setup(numPlayers, rngFromSeed(seed)));
    for (let ply = 0; ply < Math.min(maxPlies, 30); ply++) {
      if (engine.status(state).kind !== "ongoing") break;
      const active = engine.active(state);
      const actors = active.mode === "sequential" ? [active.player] : active.players;
      const movesMap = new Map<PlayerId, M>();
      for (const p of actors) {
        const legal = engine.legalMoves(state, p);
        if (legal.length === 0) break;
        movesMap.set(p, deepFreeze(legal[0]!));
      }
      if (movesMap.size === 0) break;
      let next: S;
      try {
        next = engine.apply(state, movesMap, rngFor(seed, ply));
      } catch (err) {
        if (err instanceof TypeError) {
          throw new ContractViolation(
            "purity",
            `apply() attempted to mutate a frozen input at ply ${ply}: ${(err as Error).message}`
          );
        }
        throw err;
      }
      state = deepFreeze(next);
    }
  }
}

/** Termination: a random legal playout must reach a non-ongoing status within maxPlies. */
export function checkTermination<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  opts: ContractOptions = {}
): void {
  const maxPlies = opts.maxPlies ?? 200;
  const runs = opts.runs ?? 20;
  for (const numPlayers of playerCountsFor(engine, opts)) {
    for (let i = 0; i < runs; i++) {
      const { capHit } = randomPlayout(engine, `termination-${numPlayers}-${i}`, numPlayers, maxPlies);
      if (capHit) {
        throw new ContractViolation(
          "termination",
          `a random legal playout with ${numPlayers} player(s) did not terminate within ${maxPlies} plies`
        );
      }
    }
  }
}

/** Determinism: same seed + same move choices (driven by a seed-derived driver) ⇒
 *  byte-identical trajectory, INCLUDING effects. Catches internal Math.random() leaks and
 *  any other hidden nondeterminism. This is also the solo "determinism-through-generation"
 *  property: any procedurally generated content is part of the trajectory and so is covered
 *  by the same check. */
export function checkDeterminism<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  opts: ContractOptions = {}
): void {
  const maxPlies = opts.maxPlies ?? 200;
  const runs = opts.runs ?? 10;
  for (const numPlayers of playerCountsFor(engine, opts)) {
    for (let i = 0; i < runs; i++) {
      const seed = `determinism-${numPlayers}-${i}`;
      const a = randomPlayout(engine, seed, numPlayers, maxPlies);
      const b = randomPlayout(engine, seed, numPlayers, maxPlies);
      if (a.states.length !== b.states.length) {
        throw new ContractViolation(
          "determinism",
          `two playouts from the same seed produced trajectories of different length (${a.states.length} vs ${b.states.length})`
        );
      }
      for (let k = 0; k < a.states.length; k++) {
        const encA = engine.encode(a.states[k]!);
        const encB = engine.encode(b.states[k]!);
        if (encA !== encB) {
          throw new ContractViolation(
            "determinism",
            `state ${k} diverged between two same-seed playouts: ${encA} !== ${encB}`
          );
        }
        const effA = canonical(a.states[k]!.lastEffects);
        const effB = canonical(b.states[k]!.lastEffects);
        if (effA !== effB) {
          throw new ContractViolation(
            "determinism",
            `lastEffects at state ${k} diverged between two same-seed playouts: ${effA} !== ${effB}`
          );
        }
      }
      // Cross-check against replay(): re-running the recorded move log through replay()
      // must reproduce the exact same trajectory too (this is the leaderboard-verification
      // property — a stored (seed, moveLog) pair must be independently reproducible).
      const replayed = replay(engine, a.record);
      if (replayed.states.length !== a.states.length) {
        throw new ContractViolation(
          "determinism",
          "replay() of the playout's own move log produced a different-length trajectory"
        );
      }
      for (let k = 0; k < a.states.length; k++) {
        if (engine.encode(replayed.states[k]!) !== engine.encode(a.states[k]!)) {
          throw new ContractViolation(
            "determinism",
            `replay() diverged from the live playout at state ${k}`
          );
        }
      }
    }
  }
}

/** encode/decode canonical-form properties (plan §3, §3.2):
 *  - encode(decode(encode(s))) === encode(s)
 *  - decode(x).lastEffects === []
 *  - two states identical except for lastEffects hash IDENTICALLY (encode excludes effects)
 *  - apply()'s output lastEffects must not depend on the INPUT state's stale lastEffects
 *    (this is the generic form of "effects are fully overwritten, never appended/accumulated") */
export function checkEncodeDecodeAndEffects<
  S extends WithEffects,
  M extends Json,
  V extends WithEffects,
>(engine: GameEngine<S, M, V>, opts: ContractOptions = {}): void {
  const maxPlies = opts.maxPlies ?? 200;
  for (const numPlayers of playerCountsFor(engine, opts)) {
    const { states, record } = randomPlayout(engine, `encode-${numPlayers}`, numPlayers, maxPlies);

    for (const state of states) {
      const enc = engine.encode(state);
      const decoded = engine.decode(enc);
      if (decoded.lastEffects.length !== 0) {
        throw new ContractViolation(
          "encode/decode",
          `decode(encode(state)).lastEffects must be [], got ${canonical(decoded.lastEffects)}`
        );
      }
      const reEncoded = engine.encode(decoded);
      if (reEncoded !== enc) {
        throw new ContractViolation(
          "encode/decode",
          `encode(decode(encode(s))) !== encode(s): ${reEncoded} !== ${enc}`
        );
      }

      // Canonical-form: inflating lastEffects must not change encode()'s output.
      const inflated = { ...state, lastEffects: [...state.lastEffects, { type: "__contract_decoy__" }] } as S;
      const encInflated = engine.encode(inflated);
      if (encInflated !== enc) {
        throw new ContractViolation(
          "encode-excludes-lastEffects",
          "encode() output changed when lastEffects was mutated — encode() MUST exclude " +
            "lastEffects from the canonical form (plan §3.2). This is the property that " +
            "protects repetition/superko detection in decay games from silently breaking."
        );
      }
    }

    // Effects-overwritten: apply() must not fold the input state's stale lastEffects into
    // its output. Take each consecutive (state, move, rng) transition from the real
    // trajectory and re-run it from an input whose lastEffects has been artificially
    // inflated; the OUTPUT lastEffects must be identical either way.
    for (let k = 0; k < record.steps.length; k++) {
      const before = states[k]!;
      const after = states[k + 1]!;
      const step = record.steps[k]!;
      const movesMap = new Map<PlayerId, M>(step.moves.map(([p, m]) => [p, m as unknown as M]));
      const beforeInflated = {
        ...before,
        lastEffects: [...before.lastEffects, { type: "__contract_decoy_a__" }, { type: "__contract_decoy_b__" }],
      } as S;
      const afterFromInflated = engine.apply(beforeInflated, movesMap, rngFor(record.seed, k));
      const realEffects = canonical(after.lastEffects);
      const inflatedEffects = canonical(afterFromInflated.lastEffects);
      if (realEffects !== inflatedEffects) {
        throw new ContractViolation(
          "effects-never-accumulate",
          `apply()'s output lastEffects depended on the INPUT state's stale lastEffects at ` +
            `step ${k} (${realEffects} vs ${inflatedEffects}) — effects must be fully ` +
            "overwritten every apply(), never appended to."
        );
      }
    }
  }
}

/** isLegal(s,p,m) must be true for every m returned by legalMoves(s,p). */
export function checkLegalityCoherence<
  S extends WithEffects,
  M extends Json,
  V extends WithEffects,
>(engine: GameEngine<S, M, V>, opts: ContractOptions = {}): void {
  const maxPlies = opts.maxPlies ?? 200;
  for (const numPlayers of playerCountsFor(engine, opts)) {
    const { states } = randomPlayout(engine, `legality-${numPlayers}`, numPlayers, maxPlies);
    for (const state of states) {
      for (let p = 0; p < numPlayers; p++) {
        const legal = engine.legalMoves(state, p);
        for (const move of legal) {
          if (!engine.isLegal(state, p, move)) {
            throw new ContractViolation(
              "legality-coherence",
              `legalMoves(state, ${p}) included ${stableStringify(move as unknown as Json)} but isLegal() rejected it`
            );
          }
        }
      }
    }
  }
}

/** playerView must never throw, for any seat 0..maxPlayers-1 and for the spectator (null). */
export function checkPlayerViewTotal<
  S extends WithEffects,
  M extends Json,
  V extends WithEffects,
>(engine: GameEngine<S, M, V>, opts: ContractOptions = {}): void {
  const maxPlies = opts.maxPlies ?? 200;
  for (const numPlayers of playerCountsFor(engine, opts)) {
    const { states } = randomPlayout(engine, `view-total-${numPlayers}`, numPlayers, maxPlies);
    for (const state of states) {
      const seats: (PlayerId | null)[] = [null];
      for (let p = 0; p < numPlayers; p++) seats.push(p);
      for (const seat of seats) {
        try {
          engine.playerView(state, seat);
        } catch (err) {
          throw new ContractViolation(
            "playerView-total",
            `playerView(state, ${seat === null ? "null" : seat}) threw: ${(err as Error).message}`
          );
        }
      }
    }
  }
}

/** meta.hiddenInformation === false ⇒ playerView(state, p) deep-equals state for every seat
 *  (perfect-info games get playerView = identity "for free" per architecture-lens §1). */
export function checkPerfectInfoIdentity<
  S extends WithEffects,
  M extends Json,
  V extends WithEffects,
>(engine: GameEngine<S, M, V>, opts: ContractOptions = {}): void {
  if (engine.meta.hiddenInformation) return; // not applicable
  const maxPlies = opts.maxPlies ?? 200;
  for (const numPlayers of playerCountsFor(engine, opts)) {
    const { states } = randomPlayout(engine, `perfect-info-${numPlayers}`, numPlayers, maxPlies);
    for (const state of states) {
      for (let p = 0; p < numPlayers; p++) {
        const view = engine.playerView(state, p);
        if (canonical(view) !== canonical(state)) {
          throw new ContractViolation(
            "perfect-info-identity",
            `meta.hiddenInformation is false but playerView(state, ${p}) !== state`
          );
        }
      }
    }
  }
}

/** Hidden-info / solo-fog redaction: no secret string (as identified by secretExtractor)
 *  may appear anywhere in JSON.stringify(playerView(state, viewer)) — including lastEffects,
 *  which is redacted through the SAME single playerView path as everything else. */
export function checkRedaction<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  opts: ContractOptions = {}
): void {
  if (!opts.secretExtractor) {
    if (engine.meta.hiddenInformation) {
      throw new ContractViolation(
        "redaction",
        "meta.hiddenInformation is true but no secretExtractor was provided to engineContract() " +
          "— the redaction property cannot run without one (plan §4)."
      );
    }
    return;
  }
  const secretExtractor = opts.secretExtractor;
  const maxPlies = opts.maxPlies ?? 200;
  for (const numPlayers of playerCountsFor(engine, opts)) {
    const { states } = randomPlayout(engine, `redaction-${numPlayers}`, numPlayers, maxPlies);
    for (const state of states) {
      const seats: (PlayerId | null)[] = [null];
      for (let p = 0; p < numPlayers; p++) seats.push(p);
      for (const seat of seats) {
        const view = engine.playerView(state, seat);
        const serialized = JSON.stringify(view);
        const viewerId: PlayerId = seat === null ? -1 : seat;
        const secrets = secretExtractor(state, viewerId);
        for (const secret of secrets) {
          if (secret.length > 0 && serialized.includes(secret)) {
            throw new ContractViolation(
              "redaction",
              `playerView(state, ${seat === null ? "null" : seat}) leaked secret "${secret}" ` +
                `(found in serialized view, including possibly lastEffects)`
            );
          }
        }
      }
    }
  }
}

/** Status discipline (plan §3): two-player engines never emit `lost`; solo engines never
 *  emit `draw` or a `won` with winner !== 0. */
export function checkStatusDiscipline<
  S extends WithEffects,
  M extends Json,
  V extends WithEffects,
>(engine: GameEngine<S, M, V>, opts: ContractOptions = {}): void {
  const isSolo = engine.meta.maxPlayers === 1;
  const maxPlies = opts.maxPlies ?? 200;
  const runs = opts.runs ?? 20;
  for (const numPlayers of playerCountsFor(engine, opts)) {
    for (let i = 0; i < runs; i++) {
      const { states } = randomPlayout(engine, `status-${numPlayers}-${i}`, numPlayers, maxPlies);
      for (const state of states) {
        const status = engine.status(state);
        if (isSolo) {
          if (status.kind === "draw") {
            throw new ContractViolation("status-discipline", "a solo engine (maxPlayers === 1) emitted `draw`");
          }
          if (status.kind === "won" && status.winner !== 0) {
            throw new ContractViolation(
              "status-discipline",
              `a solo engine emitted \`won\` with winner=${status.winner} (must be 0)`
            );
          }
        } else {
          if (status.kind === "lost") {
            throw new ContractViolation(
              "status-discipline",
              "a two-player engine (maxPlayers > 1) emitted `lost` — that variant is solo-only"
            );
          }
        }
      }
    }
  }
}

/** score(), when present: defined (finite number) at every reachable state; equals
 *  status().scores[0] at a scored terminal; never decreases if opts.scoreMonotone. */
export function checkScoreCoherence<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  opts: ContractOptions = {}
): void {
  if (!engine.score) return;
  const score = engine.score;
  const maxPlies = opts.maxPlies ?? 200;
  const runs = opts.runs ?? 20;
  for (const numPlayers of playerCountsFor(engine, opts)) {
    for (let i = 0; i < runs; i++) {
      const { states } = randomPlayout(engine, `score-${numPlayers}-${i}`, numPlayers, maxPlies);
      let prev: number | undefined;
      for (const state of states) {
        const s = score(state, 0);
        if (typeof s !== "number" || !Number.isFinite(s)) {
          throw new ContractViolation("score-coherence", `score() returned a non-finite value: ${String(s)}`);
        }
        if (opts.scoreMonotone && prev !== undefined && s < prev) {
          throw new ContractViolation(
            "score-coherence",
            `score() decreased from ${prev} to ${s} but scoreMonotone was declared`
          );
        }
        prev = s;
        const status = engine.status(state);
        if (status.kind === "scored") {
          const expected = status.scores[0];
          if (expected !== undefined && s !== expected) {
            throw new ContractViolation(
              "score-coherence",
              `score() = ${s} but status().scores[0] = ${expected} at a scored terminal`
            );
          }
        }
      }
    }
  }
}

/** All properties, run once per fixture. Exposed so a self-test can run "everything" and
 *  so games with unusual needs can compose a subset if they ever must (not expected). */
function runAllProperties<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  opts: ContractOptions
): void {
  checkPurity(engine, opts);
  checkTermination(engine, opts);
  checkDeterminism(engine, opts);
  checkEncodeDecodeAndEffects(engine, opts);
  checkLegalityCoherence(engine, opts);
  checkPlayerViewTotal(engine, opts);
  checkPerfectInfoIdentity(engine, opts);
  checkRedaction(engine, opts);
  checkStatusDiscipline(engine, opts);
  checkScoreCoherence(engine, opts);
}

/**
 * Registers describe/it blocks (vitest) — every game's engine.test.ts calls this. The solo
 * branch auto-activates when meta.maxPlayers === 1; the two-player branch otherwise.
 */
export function engineContract<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  opts: ContractOptions = {}
): void {
  const isSolo = engine.meta.maxPlayers === 1;

  describe(`engineContract: ${engine.meta.id}`, () => {
    it("does not mutate its inputs (purity)", () => {
      checkPurity(engine, opts);
    });

    it(`terminates within the ply cap (${opts.maxPlies ?? 200})`, () => {
      checkTermination(engine, opts);
    });

    it("is deterministic: same seed + same moves ⇒ identical trajectory and effects", () => {
      checkDeterminism(engine, opts);
    });

    it("encode/decode is canonical and excludes lastEffects; effects are never accumulated", () => {
      checkEncodeDecodeAndEffects(engine, opts);
    });

    it("isLegal agrees with legalMoves", () => {
      checkLegalityCoherence(engine, opts);
    });

    it("playerView never throws, for any seat or the spectator", () => {
      checkPlayerViewTotal(engine, opts);
    });

    if (!engine.meta.hiddenInformation) {
      it("perfect-info games: playerView is the identity", () => {
        checkPerfectInfoIdentity(engine, opts);
      });
    }

    if (engine.meta.hiddenInformation) {
      it("redacts all secrets (incl. from lastEffects) from every non-omniscient view", () => {
        checkRedaction(engine, opts);
      });
    }

    if (engine.score) {
      it("score() is coherent with the scored terminal", () => {
        checkScoreCoherence(engine, opts);
      });
    }

    if (isSolo) {
      describe("solo branch", () => {
        it("never emits `draw`, and any `won` has winner === 0", () => {
          checkStatusDiscipline(engine, opts);
        });
      });
    } else {
      describe("two-player branch", () => {
        it("never emits `lost` (solo-only status)", () => {
          checkStatusDiscipline(engine, opts);
        });
      });
    }
  });
}

// ---------------------------------------------------------------------------------------
// Certificate replay check (plan §4)
// ---------------------------------------------------------------------------------------

/**
 * Minimal structural shape needed to replay-verify a certificate. Deliberately NOT importing
 * `DailyCertificate` from @twist-arcade/game-spec: game-spec depends on engine (for
 * GameEngine/Json/etc.), so engine importing game-spec back would be a circular workspace
 * dependency, and would also violate the "packages/engine has zero runtime dependencies"
 * rule. `DailyCertificate` (defined in game-spec/src/certificate.ts) is a structural superset
 * of this shape, so any real certificate is assignable here with no adapter needed.
 */
export interface CertificateReplayInput {
  gameId: string;
  gameVersion: number;
  engineVersion: string;
  seed: string;
  moveLog: Json[];
}

/**
 * Certificate replay check (puzzle games): asserts the (seed, moveLog) pair reaches
 * { kind: "won" }. CI runs this against every shipped daily certificate (M3d/M4 wiring).
 * Uses `GameEngine<any, any, any>` deliberately — this is the same registry-boundary type
 * erasure as RegistryEntry.loadEngine(): the caller (a certify/CI job) has a dynamically
 * loaded engine, not a statically known one.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function verifyCertificate(engine: GameEngine<any, any, any>, cert: CertificateReplayInput): void {
  if (cert.gameId !== engine.meta.id) {
    throw new ContractViolation(
      "verifyCertificate",
      `certificate.gameId "${cert.gameId}" does not match engine.meta.id "${engine.meta.id}"`
    );
  }
  if (cert.gameVersion !== engine.meta.version) {
    throw new ContractViolation(
      "verifyCertificate",
      `certificate.gameVersion ${cert.gameVersion} does not match engine.meta.version ${engine.meta.version}`
    );
  }
  const record: ReplayRecord = {
    gameId: cert.gameId,
    gameVersion: cert.gameVersion,
    engineVersion: cert.engineVersion,
    numPlayers: 1,
    seed: cert.seed,
    steps: cert.moveLog.map((move) => ({ moves: [[0, move]] })),
  };
  const { status } = replay(engine, record);
  if (status.kind !== "won") {
    throw new ContractViolation(
      "verifyCertificate",
      `replaying ${cert.gameId} seed=${cert.seed} did not reach a won status (got ${stableStringify(status as unknown as Json)})`
    );
  }
}

// Re-exported for the self-test suite (test/testkit-self-test.test.ts) — not part of the
// public API surface games are expected to call directly, but kept out of `#internal`-style
// naming since this is a single-package testkit, not a published boundary.
export const _internal = {
  canonical,
  deepFreeze,
  randomPlayout,
  ContractViolation,
};

export type { Effect };
