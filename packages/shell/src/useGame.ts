// packages/shell/src/useGame.ts — the platform hook (plan §5): the ONE place a new game's
// entire "cost a day" is paid. Owns the game loop, optimistic local apply, replay-based undo,
// the bot driver lifecycle (behind the BotDriver seam — bot-driver.ts), hotseat handoff,
// versioned localStorage persistence + resume, the shared first-occurrence flags, first-game
// bot softening, and announce composition. Game authors never reimplement any of this — see
// §5.3's never-list.
//
// Scope note (documented deviation): every Phase 0/1 game (`simultaneous: false` per
// fadeout.md/crackstep.md/mine-run.md) is sequential, so this hook only handles
// `engine.active(state).mode === "sequential"`. Simultaneous-move engines are out of scope
// here; no game currently planned needs them, and adding that branch is a seam change that
// should go through the orchestrator per §5.3/§13's own "grows game-specific branches" risk.
//
// "use client" — a hook, not a component, but still needed: it's exported from the package's
// shared barrel (index.ts) alongside GameCard, and Next traces that whole module when building
// any Server Component that imports anything from it (board-context.tsx's component comment
// has the full story for why this is per-file, not inherited from GameShell alone).
"use client";

import { useEffect, useRef, useState } from "react";
import type {
  GameEngine,
  Json,
  PlayerId,
  ReplayRecord,
  Status,
  WithEffects,
} from "@twist-arcade/engine";
import { appendStep, replayTo, rngFor, rngForSetup } from "@twist-arcade/engine";
import type { GameDefinition, GameEvent } from "@twist-arcade/game-spec";
import {
  BotCancelledError,
  type BotDriver,
  type BotMoveRequest,
  type TierId,
} from "./bot-driver";
import { composeAnnouncement, isDecayClassEffects, shellTurnPhrase, type TurnPhase } from "./announcer";
import { hasPlayedFirstGame, hasShownCallout, markCalloutShown, markFirstGamePlayed } from "./callouts";
import { dailyKey, gameKey, readVersioned, removeVersioned, writeVersioned } from "./persistence";
import { recordDailyCompletion } from "./streak";

// Mirrors the installed @twist-arcade/engine version (plan §3.3's ReplayRecord.engineVersion).
// Sourced by hand rather than a build-time package-version read — a documented S1 simplification
// (see the final report); reconciling this against the real package.json version is cheap
// follow-up work and never orphans a replay (the field is informational to the certificate/
// replay-verification boundary, which platform owns).
const ENGINE_VERSION = "0.1.0";

export type Mode = "solo-bot" | "hotseat" | "solo-single";

export interface DailyOptions {
  day: string;
  dayNumber: number;
  par?: number;
}

export interface UseGameOptions<S extends WithEffects, M extends Json, V extends WithEffects> {
  definition: GameDefinition<S, M, V>;
  mode: Mode;
  /** Daily/practice seed; default: crypto-random. */
  seed?: string;
  tierId?: TierId;
  /** Default 0 — human is X and moves first, always (ux-lens §3). */
  humanSeat?: PlayerId;
  /** Default: true for solo modes, false for hotseat (a shared-device sitting has nothing
   *  meaningful to "resume" mid-handoff). */
  persist?: boolean;
  botDriver?: BotDriver;
  /** Set to enter daily mode: fixes the seed's identity, disables Undo unconditionally
   *  (orchestrator addendum §15.3 — two-player dailies included), asserts a rollouts-budget
   *  tier, and hard-forbids `soften`. */
  daily?: DailyOptions;
  /** Optional per-seat display names for hotseat handoff/turn-phrase composition — the plan's
   *  own §5.1 sketch omits this, but `shellTurnPhrase`'s "{actor}'s move" / "Pass the device to
   *  {actor}" copy needs *something* to interpolate; defaults to "Player {n}". */
  seatLabels?: readonly string[];
}

export interface HandoffState {
  pending: boolean;
  nextSeat: PlayerId;
}

export interface AnnouncementState {
  polite?: string;
  assertive?: string;
}

