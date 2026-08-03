// packages/shell/src/components/GameShell.tsx — plan §4.1: composes everything else. Loads
// the manifest synchronously (the registry's eager catalog payload) then the engine +
// presentation asynchronously (the registry entry's own dynamic import() — the mechanism
// §3.2's registry-driven code splitting depends on); this file never statically imports any
// `games/*` module itself. States: loading (manifest + a board-shaped skeleton painted
// immediately; no spinner theater) / load-error (inline alert, Retry / Back to library — never
// a blank board) / ready / finished (ResultModal open over the dimmed board, ~300ms after the
// win animation so a fast rematcher never feels the modal beat them to it).
//
// "use client" — this is the game loop, pointer/keyboard state, and the settings overflow
// (plan §3.3's client-boundary rule); everything above it in the route (the header chrome, the
// server-painted skeleton) stays a Server Component.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameManifest, RegistryEntry } from "@twist-arcade/game-spec";
import type { Json, PlayerId } from "@twist-arcade/engine";
import { useGame, type DailyOptions, type Mode } from "../useGame";
import type { TurnPhase } from "../announcer";
import { stubBotDriver, type BotDriver, type TierId } from "../bot-driver";
import { composeShareArtifact, invokeShare } from "../share-frame";
import { pickNextTwist } from "../next-twist";
import { moveToCellId } from "../cell-id";
import { BoardShell } from "./BoardShell";
import { CalloutLayer } from "./CalloutLayer";
import { RuleCard } from "./RuleCard";
import { HowSheet } from "./HowSheet";
import { StatusLine } from "./StatusLine";
import { TurnIndicator } from "./TurnIndicator";
import { ScoreHUD } from "./ScoreHUD";
import { ControlsRow } from "./ControlsRow";
import { ResultModal } from "./ResultModal";
import { PassDeviceInterstitial } from "./PassDeviceInterstitial";
import { AriaAnnouncer } from "./AriaAnnouncer";

