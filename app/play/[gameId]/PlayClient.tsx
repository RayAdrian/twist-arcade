// app/play/[gameId]/PlayClient.tsx — the client-side boundary for a play route.
//
// FIX (F3, discovered by `pnpm build` once a real registry entry existed for the first time):
// `page.tsx` (a Server Component) previously passed its whole `registryEntry` object straight
// through as a prop to the client `<GameShell>` island. `RegistryEntry.loadEngine`/
// `loadPresentation` are plain functions (by design — the dynamic-import seam plan §3.2/§5.4
// depends on), and functions cannot cross the Server->Client serialization boundary as a prop
// (only Server Actions and passed-through Client Component references can). This never
// surfaced before because `games/registry.ts` was empty — `generateStaticParams()` returned no
// paths, so `/play/{gameId}` was never actually prerendered against a real entry, and `pnpm
// build` never exercised this path at all. `next build`'s prerender step is what actually caught
// it (`Error: Functions cannot be passed directly to Client Components...`) — `pnpm typecheck`
// and `pnpm test` both stayed green through it, since a `RegistryEntry`'s shape is perfectly
// well-typed and perfectly testable in isolation; only a real production build exercises RSC
// serialization at all. Recorded here as its own "guard that doesn't guard" instance for the
// standing project warning.
//
// Fix: only `gameId` (a plain, serializable string) crosses the Server->Client boundary. This
// component does the registry lookup itself, entirely client-side — `games/registry.ts` is a
// plain module (an eager manifest catalog + function references for dynamic import), so
// importing it from more than one place is free; the ONLY thing that was ever illegal was
// serializing an already-resolved entry as an RSC prop.
"use client";

import { GameShell, type Mode } from "@twist-arcade/shell";
// Relative, not the "@/*" alias — see app/page.tsx's comment: next build doesn't resolve it
// from this monorepo's root tsconfig.json (the alias lives in tsconfig.app.json instead).
import { registry } from "../../../games/registry";

export interface PlayClientProps {
  gameId: string;
}

function resolveMode(entry: (typeof registry)[string]): Mode {
  return entry.manifest.players.max === 1 ? "solo-single" : "solo-bot";
}

export default function PlayClient({ gameId }: PlayClientProps) {
  const entry = registry[gameId];
  // Unreachable in normal operation: page.tsx's `dynamicParams = false` + generateStaticParams
  // already 404 any gameId not in the registry before this component is ever rendered — kept as
  // defense-in-depth, never removed (mirrors page.tsx's own `if (!entry) notFound()` comment).
  if (!entry) return null;

  const manifests = Object.values(registry).map((e) => e.manifest);

  return <GameShell gameId={gameId} registryEntry={entry} manifests={manifests} mode={resolveMode(entry)} />;
}
