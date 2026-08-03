// packages/engine/testkit/checks.ts — the shared property-test kit's checks (plan §4),
// vitest-FREE (M1 review finding 2).
//
// This module must never import "vitest" (or anything else that only works inside a vitest
// worker). Every property is a plain function that THROWS a descriptive Error when violated.
// `testkit/contract.ts` is the thin vitest ADAPTER built on top of this module — it wraps
// each check in `it(...)` for `engineContract()`. The split exists because this module's
// exports (verifyCertificate, and the check functions themselves for direct/self-test use)
// are destined for consumers that are NOT vitest processes: the M3d `harness certify` loop
// and the nightly certificate re-verifier are plain Node CI jobs. Before this split,
// importing ANYTHING from testkit/contract.ts — even verifyCertificate alone — evaluated
// that file's top-level `import { describe, it } from "vitest"`, which throws immediately
// ("Vitest failed to access its internal state") outside a real vitest worker. Import
// @twist-arcade/engine/testkit/checks (this module) from a plain Node/tsx script instead.

import type { Effect, GameEngine, Json, PlayerId, Rng, WithEffects } from "../src/types";
import { rngFor, rngForSetup, rngFromSeed } from "../src/rng";
import { stableStringify } from "../src/encode";
import { replay, type ReplayRecord } from "../src/replay";

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

export class ContractViolation extends Error {
  constructor(property: string, detail: string) {
    super(`[engineContract] "${property}" violated: ${detail}`);
    this.name = "ContractViolation";
  }
}

// ---------------------------------------------------------------------------------------
// Random playout — mirrors replay.ts's rng scheme exactly (setup <- rngForSetup(seed),
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
  let state = engine.setup(numPlayers, rngForSetup(matchSeed));
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

/** Purity: apply() must not mutate its `state` or `moves` arguments. `state` (and each move
 *  VALUE placed into the map) is caught by deep-freezing: a mutation attempt throws a
 *  TypeError in strict mode (ESM modules are always strict), re-surfaced as a
 *  ContractViolation. The `moves` Map OBJECT itself is a separate case (M2 entry checklist
 *  Gap G-9): `Object.freeze(aMap)` does NOT stop `aMap.set()`/`.clear()`/`.delete()`, because
 *  a Map's storage lives in internal slots, not enumerable own properties visible to
 *  `Object.freeze`/`Object.keys`. So freezing alone is a blind spot for engines that mutate
 *  their `moves` argument in place. Guarded instead by snapshotting the map's entries before
 *  the call and diffing them against the same (still-live) Map reference afterward — the
 *  only way that diff differs is if `apply()` itself mutated it. */
