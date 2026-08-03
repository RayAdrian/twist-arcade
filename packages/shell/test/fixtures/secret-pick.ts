// packages/shell/test/fixtures/secret-pick.ts — a minimal 2-player, hidden-information,
// sequential test-only engine. None of the three engine-package fixtures (classic-ttt,
// mini-crackstep, bank-run) has `hiddenInformation: true`, and useGame's hotseat handoff
// behavior specifically forks on that flag (plan §5.2.5: view only flips to the next seat
// after confirmHandoff() for hidden-info games) — this fixture exists purely to exercise that
// branch. Rules: at setup each seat is secretly dealt a number; each seat's only move is a
// no-op "pass"; the game ends (a draw, arbitrarily) once both seats have passed once.
// playerView never reveals the other seat's secret to anyone, including at game end.

import type {
  ActiveSpec,
  GameEngine,
  Json,
  PlayerId,
  Rng,
  Status,
  WithEffects,
} from "@twist-arcade/engine";
import { stableStringify } from "@twist-arcade/engine";
import type { GameDefinition, GameEvent, GameManifest } from "@twist-arcade/game-spec";

export interface SecretState extends WithEffects {
  readonly secrets: readonly [number, number];
  readonly turn: PlayerId;
  readonly movesMade: number;
}

export interface SecretMove {
  readonly pass: true;
  readonly [key: string]: Json;
}

export interface SecretView extends WithEffects {
  readonly mine: number | null;
  readonly turn: PlayerId;
  readonly movesMade: number;
}

function computeStatus(movesMade: number): Status {
  return movesMade >= 2 ? { kind: "draw" } : { kind: "ongoing" };
}

export const secretPickEngine: GameEngine<SecretState, SecretMove, SecretView> = {
  meta: {
    id: "secret-pick-fixture",
    name: "Secret Pick (internal fixture)",
    minPlayers: 2,
    maxPlayers: 2,
    hiddenInformation: true,
    simultaneous: false,
    stochastic: true,
    version: 1,
  },

  setup(_numPlayers: number, rng: Rng): SecretState {
    return { secrets: [rng.int(1000), rng.int(1000)], turn: 0, movesMade: 0, lastEffects: [] };
  },

  legalMoves(state: SecretState, player: PlayerId): SecretMove[] {
    if (computeStatus(state.movesMade).kind !== "ongoing") return [];
    if (player !== state.turn) return [];
    return [{ pass: true }];
  },

  isLegal(state: SecretState, player: PlayerId, move: SecretMove): boolean {
    if (computeStatus(state.movesMade).kind !== "ongoing") return false;
    if (player !== state.turn) return false;
    return move.pass === true;
  },

  active(state: SecretState): ActiveSpec {
    return { mode: "sequential", player: state.turn };
  },

  apply(state: SecretState, moves: ReadonlyMap<PlayerId, SecretMove>, _rng: Rng): SecretState {
    const move = moves.get(state.turn);
    if (!move || !secretPickEngine.isLegal(state, state.turn, move)) {
      throw new Error("secret-pick: illegal or missing move");
    }
    return {
      secrets: state.secrets,
      turn: state.turn === 0 ? 1 : 0,
      movesMade: state.movesMade + 1,
      lastEffects: [{ type: "placed", player: state.turn }],
    };
  },

  status(state: SecretState): Status {
    return computeStatus(state.movesMade);
  },

  playerView(state: SecretState, player: PlayerId | null): SecretView {
    return {
      mine: player === null ? null : (state.secrets[player] ?? null),
      turn: state.turn,
      movesMade: state.movesMade,
      lastEffects: state.lastEffects,
    };
  },

  encode(state: SecretState): string {
    return stableStringify({ secrets: state.secrets as unknown as number[], turn: state.turn, movesMade: state.movesMade });
  },

  decode(encoded: string): SecretState {
    const parsed = JSON.parse(encoded) as { secrets: [number, number]; turn: PlayerId; movesMade: number };
    return { secrets: parsed.secrets, turn: parsed.turn, movesMade: parsed.movesMade, lastEffects: [] };
  },
};

export const secretPickManifest: GameManifest = {
  id: secretPickEngine.meta.id,
  title: "Fixture Secret Pick",
  classic: "Secret Pick",
  ruleSentence: "A hidden-information fixture used only by shell tests.",
  tags: ["fixture", "hidden-info"],
  estMinutes: 1,
  modes: { bot: false, hotseat: true, asyncLink: false },
  players: { min: 2, max: 2 },
  difficultyTiers: [
    { id: "standard", policy: { kind: "random" }, budget: { kind: "deadlineMs", ms: 100 }, minReplyMs: 100 },
  ],
};

export const secretPickDefinition: GameDefinition<SecretState, SecretMove, SecretView> = {
  manifest: secretPickManifest,
  engine: secretPickEngine,
  presentation: {
    Board: function TestSecretBoard() {
      return null;
    },
    announce(ev: GameEvent<SecretView>): string {
      if (ev.kind === "moved") return `Player ${ev.player} passed.`;
      if (ev.kind === "status") return ev.status.kind === "draw" ? "Draw." : "";
      return "";
    },
    shareArtifact(): string {
      return "fixture artifact";
    },
    howSheetFrames: [
      { title: "1", body: "one" },
      { title: "2", body: "two" },
      { title: "3", body: "three" },
    ],
  },
};
