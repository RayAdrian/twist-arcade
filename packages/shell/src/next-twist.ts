// packages/shell/src/next-twist.ts — pickNextTwist (plan §8.3): the end-screen loop.
// Deterministic, pure: same classic first, then shared mechanic tag, then any other game;
// stable tie-break by id. Exactly ONE suggestion (never a grid of nine).

import type { GameManifest } from "@twist-arcade/game-spec";

export function pickNextTwist(
  currentId: string,
  manifests: readonly GameManifest[],
  recentlyShownId?: string
): GameManifest | null {
  const current = manifests.find((m) => m.id === currentId);
  const others = manifests.filter((m) => m.id !== currentId);
  if (others.length === 0) return null;

  // No-repeat (avoid Rematch -> Next ping-ponging between two games) is a PREFERENCE, not an
  // absolute rule: relax it when the excluded id is the only other game in the registry —
  // null is reserved for "no other game exists at all" (registry-size-1), never for "the
  // only alternative happens to be the one we suggested last time".
  const withoutRecent = others.filter((m) => m.id !== recentlyShownId);
  const candidates = withoutRecent.length > 0 ? withoutRecent : others;

  const rank = (m: GameManifest): number => {
    if (current && m.classic === current.classic) return 0;
    if (current && m.tags.some((tag) => current.tags.includes(tag))) return 1;
    return 2;
  };

  const sorted = [...candidates].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id); // deterministic tie-break
  });

  return sorted[0] ?? null;
}