export interface GameShellProps {
  gameId: string;
  registryEntry: RegistryEntry;
  /** The eager manifest catalog (games/registry.ts re-exported) — needed for pickNextTwist. */
  manifests: readonly GameManifest[];
  mode: Mode;
  daily?: DailyOptions;
  humanSeat?: PlayerId;
  tierId?: TierId;
  /** Default: stubBotDriver(engine) once the engine resolves — S2 swaps in workerBotDriver. */
  botDriver?: BotDriver;
  /** Canonical share path; default `/play/{gameId}`. */
  shareUrl?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResolvedDefinition = { manifest: GameManifest; engine: any; presentation: any };

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | { kind: "ready"; definition: ResolvedDefinition };

const RESULT_MODAL_DELAY_MS = 300;

export function GameShell(props: GameShellProps) {
  const { registryEntry } = props;
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [retryToken, setRetryToken] = useState(0);
  const attemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const myAttempt = ++attemptRef.current;
    setLoadState({ kind: "loading" });
    Promise.all([registryEntry.loadEngine(), registryEntry.loadPresentation()]).then(
      ([engine, presentation]) => {
        if (cancelled || attemptRef.current !== myAttempt) return;
        setLoadState({ kind: "ready", definition: { manifest: registryEntry.manifest, engine, presentation } });
      },
      (error: unknown) => {
        if (cancelled || attemptRef.current !== myAttempt) return;
        setLoadState({ kind: "error", error });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [registryEntry, retryToken]);

  if (loadState.kind === "error") {
    return (
      <div className="mx-auto max-w-md p-4">
        <RuleCard sentence={registryEntry.manifest.ruleSentence} onHow={() => {}} />
        <div role="alert" className="mt-4 rounded border border-ink-muted p-4 text-center text-ink">
          <p>Couldn&apos;t load this game.</p>
          <div className="mt-3 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => setRetryToken((t) => t + 1)}
              className="rounded border border-ink px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Retry
            </button>
            <a
              href="/"
              className="rounded border border-ink-muted px-3 py-2 text-sm underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Back to library
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (loadState.kind === "loading") {
    return (
      <div className="mx-auto max-w-md p-4">
        <RuleCard sentence={registryEntry.manifest.ruleSentence} onHow={() => {}} />
        <div
          aria-hidden="true"
          className="relative mx-auto mt-4 animate-pulse rounded bg-ink-muted/20"
          style={{ width: "min(calc(100vw - 32px), 52svh)", aspectRatio: "1 / 1" }}
        />
      </div>
    );
  }

  return (
    <GameShellReady
      key={loadState.definition.manifest.id}
      gameId={props.gameId}
      definition={loadState.definition}
      manifests={props.manifests}
      mode={props.mode}
      {...(props.daily !== undefined ? { daily: props.daily } : {})}
      {...(props.humanSeat !== undefined ? { humanSeat: props.humanSeat } : {})}
      {...(props.tierId !== undefined ? { tierId: props.tierId } : {})}
      {...(props.botDriver !== undefined ? { botDriver: props.botDriver } : {})}
      shareUrl={props.shareUrl ?? `/play/${props.gameId}`}
    />
  );
}

interface GameShellReadyProps {
  gameId: string;
  definition: ResolvedDefinition;
  manifests: readonly GameManifest[];
  mode: Mode;
  daily?: DailyOptions;
  humanSeat?: PlayerId;
  tierId?: TierId;
  botDriver?: BotDriver;
  shareUrl: string;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = () => setMatches(mql.matches);
    mql.addEventListener?.("change", handler);
    return () => mql.removeEventListener?.("change", handler);
  }, [query]);
  return matches;
}

function GameShellReady({ gameId, definition, manifests, mode, daily, humanSeat, tierId, botDriver, shareUrl }: GameShellReadyProps) {
  const { manifest, engine, presentation } = definition;
  const [howOpen, setHowOpen] = useState(false);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [recentlyShownId, setRecentlyShownId] = useState<string | undefined>(undefined);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const isDark = useMediaQuery("(prefers-color-scheme: dark)");

  const effectiveBotDriver = useMemo(() => botDriver ?? stubBotDriver(engine), [botDriver, engine]);

  const game = useGame({
    definition,
    mode,
    botDriver: effectiveBotDriver,
    ...(humanSeat !== undefined ? { humanSeat } : {}),
    ...(tierId !== undefined ? { tierId } : {}),
    ...(daily !== undefined ? { daily } : {}),
  });

  useEffect(() => {
    if (game.status.kind === "ongoing") {
      setResultModalOpen(false);
      return;
    }
    const timer = setTimeout(() => setResultModalOpen(true), RESULT_MODAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [game.status.kind]);

  function handleCellAction(cellId: string): void {
    try {
      const move = JSON.parse(cellId) as Json;
      game.submitMove(move as never);
    } catch {
      // A malformed cellId must never crash the board.
    }
  }

  const { rows, cols } = presentation.boardDimensions(game.view);
  const dimmed = game.status.kind !== "ongoing";

  const nextTwist = pickNextTwist(gameId, manifests, recentlyShownId);

  // Documented S1 simplification (see ResultModal's own header comment): this is the minimal
  // 2P/solo-single COPY, not the full per-variant table from plan §7.2 (daily/solo phrasing —
  // "Solved in 23 — par 19", cause-specific solo-lost lines, etc.), which is S3 scope.
  const resultText =
    game.status.kind === "won"
      ? mode === "hotseat"
        ? `${game.status.winner === humanSeat ? "You" : `Player ${game.status.winner + 1}`} won`
        : game.status.winner === (humanSeat ?? 0)
          ? "You won"
          : "Bot wins"
      : game.status.kind === "lost"
        ? "You lost"
        : game.status.kind === "draw"
          ? "Draw"
          : game.status.kind === "scored"
            ? `${game.status.scores[humanSeat ?? 0] ?? 0} points`
            : "";

  async function handleShare() {
    const artifactBody = presentation.shareArtifact(game.history, game.view);
    const text = composeShareArtifact({
      title: manifest.title,
      resultPhrase: resultText,
      artifactBody,
      url: shareUrl,
      ...(daily ? { daily: { dayNumber: daily.dayNumber, ...(daily.par !== undefined ? { par: daily.par } : {}) } } : {}),
      ...(game.restartCount > 0 ? { restarts: game.restartCount } : {}),
    });
    return invokeShare(text);
  }

  // C4: GameShell previously built this onClick itself with no navigation prop at all, so no
  // app page could ever wire real navigation to it — invisible only because the registry was
  // still empty. `nextTwistHref` (below, passed to ResultModal) is the actual navigation now,
  // via a real `<a href>`; this stays purely the no-repeat bookkeeping pickNextTwist needs.
  const nextTwistHref = nextTwist ? `/play/${nextTwist.id}` : "";
  function handleNextTwistClick() {
    if (nextTwist) setRecentlyShownId(nextTwist.id);
  }

  // C3: useGame emits `handoff` with `pending: true` for the hidden-information (blocking)
  // variant and `pending: false` for the open-information (banner) variant — never both at
  // once, so branching on `pending` alone (rather than ALSO re-checking hiddenInformation,
  // which produced the impossible `pending && !hiddenInformation` the banner could never
  // satisfy) is sufficient and matches useGame's own contract.
  const showBanner = mode === "hotseat" && game.handoff !== null && !game.handoff.pending;
  const showBlockingInterstitial = mode === "hotseat" && game.handoff?.pending === true;

  // C3: hotseat never has a single "you" — presentingSeat tracks whichever seat is active, so
  // `activeSeat === presentingSeat` is true on every hotseat turn by construction, and the
  // generic "your-turn" phrase ("Your move.") would say the same thing to both players with no
  // actor named. Mirror useGame's own currentPhaseAndActor rule here: hotseat always gets the
  // actor-naming phrase; solo-bot names the bot explicitly instead of falling back to "Opponent".
  const statusPhase: TurnPhase = game.botThinking
    ? "bot-thinking"
    : game.status.kind !== "ongoing"
      ? "finished"
      : mode === "hotseat"
        ? "their-turn"
        : game.activeSeat === game.presentingSeat
          ? "your-turn"
          : "their-turn";
  const statusActorLabel =
    mode === "hotseat"
      ? `Player ${game.presentingSeat + 1}`
      : mode === "solo-bot" && statusPhase === "their-turn"
        ? "Bot"
        : undefined;

  return (
    <div className="mx-auto max-w-md p-4">
      <header>
        <h1 className="text-lg font-bold text-ink">{manifest.title}</h1>
      </header>

      <RuleCard sentence={manifest.ruleSentence} onHow={() => setHowOpen(true)} />

      {showBanner && <PassDeviceInterstitial nextLabel={`Player ${(game.handoff!.nextSeat ?? 0) + 1}`} variant="banner" onReady={game.confirmHandoff} />}

      <div className={dimmed ? "opacity-60" : undefined}>
        <div className="my-2">
          {mode === "solo-single" ? (
            <ScoreHUD movesUsed={game.moveCount} {...(game.score !== undefined ? { score: game.score } : {})} />
          ) : game.botError ? (
            // Plan §5.2.4: a retryable error state, never a silent hang — the board stays
            // legally inert (it's still the bot's turn) until this recovers.
            <div role="alert" className="flex flex-col items-center gap-2 text-center text-sm text-ink">
              <p>The bot couldn&apos;t make a move.</p>
              <button
                type="button"
                onClick={game.retryBot}
                className="rounded border border-ink px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                Retry
              </button>
            </div>
          ) : (
            <StatusLine
              phase={statusPhase}
              {...(statusActorLabel !== undefined ? { actorLabel: statusActorLabel } : {})}
              resultText={resultText}
            />
          )}
        </div>

        {mode !== "solo-single" && (
          <TurnIndicator
            seats={[
              { glyph: "X", label: mode === "hotseat" ? "Player 1" : "You", active: game.activeSeat === 0 },
              { glyph: "O", label: mode === "hotseat" ? "Player 2" : "Bot", active: game.activeSeat === 1 },
            ]}
          />
        )}

        <BoardShell
          rows={rows}
          cols={cols}
          disabled={game.legal.length === 0}
          onCellAction={handleCellAction}
          boardLabel={`${manifest.title} board`}
          lockedUntil={game.lockedUntil}
          reducedMotion={reducedMotion}
          overlay={<CalloutLayer firstOccurrence={game.firstOccurrence} />}
        >
          <presentation.Board
            view={game.view}
            legal={game.legal}
            onMove={(m: Json) => handleCellAction(moveToCellId(m))}
            seat={mode === "hotseat" ? game.presentingSeat : (humanSeat ?? 0)}
            prefs={{ reducedMotion, theme: isDark ? "dark" : "light" }}
          />
        </BoardShell>
      </div>

      <div className="mt-2">
        <ControlsRow
          canUndo={game.canUndo}
          {...(game.canUndo ? { onUndo: game.undo } : {})}
          onRestart={game.restart}
          onHow={() => setHowOpen(true)}
          confirmRestart={mode !== "hotseat" && game.moveCount >= 3 && game.status.kind === "ongoing"}
        />
      </div>

      <HowSheet open={howOpen} onOpenChange={setHowOpen} sentence={manifest.ruleSentence} frames={presentation.howSheetFrames} />

      {showBlockingInterstitial && (
        <PassDeviceInterstitial nextLabel={`Player ${(game.handoff!.nextSeat ?? 0) + 1}`} variant="blocking" onReady={game.confirmHandoff} />
      )}

      <ResultModal
        open={resultModalOpen}
        resultText={resultText}
        artifactBody={presentation.shareArtifact(game.history, game.view)}
        nextTwist={nextTwist}
        nextTwistHref={nextTwistHref}
        onRematch={game.rematch}
        onNextTwistClick={handleNextTwistClick}
        onShare={handleShare}
        onOpenChange={setResultModalOpen}
      />

      <AriaAnnouncer polite={game.announcement.polite ?? ""} assertive={game.announcement.assertive ?? ""} />
    </div>
  );
}