export interface UseGameResult<M extends Json, V extends WithEffects> {
  view: V;
  legal: M[];
  status: Status;
  activeSeat: PlayerId | null;
  presentingSeat: PlayerId;
  botThinking: boolean;
  /** True when the bot driver's last `chooseMove()` REJECTED (not cancelled) — plan §5.2.4:
   *  "a retryable StatusLine error state — never a hang." The board stays legally inert (it's
   *  still the bot's turn) until `retryBot()` re-dispatches. */
  botError: boolean;
  lockedUntil: number;
  canUndo: boolean;
  score?: number;
  moveCount: number;
  restartCount: number;
  history: ReplayRecord;
  firstOccurrence: { text: string; anchor: Json } | null;
  announcement: AnnouncementState;
  handoff: HandoffState | null;
  submitMove(m: M): void;
  undo(): void;
  restart(): void;
  rematch(): void;
  confirmHandoff(): void;
  setTier(t: TierId): void;
  describeBoard(): void;
  /** Re-dispatches the bot for the current state after a `botError`. No-op when there is no
   *  pending bot error (C2). */
  retryBot(): void;
}

interface Internal<S extends WithEffects> {
  state: S;
  record: ReplayRecord;
  presentingSeat: PlayerId;
  handoff: HandoffState | null;
  restartCount: number;
  lockedUntil: number;
  botThinking: boolean;
  botError: boolean;
  firstOccurrence: { text: string; anchor: Json } | null;
  announcement: AnnouncementState;
}

interface PersistedGame {
  v: 1;
  record: ReplayRecord;
  tierId: TierId;
  restartCount: number;
}

