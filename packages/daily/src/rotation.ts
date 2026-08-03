// packages/daily/src/rotation.ts — the deterministic weighted-rotation policy behind
// `pnpm daily:schedule` (plan §1.2): "hand-curated with a round-robin safety net." This module
// only PROPOSES; a human curates by hand-editing the emitted files before commit (§1.2), and the
// generator itself "never touches an existing file, only appends future days" — this function
// never reads or rewrites `history`, it only ever returns entries for the requested future range,
// which is what makes re-running it over already-committed days a no-op by construction.
//
// Constraints implemented (plan §1.2's bullet list):
//   - a "flagship" game (Fadeout) appears at least once every 7 days;
//   - every registered game appears at least once every 14 days;
//   - no game repeats on consecutive days;
//   - no two solo days (`solo-puzzle` | `solo-chase`) in a row;
//   - a solo game is only ever scheduled on a day `hasCertificate(gameId, day)` returns true for.
// Crackstep's "1-2x/week" and Mine Run's "~1x/week" (plan §1.2) are soft targets the plan itself
// only states qualitatively; this implementation folds them into the generic 7-day
// "solo-frequent" role bucket and the 14-day floor rather than hard-coding per-game-name
// frequencies, so the policy stays game-agnostic (a future ninth game just picks a `role`).

export type DailyKind = "vs-bot" | "solo-puzzle" | "solo-chase";

export interface RotationGame {
  gameId: string;
  kind: DailyKind;
  /** "flagship": due every 7 days (Fadeout). "solo-frequent": due every 7 days (Crackstep-like).
   *  "regular": due every 14 days (the plan's blanket floor — covers Mine Run and any other
   *  two-player game). */
  role: "flagship" | "solo-frequent" | "regular";
}

export interface ScheduledDay {
  day: string;
  gameId: string;
  kind: DailyKind;
}

export interface RotationPolicyInput {
  games: readonly RotationGame[];
  /** Only consulted for solo-kind games; a vs-bot game is never asked. */
  hasCertificate(gameId: string, day: string): boolean;
}

export class RotationError extends Error {
  constructor(message: string) {
    super(`rotation.ts: ${message}`);
    this.name = "RotationError";
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SOLO_KINDS: ReadonlySet<DailyKind> = new Set(["solo-puzzle", "solo-chase"]);

function addDays(day: string, n: number): string {
  const ms = Date.parse(`${day}T00:00:00Z`) + n * MS_PER_DAY;
  const d = new Date(ms);
  return `${d.getUTCFullYear().toString().padStart(4, "0")}-${(d.getUTCMonth() + 1).toString().padStart(2, "0")}-${d
    .getUTCDate()
    .toString()
    .padStart(2, "0")}`;
}

function dueThreshold(role: RotationGame["role"]): number {
  return role === "regular" ? 14 : 7;
}

/**
 * Proposes `numDays` consecutive days of schedule starting at `startDay`. `history` is prior
 * context ONLY (read, never re-emitted) — its last entry is what makes "no repeat yesterday's
 * game" and "no two solo days in a row" hold across the history/proposal boundary, and every
 * entry seeds `lastPlayed` so the 7/14-day coverage windows are computed correctly from the
 * very first proposed day rather than resetting to "never played" at the boundary.
 */
export function proposeRotation(startDay: string, numDays: number, history: readonly ScheduledDay[], input: RotationPolicyInput): ScheduledDay[] {
  const { games, hasCertificate } = input;
  const lastPlayed = new Map<string, string>(); // gameId -> most recent day scheduled (history + proposal so far)
  for (const entry of history) lastPlayed.set(entry.gameId, entry.day);

  // "No repeat yesterday's game" / "no two solo days in a row" are about literal CALENDAR
  // adjacency, not "whatever was scheduled most recently no matter how long ago." A gap between
  // history's last entry and startDay (a fresh `--start` far past the committed buffer, or a
  // buffer with a hole in it) must not carry a stale adjacency constraint forward — only seed
  // prevGameId/prevKind when history's last day IS literally the day immediately before startDay.
  const lastHistoryEntry = history.length > 0 ? history[history.length - 1]! : undefined;
  const adjacent = lastHistoryEntry !== undefined && addDays(lastHistoryEntry.day, 1) === startDay;
  let prevGameId = adjacent ? lastHistoryEntry.gameId : null;
  let prevKind = adjacent ? lastHistoryEntry.kind : null;

  const result: ScheduledDay[] = [];

  for (let i = 0; i < numDays; i++) {
    const day = addDays(startDay, i);

    function daysSince(gameId: string): number {
      const last = lastPlayed.get(gameId);
      if (!last) return Number.POSITIVE_INFINITY;
      return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / MS_PER_DAY);
    }

    function eligible(g: RotationGame): boolean {
      if (g.gameId === prevGameId) return false; // never repeat yesterday's game
      if (prevKind && SOLO_KINDS.has(prevKind) && SOLO_KINDS.has(g.kind)) return false; // no two solo days in a row
      if (SOLO_KINDS.has(g.kind) && !hasCertificate(g.gameId, day)) return false; // solo needs a certificate
      return true;
    }

    const candidates = games.filter(eligible);
    if (candidates.length === 0) {
      throw new RotationError(
        `no eligible game for ${day} — every registered game is either yesterday's game, a second consecutive solo day, or an uncertified solo game. Roster: ${games.map((g) => g.gameId).join(", ") || "(empty)"}`
      );
    }

    // "Due" candidates (never played, or past their role's threshold) are always scheduled ahead
    // of anything else — this is what guarantees the 7-day/14-day coverage windows regardless of
    // how staleness-ranking would otherwise have broken ties.
    const due = candidates.filter((g) => daysSince(g.gameId) >= dueThreshold(g.role) || daysSince(g.gameId) === Number.POSITIVE_INFINITY);
    const pool = due.length > 0 ? due : candidates;

    // Deterministic tie-break: flagship first (Fadeout gets priority whenever it's a candidate
    // for the slot at all — keeps its cadence tightest among equals), then longest-staleness,
    // then gameId ascending.
    const sorted = [...pool].sort((a, b) => {
      if (a.role === "flagship" && b.role !== "flagship") return -1;
      if (b.role === "flagship" && a.role !== "flagship") return 1;
      const diff = daysSince(b.gameId) - daysSince(a.gameId);
      if (diff !== 0) return diff;
      return a.gameId.localeCompare(b.gameId);
    });

    const chosen = sorted[0]!;
    result.push({ day, gameId: chosen.gameId, kind: chosen.kind });
    lastPlayed.set(chosen.gameId, day);
    prevGameId = chosen.gameId;
    prevKind = chosen.kind;
  }

  return result;
}
