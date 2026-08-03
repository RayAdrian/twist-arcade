// app/page.tsx — the library home. Phase 0 slice (plan §3.1): title + a GameCard list built
// from the registry's eager manifests — nothing else yet. Phase 1 (S3) replaces this with the
// full DailyHero + classic-family shelves home (plan §8); the shelf/next-twist derivation
// modules (shelves.ts, next-twist.ts) already exist and are unit-tested, ready for that pass.
// Server Component: no interactivity here, so no "use client" (plan §3.3).

import { GameCard } from "@twist-arcade/shell";
import { registry } from "@/games/registry";

export default function HomePage() {
  const manifests = Object.values(registry).map((entry) => entry.manifest);

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-bold text-ink">◇ Twist Arcade</h1>
      <p className="mt-1 text-sm text-ink-muted">Classic games, one rule changed.</p>

      {manifests.length === 0 ? (
        <p className="mt-8 text-center text-ink-muted">
          No games are live yet — check back soon.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {manifests.map((manifest) => (
            <li key={manifest.id}>
              <GameCard manifest={manifest} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
