// packages/harness/src/solver/generic-solo.ts — the platform's composable solo-solver building
// blocks (phase-0-platform-spine.md §7.6): `dfsSolver()` (heuristic-free, encode-deduped
// exhaustive search — "sufficient for Crackstep" per the spine plan) and `idaStarSolver(h)`
// (IDA* against a caller-supplied admissible heuristic — the algorithm Crackstep's own solver
// plan, docs/plans/crackstep.md §3.2, composes with its heuristic and prunes). Games with
// richer structure (CSP propagation for deduction/fog games, GF(2) elimination for toggle
// games) export a bespoke solver instead — this module is the shared floor, not the ceiling.
//
// NOTE on `dfsSolver`'s name vs. implementation: the spine plan names this building block
// "pruned DFS with encode-dedup and reachability pruning". This implementation is BFS
// internally (a frontier queue, not a call stack) — BFS is what guarantees the FIRST time a
// `won` state is dequeued, its path length is the shortest possible (optimal, `L*`), which a
// plain depth-first traversal cannot promise without iterative deepening (which is exactly
// what `idaStarSolver` already generalizes, with a heuristic, below). Kept the plan's name
// (`dfsSolver`) since it is the "no per-game heuristic required" building block the plan means
// by that name; the BFS-vs-DFS distinction is an implementation detail documented here so a
// future reader isn't confused by a stack trace that never recurses.
//
// Both solvers target reaching a `won` status (puzzle solvability, per the engine contract's
// solo branch: "won" = solved). A `scored` terminal has no single pass/fail notion of
// "solved" and these generic solvers are not meant for score chases (which ship on the
// distribution gates instead, per mine-run.md §6) — calling either on an engine whose only
// solo terminals are `scored` will correctly report `"unsolvable"` once every reachable state
// is exhausted, since none of them is ever `won`.

import type { GameEngine, Json, WithEffects } from "@twist-arcade/engine";
import { rngFromSeed } from "@twist-arcade/engine";
import type { SoloSolveBudget, SoloSolveResult, SoloSolver } from "@twist-arcade/game-spec";

const DEFAULT_MAX_NODES = 1e7;
const DEFAULT_MAX_MS = 10_000;

function resolveBudget(budget: SoloSolveBudget): Required<SoloSolveBudget> {
  return {
    maxNodes: budget.maxNodes ?? DEFAULT_MAX_NODES,
    maxMs: budget.maxMs ?? DEFAULT_MAX_MS,
  };
}

/**
 * Solvers run OFFLINE, in batch, at build time (platform §7.7) — never inside a live game or
 * a reproducible harness report. Wall-clock is the right tool for their own time budget (the
 * engine/bots determinism-purity rule is scoped to `packages/engine`, `games/*`, and
 * `packages/bots/src/**` — see eslint.config.mjs — and deliberately does not reach this file).
 */
function now(): number {
  return Date.now();
}

/**
 * BFS over `encode(S)`-deduplicated states, single-player (`legalMoves(state, 0)`), targeting
 * the first `won` status reached — which, by BFS's level-order guarantee, is a SHORTEST such
 * path (optimal `L*`). No engine-supplied randomness is consumed beyond `setup()`'s own — every
 * `apply()` call here uses a fixed, arbitrary Rng stream (`solver-generic:<node index>`) since a
 * solved puzzle's `apply()` must be a pure function of (state, move) for the search to be sound
 * at all (a puzzle whose `apply()` draws further randomness after `setup()` is out of scope for
 * a deterministic solver — the plan scopes puzzles to `meta.stochastic: false`).
 */
export function dfsSolver<S extends WithEffects, M extends Json>(): SoloSolver<S, M> {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    solve(engine: GameEngine<S, M, any>, initial: S, budget: SoloSolveBudget): SoloSolveResult {
      const { maxNodes, maxMs } = resolveBudget(budget);
      const start = now();
      const visited = new Set<string>([engine.encode(initial)]);
      const queue: { state: S; path: M[] }[] = [{ state: initial, path: [] }];
      let nodesExpanded = 0;
      let qi = 0;
      let rngCounter = 0;

      const initialStatus = engine.status(initial);
      if (initialStatus.kind === "won") {
        return { outcome: "solved", moveLog: [], length: 0, optimal: true, nodesExpanded: 0 };
      }

      while (qi < queue.length) {
        if (nodesExpanded >= maxNodes || now() - start >= maxMs) {
          return { outcome: "budget-exhausted", nodesExpanded };
        }
        const { state, path } = queue[qi++]!;
        const legal = engine.legalMoves(state, 0);
        for (const move of legal) {
          if (nodesExpanded >= maxNodes || now() - start >= maxMs) {
            return { outcome: "budget-exhausted", nodesExpanded };
          }
          nodesExpanded += 1;
          const rng = rngFromSeed(`solver-generic:${rngCounter++}`);
          const next = engine.apply(state, new Map([[0, move]]), rng);
          const encoded = engine.encode(next);
          if (visited.has(encoded)) continue; // reachability/encode-dedup pruning
          visited.add(encoded);
          const nextPath = [...path, move];
          const status = engine.status(next);
          if (status.kind === "won") {
            return { outcome: "solved", moveLog: nextPath as unknown as Json[], length: nextPath.length, optimal: true, nodesExpanded };
          }
          if (status.kind === "ongoing") {
            queue.push({ state: next, path: nextPath });
          }
          // `lost` (or any other non-ongoing, non-won terminal): a dead branch, not enqueued —
          // neither a solution nor grounds to declare the WHOLE puzzle unsolvable by itself.
        }
      }

      return { outcome: "unsolvable", nodesExpanded };
    },
  };
}

