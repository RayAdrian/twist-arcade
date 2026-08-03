// app/play/[gameId]/page.tsx — plan §3.1: Server page; generateStaticParams over the
// registry's eager manifests; unknown id -> notFound(). generateMetadata makes the manifest's
// ruleSentence the OG description on every route (plan §3.4 — "the rule sentence is the ad"),
// byte-identical to RuleCard's copy since both read the same manifest field.
//
// This file statically imports games/registry.ts for its manifest catalog (ids + metadata)
// only — it never touches `loadEngine()`/`loadPresentation()` and never resolves a registry
// entry to hand down as a prop. That hand-off used to happen here (a `registryEntry` prop
// straight into the client `<GameShell>` island) and broke `pnpm build`'s prerender step the
// first time a real game was registered: `RegistryEntry.loadEngine`/`loadPresentation` are
// plain functions, and functions cannot cross the Server->Client serialization boundary as a
// prop. See ./PlayClient.tsx's header comment for the full story and the fix (only `gameId`, a
// plain string, crosses the boundary; PlayClient does its own registry lookup client-side).
//
// Deliberately does NOT read `searchParams` (e.g. for a "?mode=hotseat" override, which an
// earlier revision had): combining `generateStaticParams` with `searchParams` access in the
// same page is a genuine Next.js conflict, not a style choice — `searchParams` is a per-request-
// only API, so a page that reads it cannot ALSO be statically prerendered, and mixing them
// produced a real `DYNAMIC_SERVER_USAGE` digest error at runtime for exactly this route
// (caught by this pass's own Playwright a11y spec, not a hypothetical). Mode selection is
// derived purely from the manifest for now; a hotseat entry point belongs in GameShell's own
// settings/mode picker (not built this pass — see the final report's gap list), not a URL param
// on a route this plan wants pre-rendered.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
// Relative, not the "@/*" alias — see app/page.tsx's comment: next build doesn't resolve it
// from this monorepo's root tsconfig.json (the alias lives in tsconfig.app.json instead).
import { registry } from "../../../games/registry";
import PlayClient from "./PlayClient";

interface PlayPageProps {
  params: Promise<{ gameId: string }>;
}

export function generateStaticParams(): { gameId: string }[] {
  return Object.keys(registry).map((gameId) => ({ gameId }));
}

// I5 / orchestrator ruling: "take both" — a real 404 status AND the loading.tsx board skeleton
// for real games, not a trade-off between them. `dynamicParams = false` makes any `gameId` NOT
// returned by generateStaticParams() 404 at the Next.js routing layer itself, before this page's
// own function is ever invoked — since every valid id is already enumerated above (a fully
// static catalog, no fallback route parsing), an unknown id never reaches the `notFound()` call
// below at all, and loading.tsx (a Suspense boundary tied to THIS page's own async work) never
// gets a chance to force a premature 200 for it. Known ids still stream through loading.tsx
// exactly as before; only the truly-unknown-id path changes.
export const dynamicParams = false;

export async function generateMetadata({ params }: PlayPageProps): Promise<Metadata> {
  const { gameId } = await params;
  const entry = registry[gameId];
  if (!entry) return {};
  const { title, ruleSentence } = entry.manifest;
  return {
    title: `${title} — Twist Arcade`,
    description: ruleSentence,
    openGraph: { title, description: ruleSentence },
  };
}

export default async function PlayPage({ params }: PlayPageProps) {
  const { gameId } = await params;
  const entry = registry[gameId];
  // Unreachable in normal operation now that `dynamicParams = false` (above) 404s an unknown
  // gameId before this function is ever invoked — kept as defense-in-depth, never removed.
  if (!entry) notFound();

  return <PlayClient gameId={gameId} />;
}
