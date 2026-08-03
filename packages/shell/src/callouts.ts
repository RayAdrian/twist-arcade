// packages/shell/src/callouts.ts — once-per-device teaching flags (plan §5.2.8, §5.2.10).
//
// One storage record per game (`ta:firsts:{gameId}`) shared by two independent mechanisms:
//   - the first-occurrence callout machinery (CalloutLayer, §4.15): each of a game's
//     `firstOccurrence` array entries (platform-corrections.md — an ARRAY, since a game may
//     have more than one teachable "first") namespaces its own once-per-device flag via its
//     `flagKey`.
//   - first-game bot softening (§5.2.10): a single `firstGamePlayed` flag, set at that
//     game's first terminal status (an abandoned first game still counts — the softening
//     applies to the first *experienced* game).
// These are independent axes over the SAME record; marking one never affects the other.

import { firstsKey, readVersioned, writeVersioned } from "./persistence";

interface FirstsRecord {
  v: 1;
  shown?: Record<string, 1>;
  firstGamePlayed?: 1;
}

function readFirsts(gameId: string): FirstsRecord {
  return readVersioned<FirstsRecord>(firstsKey(gameId), 1) ?? { v: 1 };
}

export function hasShownCallout(gameId: string, flagKey: string): boolean {
  return readFirsts(gameId).shown?.[flagKey] === 1;
}

export function markCalloutShown(gameId: string, flagKey: string): void {
  const record = readFirsts(gameId);
  writeVersioned(firstsKey(gameId), {
    ...record,
    shown: { ...record.shown, [flagKey]: 1 },
  });
}

export function hasPlayedFirstGame(gameId: string): boolean {
  return readFirsts(gameId).firstGamePlayed === 1;
}

export function markFirstGamePlayed(gameId: string): void {
  const record = readFirsts(gameId);
  writeVersioned(firstsKey(gameId), { ...record, firstGamePlayed: 1 });
}
