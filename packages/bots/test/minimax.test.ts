import { describe, expect, it } from "vitest";
import { rngFromSeed } from "@twist-arcade/engine";
import { classicTicTacToe, type TTTMove, type TTTState } from "@twist-arcade/engine/testkit/fixtures/classic-ttt";
import { bankRun, type BankRunMove, type BankRunState } from "@twist-arcade/engine/testkit/fixtures/bank-run";
import { minimaxPolicy } from "../src/minimax";
import { randomPolicy } from "../src/random";
import { bonusGrab, type BonusGrabMove, type BonusGrabState } from "./fixtures/bonus-grab";
import { soloTrap, type SoloTrapMove, type SoloTrapState } from "./fixtures/solo-trap";
import { fakeClock } from "./helpers";

const BUDGET = { kind: "rollouts", n: 50000 } as const;

describe("minimaxPolicy", () => {
  it("finds the win in a two-in-a-row position (free oracle, plan §9)", () => {
    // X (player 0) has two in a row on the top row (cells 0,1) and cell 2 is open: X to move
    // must take cell 2 for the immediate win. O (player 1) occupies 3,4 (no threat).
    const state: TTTState = {
      board: [0, 0, null, 1, 1, null, null, null, null],
      turn: 0,
      lastEffects: [],
    };
    const policy = minimaxPolicy<TTTState, TTTMove>({ maxDepth: 9 });
    const { move } = policy.chooseMove({
      engine: classicTicTacToe,
      state,
      player: 0,
      rng: rngFromSeed("minimax-two-in-a-row"),
      budget: BUDGET,
      clock: fakeClock(),
    });
    expect(move.cell).toBe(2);
  });

  it("blocks the opponent's immediate winning threat when it has no win of its own", () => {
    // O (player 1) to move; X (player 0) threatens cells 0,1 with 2 open. O must block at 2.
    const state: TTTState = {
      board: [0, 0, null, 1, null, null, null, null, null],
      turn: 1,
      lastEffects: [],
    };
    const policy = minimaxPolicy<TTTState, TTTMove>({ maxDepth: 9 });
    const { move } = policy.chooseMove({
      engine: classicTicTacToe,
      state,
      player: 1,
      rng: rngFromSeed("minimax-block"),
      budget: BUDGET,
      clock: fakeClock(),
    });
    expect(move.cell).toBe(2);
  });

  it("never loses a full game against a random opponent, from either seat, across many seeds (free oracle, plan §9)", () => {
    const minimax = minimaxPolicy<TTTState, TTTMove>({ maxDepth: 9 });
    const random = randomPolicy<TTTState, TTTMove>();
    const engine = classicTicTacToe;
    for (let seed = 0; seed < 25; seed++) {
      for (const minimaxSeat of [0, 1] as const) {
        let state = engine.setup(2, rngFromSeed(`minimax-vs-random-setup-${seed}`));
        const driverRng = rngFromSeed(`minimax-vs-random-driver-${seed}-${minimaxSeat}`);
        for (let ply = 0; ply < 9; ply++) {
          const status = engine.status(state);
          if (status.kind !== "ongoing") break;
          const active = engine.active(state);
          if (active.mode !== "sequential") throw new Error("unexpected");
          const mover = active.player === minimaxSeat ? minimax : random;
          const { move } = mover.chooseMove({
            engine,
            state,
            player: active.player,
            rng: driverRng,
            budget: BUDGET,
            clock: fakeClock(),
          });
          state = engine.apply(state, new Map([[active.player, move]]), rngFromSeed(`step-${seed}-${ply}`));
        }
        const finalStatus = engine.status(state);
        if (finalStatus.kind === "won") {
          expect(finalStatus.winner).toBe(minimaxSeat);
        }
        // draw is fine; minimax must never be the LOSER.
      }
    }
  });

  it("consults engine.active() for the next mover instead of hardcoding 0/1 alternation (extra-turn twist, bonus-grab fixture)", () => {
    // bonus-grab: claiming cell 0 grants the SAME player another immediate move. Optimal play
    // from the empty board is to grab the bonus cell first — that forces a 2-1 win regardless
    // of the second pick, whereas playing either ordinary cell first lets the opponent grab
    // the bonus and win 2-1 instead (see the fixture's own doc for the full hand-verified
    // game tree). A minimax that hardcodes "the mover always alternates" mis-tracks whose turn
    // it is after the bonus cell is played — the position looks, to hardcoded alternation, as
    // though it's the OPPONENT's move next, and bonus-grab's legalMoves() correctly reports []
    // for whoever ISN'T actually the active player, so that mis-tracked branch throws
    // MinimaxUnsupportedGameError deep in the search and gets silently excluded from
    // consideration at that depth — exactly the failure the review flagged.
    const policy = minimaxPolicy<BonusGrabState, BonusGrabMove>({ maxDepth: 9 });
    const engine = bonusGrab;
    const state = engine.setup(2, rngFromSeed("bonus-grab-root"));
    const { move } = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("bonus-grab-decision"),
      budget: BUDGET,
      clock: fakeClock(),
    });
    expect(move.cell).toBe(0);
  });

  it("does not corrupt a 1-player (solo) game's terminal values via hardcoded 0/1 alternation (solo-trap fixture)", () => {
    // solo-trap: from START, one move is an immediate dead end (TRAP, "lost"); the other
    // reaches an ongoing SAFE position that then reaches GOAL ("won"). Hardcoded alternation
    // assumes the child's mover differs from the parent's — for a SOLO game that's simply
    // false (there is no other player), so the code negates a "lost" terminal's fixed
    // -Infinity into +Infinity: a certain loss reads as a certain win, and minimax walks
    // straight into the trap. Consulting engine.active() (which correctly reports the SAME
    // player again) must leave the value un-negated and pick the safe path instead.
    const policy = minimaxPolicy<SoloTrapState, SoloTrapMove>({ maxDepth: 1 });
    const engine = soloTrap;
    const state = engine.setup(1, rngFromSeed("solo-trap-root"));
    const { move } = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("solo-trap-decision"),
      budget: BUDGET,
      clock: fakeClock(),
    });
    expect(move.to).toBe(2);
  });

  it("rethrows a genuine contract violation (became simultaneous mid-search) instead of silently excluding that root move from consideration", () => {
    // X (player 0) to move; legal moves are cells 2,5,6,7,8 (cell 2 is the immediate win).
    // The wrapped engine falsely reports the state reached by playing cell 5 (a perfectly
    // ordinary, ONGOING, non-winning move) as having become simultaneous — a contract
    // violation this test manufactures deliberately. Before this fix, minimax's root catch
    // treated ANY MinimaxUnsupportedGameError the same as "ran out of heuristic depth for this
    // move, skip it and move on": since the OTHER root moves (including the actual win at cell
    // 2) complete fine, `depthReached` never stays 0, so the violation was silently swallowed
    // and chooseMove returned normally — contradicting this module's own header promise
    // ("refuses with a typed error, not a silent wrong answer").
    const state: TTTState = { board: [0, 0, null, 1, 1, null, null, null, null], turn: 0, lastEffects: [] };
    const engine: typeof classicTicTacToe = {
      ...classicTicTacToe,
      active(s: TTTState) {
        if (s.board[5] === 0) {
          return { mode: "simultaneous", players: [0, 1] };
        }
        return classicTicTacToe.active(s);
      },
    };
    const policy = minimaxPolicy<TTTState, TTTMove>({ maxDepth: 1 });
    expect(() =>
      policy.chooseMove({
        engine,
        state,
        player: 0,
        rng: rngFromSeed("root-contract-violation"),
        budget: BUDGET,
        clock: fakeClock(),
      })
    ).toThrow(/became simultaneous mid-search/);
  });

  it("never calls engine.active() on an already-terminal next state — active()'s own contract (packages/engine/src/types.ts) documents its return value only 'while ongoing' and is silent on terminal", () => {
    // Cell 2 is the immediate winning move from this position — playing it makes `next`
    // terminal (status 'won'). The wrapped active() throws if ever called with a state that
    // isn't ongoing, so this test fails loudly (for the right reason) if minimax calls
    // active(next) before checking whether `next` is already terminal.
    const state: TTTState = { board: [0, 0, null, 1, 1, null, null, null, null], turn: 0, lastEffects: [] };
    const engine: typeof classicTicTacToe = {
      ...classicTicTacToe,
      active(s: TTTState) {
        if (classicTicTacToe.status(s).kind !== "ongoing") {
          throw new Error("active() must not be called on a terminal state");
        }
        return classicTicTacToe.active(s);
      },
    };
    const policy = minimaxPolicy<TTTState, TTTMove>({ maxDepth: 9 });
    const { move } = policy.chooseMove({
      engine,
      state,
      player: 0,
      rng: rngFromSeed("no-active-on-terminal"),
      budget: BUDGET,
      clock: fakeClock(),
    });
    expect(move.cell).toBe(2);
  });

  it("throws a typed error when the engine has no heuristic and no maxDepth reaches every terminal", () => {
    // bank-run has no heuristic and is stochastic/1-player — minimax's precondition
    // (sequential perfect-info, deterministic) is violated by stochasticity; must refuse.
    const policy = minimaxPolicy<BankRunState, BankRunMove>();
    const state = bankRun.setup(1, rngFromSeed("no-heuristic"));
    expect(() =>
      policy.chooseMove({
        engine: bankRun,
        state,
        player: 0,
        rng: rngFromSeed("no-heuristic:driver"),
        budget: BUDGET,
        clock: fakeClock(),
      })
    ).toThrow(/minimax/i);
  });
});
