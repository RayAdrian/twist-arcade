// games/__GAME_ID__/heuristic.ts — optional per-game eval for minimax/greedy bots (plan §3:
// "Positive = good for player"). MCTS needs nothing, so this is only load-bearing once you
// wire a `minimax` difficulty tier in manifest.ts.
//
// TODO(you): replace with a real position evaluation once status() has real rules. A constant
// heuristic makes minimax play no better than random — harmless for `pnpm typecheck`/the
// contract suite (neither checks this function's OUTPUT, only its presence/shape), but it will
// not survive `suite design`'s tier-ordering expectations (ruthless >= standard >= casual).

import type { PlayerId } from "@twist-arcade/engine";
import type { __PASCAL_ID__State } from "./engine";

export function heuristic(_state: __PASCAL_ID__State, _player: PlayerId): number {
  return 0;
}
