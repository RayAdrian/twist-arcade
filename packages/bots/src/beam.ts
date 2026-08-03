// packages/bots/src/beam.ts — beam search, THE solo Strong agent (plan §6, solo-games-lens
// §3.1). PRODUCT code, not test code: this ships later as the hint/ghost feature, so it must
// behave sensibly at interactive budgets, not just pass a benchmark.
//
// Solo-only (requires meta.maxPlayers === 1 — beam search as implemented here has no notion
// of an adversary) and requires engine.score() or engine.heuristic() as the ranking function
// (there is nothing else to rank candidate continuations by). Deterministic puzzles typically
// have neither wired up in the fixtures used for M2 (mini-crackstep has no score/heuristic —
// per-game solvers are the puzzle path, M3d); score-chases (bank-run-shaped games) are beam's
// natural target.

import type { GameEngine, Json, PlayerId, WithEffects } from "@twist-arcade/engine";
import type { Policy } from "./policy";

export class BeamUnsupportedGameError extends Error {
  constructor(reason: string) {
    super(`beamPolicy: ${reason}`);
    this.name = "BeamUnsupportedGameError";
  }
}

export interface BeamOptions {
  /** Beam width — how many candidate continuations survive each ply. Default 100 (plan §6). */
  width?: number;
}

interface BeamMember<S extends WithEffects, M extends Json> {
  state: S;
  firstMove: M;
  value: number;
  alive: boolean; // false once this lineage has reached a terminal state
}

/** Descending by `.value`, via comparison rather than subtraction. `evaluate()` below can
 *  return ±Infinity for won/lost terminals, and `Infinity - Infinity` is `NaN` — a comparator
 *  that ever returns NaN has unspecified sort behavior, so two winning (or two losing) lineages
 *  must be compared directly rather than by difference. */
function byValueDescending<S extends WithEffects, M extends Json>(a: BeamMember<S, M>, b: BeamMember<S, M>): number {
  if (a.value === b.value) return 0;
  return a.value > b.value ? -1 : 1;
}

// `won` ranks strictly ABOVE and `lost` strictly BELOW every ongoing score()/heuristic() value
// (±Infinity — the same convention minimax.ts's terminalValue already uses correctly, and the
// fix for the identical bug in probes/greedy-only.ts's evaluate()): score()/heuristic() have no
// documented range, so a finite ±1 for won/lost would let an ongoing lineage's raw value
// outrank an actual win/avoid an actual loss, which is backwards for a search whose whole job
// is "find the best reachable outcome".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function evaluate<S extends WithEffects, M extends Json>(engine: GameEngine<S, M, any>, state: S, player: PlayerId): number {
  const status = engine.status(state);
  switch (status.kind) {
    case "won":
      return status.winner === player ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    case "lost":
      return Number.NEGATIVE_INFINITY;
    case "draw":
      return 0;
    case "scored":
      return status.scores[player] ?? 0;
    case "ongoing":
      if (engine.score) return engine.score(state, player);
      // engine.heuristic existence is checked once up-front in chooseMove; safe to assume here.
      return engine.heuristic!(state, player);
  }
}

export function beamPolicy<S extends WithEffects, M extends Json>(opts: BeamOptions = {}): Policy<S, M> {
  const width = opts.width ?? 100;

  return {
    chooseMove({ engine, state, player, rng, budget, clock }) {
      const start = clock.now();
      if (engine.meta.maxPlayers !== 1) {
        throw new BeamUnsupportedGameError(
          `engine "${engine.meta.id}" has maxPlayers=${engine.meta.maxPlayers} — beam search here ` +
            "is solo-only (no adversary model)."
        );
      }
      if (!engine.score && !engine.heuristic) {
        throw new BeamUnsupportedGameError(
          `engine "${engine.meta.id}" implements neither score() nor heuristic() — beam search ` +
            "has nothing to rank candidate continuations by."
        );
      }
      const status = engine.status(state);
      if (status.kind !== "ongoing") {
        throw new BeamUnsupportedGameError("chooseMove called on a terminal state");
      }

      const nodeBudget = budget.kind === "rollouts" ? budget.n : undefined;
      const deadline = budget.kind === "deadlineMs" ? start + budget.ms : undefined;
      let nodesExpanded = 0;
      const budgetExhausted = (): boolean =>
        (nodeBudget !== undefined && nodesExpanded >= nodeBudget) ||
        (deadline !== undefined && clock.now() >= deadline);

      const initialLegal = engine.legalMoves(state, player);
      if (initialLegal.length === 0) {
        throw new BeamUnsupportedGameError(`player ${player} has no legal moves`);
      }

      // Ply 0: expand every root move once, tagging each resulting lineage with the move that
      // started it — everything downstream only ever needs to know which ROOT move to report.
      let beam: BeamMember<S, M>[] = [];
      for (const move of initialLegal) {
        const next = engine.apply(state, new Map([[player, move]]), rng);
        nodesExpanded += 1;
        const nextStatus = engine.status(next);
        beam.push({ state: next, firstMove: move, value: evaluate(engine, next, player), alive: nextStatus.kind === "ongoing" });
      }
      beam.sort(byValueDescending);
      beam = beam.slice(0, width);

      while (!budgetExhausted() && beam.some((m) => m.alive)) {
        const candidates: BeamMember<S, M>[] = [];
        for (const member of beam) {
          if (!member.alive) {
            candidates.push(member); // terminal lineages stay in the running, just don't expand
            continue;
          }
          const legal = engine.legalMoves(member.state, player);
          if (legal.length === 0) {
            // Contract violation upstream (no-hidden-pass), but defensively treat as dead-end.
            candidates.push({ ...member, alive: false });
            continue;
          }
          for (const move of legal) {
            if (budgetExhausted()) break;
            const next = engine.apply(member.state, new Map([[player, move]]), rng);
            nodesExpanded += 1;
            const nextStatus = engine.status(next);
            candidates.push({
              state: next,
              firstMove: member.firstMove,
              value: evaluate(engine, next, player),
              alive: nextStatus.kind === "ongoing",
            });
          }
        }
        candidates.sort(byValueDescending);
        beam = candidates.slice(0, width);
      }

      let best = beam[0]!;
      for (const member of beam) {
        if (member.value > best.value) best = member;
      }

      const rootVisits: { move: Json; visits: number }[] = [];
      const visitsByMove = new Map<string, number>();
      for (const member of beam) {
        const key = JSON.stringify(member.firstMove);
        visitsByMove.set(key, (visitsByMove.get(key) ?? 0) + 1);
      }
      for (const move of initialLegal) {
        rootVisits.push({ move: move as unknown as Json, visits: visitsByMove.get(JSON.stringify(move)) ?? 0 });
      }

      return {
        move: best.firstMove,
        stats: {
          elapsedMs: clock.now() - start,
          rollouts: nodesExpanded,
          rootValue: best.value,
          rootVisits,
        },
      };
    },
  };
}