export function checkPurity<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  opts: ContractOptions = {}
): void {
  const maxPlies = opts.maxPlies ?? 200;
  for (const numPlayers of playerCountsFor(engine, opts)) {
    const seed = `purity-${numPlayers}`;
    let state = deepFreeze(engine.setup(numPlayers, rngForSetup(seed)));
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
      const movesSnapshotBefore = canonical(Array.from(movesMap.entries()));
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
      const movesSnapshotAfter = canonical(Array.from(movesMap.entries()));
      if (movesSnapshotBefore !== movesSnapshotAfter) {
        throw new ContractViolation(
          "purity",
          `apply() mutated its \`moves\` Map argument at ply ${ply}: entries were ` +
            `${movesSnapshotBefore} before the call and ${movesSnapshotAfter} after — apply() ` +
            "MUST NOT mutate any input, including the moves Map itself (Object.freeze cannot " +
            "guard a Map's internal slots, so this must be checked by snapshot comparison)."
        );
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
  // Gap G-14 (M2 entry checklist, platform-corrections.md): ContractOptions.runs's docstring
  // says "default: 20" (matching every other property in this file) — checkDeterminism alone
  // defaulted to 10, silently sampling at half the documented rate whenever a caller omitted
  // `runs`. Fixed to match the documented default.
  const runs = opts.runs ?? 20;
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
 *    (this is the generic form of "effects are fully overwritten, never appended/accumulated")
 *  - status(decode(encode(s))) deep-equals status(s) ("status stable under encode/decode",
 *    plan §4 — M1 review finding 8 / gap G-3: this property was named in the plan but never
 *    implemented. A game whose status() accidentally reads something encode() drops (e.g.
 *    lastEffects) would report different outcomes for live vs rehydrated state — exactly the
 *    async-refetch path a real client hits after a reconnect.) */
export function checkEncodeDecodeAndEffects<
  S extends WithEffects,
  M extends Json,
  V extends WithEffects,
>(engine: GameEngine<S, M, V>, opts: ContractOptions = {}): void {
  const maxPlies = opts.maxPlies ?? 200;
  const runs = opts.runs ?? 20;
  for (const numPlayers of playerCountsFor(engine, opts)) {
    for (let run = 0; run < runs; run++) {
      const { states, record } = randomPlayout(engine, `encode-${numPlayers}-${run}`, numPlayers, maxPlies);

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

        // status stable under encode/decode (plan §4; M1 review finding 8 / gap G-3).
        const statusBefore = canonical(engine.status(state));
        const statusAfter = canonical(engine.status(decoded));
        if (statusBefore !== statusAfter) {
          throw new ContractViolation(
            "status-stable-under-encode-decode",
            `status(decode(encode(s))) !== status(s): ${statusAfter} !== ${statusBefore}`
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
}

/**
 * Encode injectivity (M2 entry checklist Gap G-2): distinct logical states (i.e. states that
 * differ in any field OTHER than `lastEffects`, which `encode` deliberately excludes) must
 * produce DISTINCT `encode()` strings. Plan §3: "solvers hash on this" — a collision-prone
 * (or outright constant) `encode` would silently mis-value every future solve, and neither
 * the canonical-form property (`encode(decode(encode(s))) === encode(s)`, trivially true for
 * a constant function) nor `checkDeterminism` (which compares trajectories via `encode()`
 * itself, so a constant encode "matches" vacuously) can catch it. Detected here directly:
 * collect encode() -> logical-form pairs across many playout states and refuse if any two
 * DIFFERENT logical states ever share the same encoded string.
 */
export function checkEncodeInjectivity<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  opts: ContractOptions = {}
): void {
  const maxPlies = opts.maxPlies ?? 200;
  const runs = opts.runs ?? 20;
  const seenLogicalByEncoding = new Map<string, string>();
  for (const numPlayers of playerCountsFor(engine, opts)) {
    for (let run = 0; run < runs; run++) {
      const { states } = randomPlayout(
        engine,
        `encode-injectivity-${numPlayers}-${run}`,
        numPlayers,
        maxPlies
      );
      for (const state of states) {
        const enc = engine.encode(state);
        // `lastEffects` is deliberately excluded from encode()'s canonical form (plan §3.2),
        // so it must also be excluded from the "logical state" this property compares —
        // otherwise this property would wrongly demand encode() to distinguish states that
        // are ONLY allowed to collide.
        const rest: Record<string, unknown> = { ...(state as unknown as Record<string, unknown>) };
        delete rest.lastEffects;
        const logical = canonical(rest);
        const seenLogical = seenLogicalByEncoding.get(enc);
        if (seenLogical === undefined) {
          seenLogicalByEncoding.set(enc, logical);
        } else if (seenLogical !== logical) {
          throw new ContractViolation(
            "encode-injectivity",
            `encode() produced the SAME string ${JSON.stringify(enc)} for two logically ` +
              `DISTINCT states (${seenLogical} vs ${logical}). Solvers hash on encode(S) — a ` +
              "collision silently mis-values every future solve/replay-dedup."
          );
        }
      }
    }
  }
}

/**
 * isLegal(s,p,m) must agree with legalMoves(s,p) in BOTH directions (M1 review finding 4 /
 * gap G-10): every move legalMoves lists must be accepted (⇒, the original check), AND every
 * move NOT listed must be rejected (⇐ — previously unchecked, so an engine whose isLegal is
 * `() => true` passed the whole contract suite). The reverse-direction probe uses the
 * vocabulary of moves actually OBSERVED anywhere in this playout (across all states and
 * players) as its candidate set — no per-game move generator is needed, and every candidate
 * is guaranteed to be a plausible, correctly-shaped M. `replay()` (the future leaderboard
 * verifier) and any future server-side validation trust isLegal alone to refuse forged
 * moves; a permissive isLegal would let fabricated submissions "replay" successfully.
 */
export function checkLegalityCoherence<
  S extends WithEffects,
  M extends Json,
  V extends WithEffects,
>(engine: GameEngine<S, M, V>, opts: ContractOptions = {}): void {
  const maxPlies = opts.maxPlies ?? 200;
  const runs = opts.runs ?? 20;
  for (const numPlayers of playerCountsFor(engine, opts)) {
    for (let run = 0; run < runs; run++) {
      const { states, record } = randomPlayout(engine, `legality-${numPlayers}-${run}`, numPlayers, maxPlies);

      const observedMoves: M[] = [];
      for (const step of record.steps) {
        for (const [, move] of step.moves) observedMoves.push(move as unknown as M);
      }

      for (const state of states) {
        for (let p = 0; p < numPlayers; p++) {
          const legal = engine.legalMoves(state, p);
          const legalCanon = new Set(legal.map((m) => stableStringify(m as unknown as Json)));

          for (const move of legal) {
            if (!engine.isLegal(state, p, move)) {
              throw new ContractViolation(
                "legality-coherence",
                `legalMoves(state, ${p}) included ${stableStringify(move as unknown as Json)} but isLegal() rejected it`
              );
            }
          }

          for (const candidate of observedMoves) {
            const key = stableStringify(candidate as unknown as Json);
            if (legalCanon.has(key)) continue;
            if (engine.isLegal(state, p, candidate)) {
              throw new ContractViolation(
                "legality-coherence",
                `isLegal(state, ${p}, ${key}) returned true for a move NOT in legalMoves(state, ${p}) ` +
                  "— isLegal must reject exactly the non-members too (iff, not just legalMoves ⇒ isLegal)."
              );
            }
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
  const runs = opts.runs ?? 20;
  for (const numPlayers of playerCountsFor(engine, opts)) {
    for (let run = 0; run < runs; run++) {
      const { states } = randomPlayout(engine, `view-total-${numPlayers}-${run}`, numPlayers, maxPlies);
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
  const runs = opts.runs ?? 20;
  for (const numPlayers of playerCountsFor(engine, opts)) {
    for (let run = 0; run < runs; run++) {
      const { states } = randomPlayout(engine, `perfect-info-${numPlayers}-${run}`, numPlayers, maxPlies);
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
  const runs = opts.runs ?? 20;
  for (const numPlayers of playerCountsFor(engine, opts)) {
    for (let run = 0; run < runs; run++) {
      const { states } = randomPlayout(engine, `redaction-${numPlayers}-${run}`, numPlayers, maxPlies);
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
}

/** Status discipline (plan §3): two-player engines never emit `lost`; solo engines never
 *  emit `draw` or a `won` with winner !== 0; `scored.scores.length === numPlayers` always
 *  (M1 review finding 8 / gap G-11 — stated in the plan's Status comment, enforced nowhere
 *  until now). */
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
        if (status.kind === "scored" && status.scores.length !== numPlayers) {
          throw new ContractViolation(
            "status-discipline",
            `\`scored\` status had scores.length=${status.scores.length}, expected numPlayers=${numPlayers}`
          );
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

/** All properties, run once per fixture. Exported so a self-test (or a game with unusual
 *  needs) can run "everything" outside of vitest's describe/it registration if it ever must
 *  (not expected — engineContract() in testkit/contract.ts is the normal entry point). */
export function runAllProperties<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  opts: ContractOptions
): void {
  checkPurity(engine, opts);
  checkTermination(engine, opts);
  checkDeterminism(engine, opts);
  checkEncodeDecodeAndEffects(engine, opts);
  checkEncodeInjectivity(engine, opts);
  checkLegalityCoherence(engine, opts);
  checkPlayerViewTotal(engine, opts);
  checkPerfectInfoIdentity(engine, opts);
  checkRedaction(engine, opts);
  checkStatusDiscipline(engine, opts);
  checkScoreCoherence(engine, opts);
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
  /**
   * Optional (correction C10): when supplied, MUST equal `moveLog.length`. `par` is the
   * published number a `DailyCertificate` exists to prove — fairness proof, difficulty
   * calibration, and share hook, all at once — so a certificate that replays cleanly but
   * carries a forged `par` is worse than an unverified one: it carries the authority of
   * "verified" while lying about the one number every downstream consumer trusts. Optional
   * only so `CertificateReplayInput` stays usable for replay-only callers that never had a
   * `par` to check in the first place (e.g. this file's own pre-C10 test fixtures); any real
   * `DailyCertificate` always has one.
   */
  par?: number;
  /** Optional: when supplied, MUST be one of the two contractual values. A `DailyCertificate`
   *  is read back from JSON (no compile-time type safety across that boundary), so a corrupt
   *  or typo'd value is a real failure mode worth rejecting explicitly rather than silently
   *  accepting an arbitrary string. */
  parKind?: "optimal" | "best-in-budget";
  /** Optional (fog games only): when supplied, MUST be a boolean, for the same JSON-boundary
   *  reason as `parKind`. This is a shape check only — verifyCertificate replays a moveLog, it
   *  does not re-solve, so it has no way to check whether the puzzle actually required a
   *  guess; that is `certifyDay`'s job (correction C11) at generation time. */
  guessFree?: boolean;
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
  // Correction C10: `par`/`parKind`/`guessFree` are checked BEFORE replaying — they are pure
  // structural facts about the certificate itself (par vs. moveLog.length; parKind/guessFree
  // shape), independent of whether the moveLog actually replays to `won`, so there is no
  // reason to pay for a replay before rejecting an already-tampered certificate.
  if (cert.par !== undefined && cert.par !== cert.moveLog.length) {
    throw new ContractViolation(
      "verifyCertificate",
      `certificate.par ${cert.par} does not match moveLog.length ${cert.moveLog.length} — par must equal the ` +
        "number of moves in the certified solution"
    );
  }
  if (cert.parKind !== undefined && cert.parKind !== "optimal" && cert.parKind !== "best-in-budget") {
    throw new ContractViolation(
      "verifyCertificate",
      `certificate.parKind ${stableStringify(cert.parKind as unknown as Json)} is not one of "optimal" | "best-in-budget"`
    );
  }
  if (cert.guessFree !== undefined && typeof cert.guessFree !== "boolean") {
    throw new ContractViolation(
      "verifyCertificate",
      `certificate.guessFree ${stableStringify(cert.guessFree as unknown as Json)} is not a boolean`
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
  playerCountsFor,
};

export type { Effect };
