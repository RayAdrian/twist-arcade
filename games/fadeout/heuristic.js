// games/fadeout/heuristic.ts — line-counting heuristic for the minimax bot option (plan §3.1).
// ~20 lines by design: for each of the 8 lines, weight the mover's own-mark count by each
// supporting mark's REMAINING LIFETIME (a two-in-a-row whose supporting mark dies before it
// can be converted is worth less than one that will still be there next turn), add a small
// positional term (center > corner > edge), and subtract the symmetric quantity for the
// opponent. Not used by anything in F1 — kept small, honest, and cheap since it is optional.
import { LINES, get2, opponentOf, remainingLife } from "./engine-internal";
export function fadeoutHeuristic(queues, player, config) {
    const opponent = opponentOf(player);
    const ownQueue = get2(queues, player);
    const oppQueue = get2(queues, opponent);
    const ownIndex = new Map(ownQueue.map((cell, i) => [cell, i]));
    const oppIndex = new Map(oppQueue.map((cell, i) => [cell, i]));
    const ownQLen = ownQueue.length;
    const oppQLen = oppQueue.length;
    let score = 0;
    for (const line of LINES) {
        let ownPresent = false;
        let oppPresent = false;
        let ownWeight = 0;
        let oppWeight = 0;
        for (const cell of line) {
            const oi = ownIndex.get(cell);
            if (oi !== undefined) {
                ownPresent = true;
                ownWeight += remainingLife(oi, ownQLen, config.cap);
            }
            const pi = oppIndex.get(cell);
            if (pi !== undefined) {
                oppPresent = true;
                oppWeight += remainingLife(pi, oppQLen, config.cap);
            }
        }
        if (ownPresent && !oppPresent)
            score += ownWeight;
        if (oppPresent && !ownPresent)
            score -= oppWeight;
    }
    const positionValue = (cell) => {
        const center = Math.floor((config.boardSize * config.boardSize) / 2);
        if (cell === center)
            return 3;
        const row = Math.floor(cell / config.boardSize);
        const col = cell % config.boardSize;
        const isCorner = (row === 0 || row === config.boardSize - 1) && (col === 0 || col === config.boardSize - 1);
        return isCorner ? 2 : 1;
    };
    for (const cell of ownQueue)
        score += positionValue(cell) * 0.1;
    for (const cell of oppQueue)
        score -= positionValue(cell) * 0.1;
    return score;
}