/** An admissible heuristic: `h(state) <= true remaining cost to a `won` status`, never an
 *  overestimate. IDA*'s optimality guarantee depends entirely on this — see
 *  docs/plans/crackstep.md §3.2 for a worked admissibility argument (`h = number of unvisited
 *  tiles`, tight because each move visits at most one new tile). */
export type SoloHeuristic<S> = (state: S) => number;

interface IdaStepResult<M> {
  kind: "found" | "cutoff" | "exhausted-budget";
  path?: M[];
  nextThreshold: number; // Infinity when no node exceeded the current threshold at all
}

/**
 * IDA* (iterative-deepening A*) over `f = g + h`, deduplicated on `encode(S)` WITHIN each
 * threshold iteration (a node already reached at a lower-or-equal `g` earlier in the SAME
 * iteration is pruned — sound because IDA* only needs to avoid re-expanding a strictly worse
 * path to the same state within one iteration, not across iterations, where the threshold
 * itself has changed). Requires an admissible `h`; the platform default budget (1e7 nodes /
 * 10s) is the "unsolvable" boundary (`budget-exhausted` is caller-treated as unsolvable —
 * platform §7.7 — never a distinct outcome games are allowed to ship on).
 */
export function idaStarSolver<S extends WithEffects, M extends Json>(h: SoloHeuristic<S>): SoloSolver<S, M> {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    solve(engine: GameEngine<S, M, any>, initial: S, budget: SoloSolveBudget): SoloSolveResult {
      const { maxNodes, maxMs } = resolveBudget(budget);
      const start = now();
      let nodesExpanded = 0;
      let rngCounter = 0;
      let budgetExhausted = false;

      function withinBudget(): boolean {
        if (nodesExpanded >= maxNodes || now() - start >= maxMs) {
          budgetExhausted = true;
          return false;
        }
        return true;
      }

      function search(
        state: S,
        g: number,
        threshold: number,
        path: M[],
        bestGByEncoding: Map<string, number>
      ): IdaStepResult<M> {
        // Korf's IDA*: the cutoff check MUST happen before the goal test, not after. `f = g +
        // h(state)` is exact (not an estimate) at a WON state only when h is admissible and
        // tight there (h(goal) == 0) — but even then, a goal reached at g > threshold is a
        // longer-than-permitted-this-iteration path that a DEEPER iteration (at a wider
        // threshold) may or may not beat with something shorter found via an UNEXPLORED
        // sibling branch. Accepting it here short-circuits the search before that sibling is
        // ever tried, which can (and did — see this file's regression test) return a strictly
        // non-optimal path while still labelling it `optimal: true`. A goal is only a valid
        // answer for THIS iteration when its own f already fits under the threshold.
        const status = engine.status(state);
        const f = g + h(state);
        if (f > threshold) return { kind: "cutoff", nextThreshold: f };
        if (status.kind === "won") return { kind: "found", path, nextThreshold: g };
        if (!withinBudget()) return { kind: "exhausted-budget", nextThreshold: Infinity };

        const encoded = engine.encode(state);
        const bestKnown = bestGByEncoding.get(encoded);
        if (bestKnown !== undefined && bestKnown <= g && g > 0) {
          // Reached this exact state via an equal-or-worse path already explored this
          // iteration — nothing new to find below it.
          return { kind: "cutoff", nextThreshold: Infinity };
        }
        bestGByEncoding.set(encoded, g);

        let minNextThreshold = Infinity;
        const legal = engine.legalMoves(state, 0);
        for (const move of legal) {
          if (!withinBudget()) return { kind: "exhausted-budget", nextThreshold: Infinity };
          nodesExpanded += 1;
          const rng = rngFromSeed(`solver-ida:${rngCounter++}`);
          const next = engine.apply(state, new Map([[0, move]]), rng);
          const result = search(next, g + 1, threshold, [...path, move], bestGByEncoding);
          if (result.kind === "found") return result;
          if (result.kind === "exhausted-budget") return result;
          if (result.nextThreshold < minNextThreshold) minNextThreshold = result.nextThreshold;
        }
        return { kind: "cutoff", nextThreshold: minNextThreshold };
      }

      let threshold = h(initial);
      // A pathological/inadmissible heuristic could make `threshold` grow without bound while
      // the state space is in fact finite and small; the outer node/time budget above is what
      // actually bounds total work regardless, so no separate iteration cap is needed here.
      for (;;) {
        const bestGByEncoding = new Map<string, number>();
        const result = search(initial, 0, threshold, [], bestGByEncoding);
        if (result.kind === "found") {
          return {
            outcome: "solved",
            moveLog: result.path as unknown as Json[],
            length: result.path!.length,
            optimal: true,
            nodesExpanded,
          };
        }
        if (result.kind === "exhausted-budget" || budgetExhausted) {
          return { outcome: "budget-exhausted", nodesExpanded };
        }
        if (result.nextThreshold === Infinity) {
          // No node anywhere exceeded the current threshold and none was `won` — the entire
          // reachable state space (within budget) was exhausted without a solution.
          return { outcome: "unsolvable", nodesExpanded };
        }
        threshold = result.nextThreshold;
      }
    },
  };
}
