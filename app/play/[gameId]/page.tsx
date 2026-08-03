// app/play/[gameId]/page.tsx — plan §3.1: Server page; generateStaticParams over the
// registry's eager manifests; unknown id -> notFound(). generateMetadata makes the manifest's
// ruleSentence the OG description on every route (plan §3.4 — "the rule sentence is the ad"),
// byte-identical to RuleCard's copy since both read the same manifest field.
//
// This file is the ONLY thing statically importing games/registry.ts on the play path — the
// registry entry (still holding loadEngine()/loadPresentation() as unresolved functions) is
// handed down as a plain prop to the client `GameShell` island, which is what actually calls
// them (plan §3.2's dynamic-import boundary; this file never calls loadEngine/loadPresentation
// itself, so it never pulls a game's engine/presentation bundle into the server render).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GameShell, type Mode } from "@twist-arcade/shell";
import { registry } from "@/games/registry";

interface PlayPageProps {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<{ mode?: string }>;
}

export function generateStaticParams(): { gameId: string }[] {
  return Object.keys(registry).map((gameId) => ({ gameId }));
}

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

function resolveMode(requested: string | undefined, entry: (typeof registry)[string]): Mode {
  const { modes, players } = entry.manifest;
  if (players.max === 1) return "solo-single";
  if (requested === "hotseat" && modes.hotseat) return "hotseat";
  return "solo-bot";
}

export default async function PlayPage({ params, searchParams }: PlayPageProps) {
  const { gameId } = await params;
  const { mode: requestedMode } = await searchParams;
  const entry = registry[gameId];
  if (!entry) notFound();

  const manifests = Object.values(registry).map((e) => e.manifest);
  const mode = resolveMode(requestedMode, entry);

  return (
    <GameShell gameId={gameId} registryEntry={entry} manifests={manifests} mode={mode} />
  );
}