function randomSeed(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function seatLabel(seatLabels: readonly string[] | undefined, seat: PlayerId): string {
  return seatLabels?.[seat] ?? `Player ${seat + 1}`;
}

// Small conditional-spread helpers so an absent optional value is genuinely ABSENT (not present
// with value `undefined`) — required under this repo's `exactOptionalPropertyTypes: true`.

function turnPhraseFor(phase: TurnPhase, actorLabel?: string): string {
  return actorLabel === undefined ? shellTurnPhrase({ phase }) : shellTurnPhrase({ phase, actorLabel });
}

function announcementFragments(
  moved: string,
  imminent: string | undefined,
  boardSummary: string | undefined,
  turnPhrase: string
): Parameters<typeof composeAnnouncement>[0] {
  return {
    moved,
    ...(imminent !== undefined ? { imminent } : {}),
    ...(boardSummary !== undefined ? { boardSummary } : {}),
    turnPhrase,
  };
}

export function useGame<S extends WithEffects, M extends Json, V extends WithEffects>(
  opts: UseGameOptions<S, M, V>
): UseGameResult<M, V> {
  const { definition, mode } = opts;
  const { engine, manifest, presentation } = definition;
  const humanSeat = opts.humanSeat ?? 0;
  const numPlayers = manifest.players.max;
  const persistEnabled = opts.persist ?? mode !== "hotseat";

  // Daily budget assertion (plan §5.5): refuse to start unless the resolved tier's budget kind
  // is `rollouts` — a deadlineMs daily bot silently destroys cross-player comparability.
  if (opts.daily) {
    const resolvedTierId = opts.tierId ?? "standard";
    const tier = manifest.difficultyTiers.find((t) => t.id === resolvedTierId);
    if (!tier || tier.budget.kind !== "rollouts") {
      throw new Error(
        `useGame: daily mode requires tier "${resolvedTierId}" to have a rollouts budget, got ` +
          (tier ? tier.budget.kind : "no such tier")
      );
    }
  }

  const tierIdRef = useRef<TierId>(opts.tierId ?? "standard");
  const pendingTierIdRef = useRef<TierId>(tierIdRef.current);
  const epochRef = useRef(0);
  const pendingRequestIdRef = useRef<string | null>(null);
  // Captured ONCE (lazy ref init, never reassigned): a BotDriver is a session-scoped object
  // with its own internal state (a stub's rng stream position, a scripted driver's remaining
  // move queue, a real worker's live connection) — re-pointing this at whatever `opts.botDriver`
  // happens to be on a given render would silently swap out that state mid-game the instant a
  // caller passes a fresh instance on re-render (e.g. `botDriver: scriptedBotDriver([...])`
  // constructed inline in a render function), discarding everything the original instance had
  // already consumed. Callers must treat `botDriver` as effectively stable for the hook's
  // lifetime, exactly like a real worker connection would be.
  const driverRef = useRef<BotDriver | undefined>(opts.botDriver);

  const persistModeKey = opts.daily ? `${mode}:daily` : mode;

  const [internal, setInternal] = useState<Internal<S>>(() => {
    if (persistEnabled) {
      const stored = readVersioned<PersistedGame>(gameKey(manifest.id, persistModeKey), 1);
      const seedMatches = opts.seed === undefined || stored?.record.seed === opts.seed;
      if (stored && seedMatches && stored.record.gameId === manifest.id && stored.record.gameVersion === engine.meta.version) {
        try {
          const state = replayTo(engine, stored.record, stored.record.steps.length);
          tierIdRef.current = stored.tierId;
          pendingTierIdRef.current = stored.tierId;
          return {
            state,
            record: stored.record,
            presentingSeat: mode === "hotseat" ? engineActivePlayer(engine, state) : humanSeat,
            handoff: null,
            restartCount: stored.restartCount,
            lockedUntil: 0,
            botThinking: false,
            botError: false,
            firstOccurrence: null,
            announcement: {},
          };
        } catch {
          // Corrupt/incompatible stored record — fall through to a fresh start rather than
          // crash (persistence.ts's own "never crash on corrupt storage" ethos, extended here).
        }
      }
    }
    const seed = opts.seed ?? randomSeed();
    const state = engine.setup(numPlayers, rngForSetup(seed));
    const record: ReplayRecord = {
      gameId: manifest.id,
      gameVersion: engine.meta.version,
      engineVersion: ENGINE_VERSION,
      numPlayers,
      seed,
      steps: [],
    };
    return {
      state,
      record,
      presentingSeat: mode === "hotseat" ? engineActivePlayer(engine, state) : humanSeat,
      handoff: null,
      restartCount: 0,
      lockedUntil: 0,
      botThinking: false,
      botError: false,
      firstOccurrence: null,
      announcement: {},
    };
  });

  const internalRef = useRef(internal);
  internalRef.current = internal;

  // Persist after every step (§5.6); cleared on terminal status.
  useEffect(() => {
    if (!persistEnabled) return;
    const status = engine.status(internal.state);
    const key = gameKey(manifest.id, persistModeKey);
    if (status.kind !== "ongoing") {
      removeVersioned(key);
      return;
    }
    writeVersioned<PersistedGame>(key, {
      v: 1,
      record: internal.record,
      tierId: tierIdRef.current,
      restartCount: internal.restartCount,
    });
  }, [internal.record, internal.restartCount]);

  function currentPhaseAndActor(status: Status, activeSeat: PlayerId | null, presentingSeat: PlayerId, botThinking: boolean, handoffPending: boolean): { phase: TurnPhase; actorLabel?: string } {
    if (status.kind !== "ongoing") return { phase: "finished" };
    if (botThinking) return { phase: "bot-thinking" };
    if (handoffPending) return { phase: "handoff", actorLabel: seatLabel(opts.seatLabels, activeSeat ?? presentingSeat) };
    if (activeSeat === presentingSeat) return { phase: "your-turn" };
    return { phase: "their-turn", actorLabel: mode === "solo-bot" ? "Bot" : seatLabel(opts.seatLabels, activeSeat ?? presentingSeat) };
  }

  function softenFor(): boolean {
    if (opts.daily) return false; // never sent in daily mode (§5.2.10) — comparability is sacred.
    return !hasPlayedFirstGame(manifest.id);
  }

  function cancelPendingBot(): void {
    const requestId = pendingRequestIdRef.current;
    if (requestId && driverRef.current) {
      driverRef.current.cancel(requestId);
    }
    pendingRequestIdRef.current = null;
  }

  function dispatchBotIfNeeded(state: S, record: ReplayRecord): void {
    if (mode !== "solo-bot") return;
    const status = engine.status(state);
    if (status.kind !== "ongoing") return;
    const active = engine.active(state);
    if (active.mode !== "sequential" || active.player === humanSeat) return;
    if (pendingRequestIdRef.current !== null) return; // already dispatched for this state
    const driver = driverRef.current;
    if (!driver) return;

    const requestId = randomSeed();
    pendingRequestIdRef.current = requestId;
    const myEpoch = epochRef.current;
    // Clearing `botError` here (not just on success) covers both the manual retryBot() path and
    // any automatic re-dispatch that happens to land after a prior failure (C2).
    setInternal((prev) => ({ ...prev, botThinking: true, botError: false }));

    const req: BotMoveRequest = {
      requestId,
      gameId: manifest.id,
      encodedState: engine.encode(state),
      player: active.player,
      tierId: tierIdRef.current,
      seed: record.seed,
      step: record.steps.length,
      soften: softenFor(),
    };

    driver.chooseMove(req).then(
      (res) => {
        if (epochRef.current !== myEpoch || pendingRequestIdRef.current !== requestId) return;
        pendingRequestIdRef.current = null;
        setInternal((prev) => ({ ...prev, botThinking: false, botError: false }));
        applyMove(res.move as M, false);
      },
      (err: unknown) => {
        if (epochRef.current !== myEpoch || pendingRequestIdRef.current !== requestId) return;
        pendingRequestIdRef.current = null;
        if (err instanceof BotCancelledError) {
          setInternal((prev) => ({ ...prev, botThinking: false }));
          return;
        }
        // Plan §5.2.4: "a retryable StatusLine error state — never a hang." Nothing re-dispatches
        // on its own here — `retryBot()` (driven by the UI's Retry affordance) is the only way
        // forward, exactly like a real network/worker failure should require an explicit retry
        // rather than silently spinning forever.
        console.error("useGame: bot request failed", err);
        setInternal((prev) => ({ ...prev, botThinking: false, botError: true }));
      }
    );
  }

  const dispatchRef = useRef(dispatchBotIfNeeded);
  dispatchRef.current = dispatchBotIfNeeded;

  // On mount: the bot may need to move first (e.g. humanSeat !== 0), or a resumed record may
  // have left the bot mid-turn.
  useEffect(() => {
    dispatchRef.current(internalRef.current.state, internalRef.current.record);
  }, []);

  function applyMove(move: M, byHuman: boolean): void {
    const cur = internalRef.current;
    const status = engine.status(cur.state);
    if (status.kind !== "ongoing") return;
    if (byHuman && cur.handoff?.pending) return; // waiting on a handoff confirm
    const active = engine.active(cur.state);
    if (active.mode !== "sequential") return; // simultaneous games out of scope (see file header)
    const actingPlayer = active.player;

    if (byHuman) {
      const expectedSeat = mode === "hotseat" ? cur.presentingSeat : humanSeat;
      if (actingPlayer !== expectedSeat) return; // not this seat's turn to submit
    }

    if (!engine.isLegal(cur.state, actingPlayer, move)) {
      console.warn(`useGame: illegal move for player ${actingPlayer}`, move);
      return;
    }

    const stepIndex = cur.record.steps.length;
    const stepRng = rngFor(cur.record.seed, stepIndex);
    const movesMap = new Map<PlayerId, M>([[actingPlayer, move]]);
    const newState = engine.apply(cur.state, movesMap, stepRng);
    const newRecord = appendStep(cur.record, movesMap);
    const effects = newState.lastEffects;
    const newStatus = engine.status(newState);

    // Hotseat presenting-seat/handoff bookkeeping (plan §5.2.5).
    let presentingSeat = cur.presentingSeat;
    let handoff: HandoffState | null = null;
    if (mode === "hotseat" && newStatus.kind === "ongoing") {
      const nextActive = engine.active(newState);
      const nextSeat = nextActive.mode === "sequential" ? nextActive.player : cur.presentingSeat;
      if (nextSeat !== cur.presentingSeat) {
        if (engine.meta.hiddenInformation) {
          handoff = { pending: true, nextSeat };
          // presentingSeat stays put until confirmHandoff() (blocking interstitial).
        } else {
          presentingSeat = nextSeat; // open-info: auto-confirm (banner variant).
        }
      }
    }

    const viewSeat = mode === "hotseat" ? presentingSeat : humanSeat;
    const newView = engine.playerView(newState, viewSeat);

    // First-occurrence callout (plan §5.2.8): auto-dismiss on the next committed move — but
    // specifically the presenting seat's OWN next move, not whatever step happens to run next.
    // In solo-bot, the bot's reply lands automatically within a couple hundred ms of the human
    // move that may have just triggered the callout; clearing it on that automatic landing would
    // give the player no real chance to read it before it's gone, defeating the entire point of
    // a "read this once" teaching aid. So a bot-landed step (byHuman === false) carries the
    // current firstOccurrence forward unchanged — only a byHuman step re-evaluates (dismissing
    // whatever was showing and possibly firing a new one, all in one place, exactly like §5.2.8
    // describes) — the human seat is the only audience a callout is ever anchored for.
    const ev: GameEvent<V> = { kind: "moved", player: actingPlayer, move: move as Json, effects };
    let firstOccurrence: Internal<S>["firstOccurrence"] = byHuman ? null : cur.firstOccurrence;
    if (byHuman) {
      for (const entry of presentation.firstOccurrence ?? []) {
        if (hasShownCallout(manifest.id, entry.flagKey)) continue;
        if (entry.trigger(ev)) {
          firstOccurrence = { text: entry.text, anchor: entry.anchor(ev) };
          markCalloutShown(manifest.id, entry.flagKey);
          break;
        }
      }
    }

    // Announcement composition (plan §6.2 — the critical spec).
    const movedStr = presentation.announce(ev);
    const imminentStr = presentation.announce({ kind: "imminent", effects }) || undefined;
    const decay = isDecayClassEffects(effects);
    const boardSummaryStr = decay ? presentation.announce({ kind: "boardSummary", view: newView }) : undefined;

    let announcement: AnnouncementState;
    let botThinking = false;
    if (newStatus.kind !== "ongoing") {
      announcement = {
        polite: composeAnnouncement(announcementFragments(movedStr, imminentStr, boardSummaryStr, "")),
        assertive: presentation.announce({ kind: "status", status: newStatus }),
      };
    } else {
      const nextActive = engine.active(newState);
      const nextActiveSeat = nextActive.mode === "sequential" ? nextActive.player : null;
      const botIsUpNext = mode === "solo-bot" && nextActiveSeat !== null && nextActiveSeat !== humanSeat;
      botThinking = botIsUpNext;
      const { phase, actorLabel } = currentPhaseAndActor(newStatus, nextActiveSeat, presentingSeat, botIsUpNext, handoff?.pending ?? false);
      announcement = {
        polite: composeAnnouncement(announcementFragments(movedStr, imminentStr, boardSummaryStr, turnPhraseFor(phase, actorLabel))),
        assertive: "",
      };
    }

    // Lockout (plan §5.2.3): own moves never lock; this step's landing does iff it was NOT the
    // presenting seat's own move (a bot move landing, or a cascade — none of the Phase 0/1
    // fixtures have simultaneous cascades, but the rule is stated generally here).
    const lockedUntil = byHuman ? cur.lockedUntil : performance.now() + 250;

    // First-game softening + daily completion (plan §5.2.10, §5.5) — on the terminal transition.
    if (newStatus.kind !== "ongoing") {
      if (mode === "solo-bot") markFirstGamePlayed(manifest.id);
      if (opts.daily) {
        recordDailyCompletion(opts.daily.day);
        writeVersioned(dailyKey(opts.daily.day), {
          v: 1,
          gameId: manifest.id,
          result: newStatus,
          moves: newRecord.steps.length,
          restarts: cur.restartCount,
        });
      }
    }

    setInternal({
      state: newState,
      record: newRecord,
      presentingSeat,
      handoff,
      restartCount: cur.restartCount,
      lockedUntil,
      botThinking,
      botError: false,
      firstOccurrence,
      announcement,
    });

    dispatchRef.current(newState, newRecord);
  }

  function submitMove(m: M): void {
    applyMove(m, true);
  }

  function undo(): void {
    const cur = internalRef.current;
    if (!computeCanUndo(cur)) return;
    cancelPendingBot();
    epochRef.current += 1;

    const humanLikeSeat = mode === "hotseat" ? undefined : humanSeat;
    let k = cur.record.steps.length;
    while (k > 0) {
      k -= 1;
      const candidate = replayTo(engine, cur.record, k);
      const active = engine.active(candidate);
      if (humanLikeSeat === undefined) break; // hotseat: undo disabled entirely (guarded above)
      if (active.mode === "sequential" && active.player === humanLikeSeat) break;
    }

    const state = replayTo(engine, cur.record, k);
    const record: ReplayRecord = { ...cur.record, steps: cur.record.steps.slice(0, k) };
    setInternal({
      ...cur,
      state,
      record,
      botThinking: false,
      botError: false,
      firstOccurrence: null,
      announcement: {},
    });

    // I2: undo can rewind all the way past the bot's own opening move (e.g. humanSeat !== 0),
    // landing on a state where it's the BOT's turn again. Nothing else re-prompts it from
    // here — applyMove/reset already do this after every transition they make; undo must too,
    // or the game hangs awaiting a move nobody will ever submit.
    dispatchRef.current(state, record);
  }

  function reset(): void {
    cancelPendingBot();
    epochRef.current += 1;
    tierIdRef.current = pendingTierIdRef.current;
    const cur = internalRef.current;
    const seed = opts.daily ? cur.record.seed : randomSeed();
    const state = engine.setup(numPlayers, rngForSetup(seed));
    const record: ReplayRecord = {
      gameId: manifest.id,
      gameVersion: engine.meta.version,
      engineVersion: ENGINE_VERSION,
      numPlayers,
      seed,
      steps: [],
    };
    const next: Internal<S> = {
      state,
      record,
      presentingSeat: mode === "hotseat" ? engineActivePlayer(engine, state) : humanSeat,
      handoff: null,
      restartCount: cur.restartCount + 1,
      lockedUntil: 0,
      botThinking: false,
      botError: false,
      firstOccurrence: null,
      announcement: {},
    };
    setInternal(next);
    dispatchRef.current(state, record);
  }

  function retryBot(): void {
    const cur = internalRef.current;
    if (!cur.botError) return;
    dispatchRef.current(cur.state, cur.record);
  }

  function confirmHandoff(): void {
    const cur = internalRef.current;
    if (!cur.handoff?.pending) return;
    setInternal({ ...cur, presentingSeat: cur.handoff.nextSeat, handoff: null });
  }

  function setTier(t: TierId): void {
    pendingTierIdRef.current = t; // takes effect at the next restart/rematch (ux-lens §6).
  }

  function describeBoard(): void {
    const cur = internalRef.current;
    const viewSeat = mode === "hotseat" ? cur.presentingSeat : humanSeat;
    const view = engine.playerView(cur.state, viewSeat);
    const status = engine.status(cur.state);
    const active = engine.active(cur.state);
    const activeSeat = active.mode === "sequential" ? active.player : null;
    const { phase, actorLabel } = currentPhaseAndActor(status, activeSeat, cur.presentingSeat, cur.botThinking, cur.handoff?.pending ?? false);
    setInternal({
      ...cur,
      announcement: {
        ...cur.announcement,
        polite: composeAnnouncement(
          announcementFragments("", undefined, presentation.announce({ kind: "boardSummary", view }), turnPhraseFor(phase, actorLabel))
        ),
      },
    });
  }

  function computeCanUndo(cur: Internal<S>): boolean {
    if (opts.daily) return false; // orchestrator addendum §15.3: no undo in daily, ever.
    if (mode === "hotseat") return false; // disabled (hidden), per plan §5.2.6/§4.9.
    const status = engine.status(cur.state);
    if (status.kind !== "ongoing") return false;
    return cur.record.steps.length > 0;
  }

  useEffect(() => {
    return () => {
      cancelPendingBot();
    };
  }, []);

  const status = engine.status(internal.state);
  const active = engine.active(internal.state);
  const activeSeat = status.kind === "ongoing" && active.mode === "sequential" ? active.player : null;
  const viewSeat = mode === "hotseat" ? internal.presentingSeat : humanSeat;
  const view = engine.playerView(internal.state, viewSeat);

  let legal: M[] = [];
  if (status.kind === "ongoing" && !internal.handoff?.pending) {
    const expectedSeat = mode === "hotseat" ? internal.presentingSeat : humanSeat;
    if (activeSeat === expectedSeat) legal = engine.legalMoves(internal.state, expectedSeat);
  }

  return {
    view,
    legal,
    status,
    activeSeat,
    presentingSeat: internal.presentingSeat,
    botThinking: internal.botThinking,
    botError: internal.botError,
    lockedUntil: internal.lockedUntil,
    canUndo: computeCanUndo(internal),
    ...(engine.score ? { score: engine.score(internal.state, humanSeat) } : {}),
    moveCount: internal.record.steps.length,
    restartCount: internal.restartCount,
    history: internal.record,
    firstOccurrence: internal.firstOccurrence,
    announcement: internal.announcement,
    handoff: internal.handoff,
    submitMove,
    undo,
    restart: reset,
    rematch: reset,
    confirmHandoff,
    setTier,
    describeBoard,
    retryBot,
  };
}

function engineActivePlayer<S extends WithEffects, M extends Json, V extends WithEffects>(
  engine: GameEngine<S, M, V>,
  state: S
): PlayerId {
  const active = engine.active(state);
  return active.mode === "sequential" ? active.player : 0;
}
