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
import { composeShareArtifact, invokeShare, type ShareOutcome } from "../share-frame";
import { getSiteUrl } from "../site-url";
import { pickNextTwist } from "../next-twist";
import { moveToCellId } from "../cell-id";
import { BoardShell } from "./BoardShell";
import { CalloutLayer } from "./CalloutLayer";
import { GameHeader } from "./GameHeader";
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
  /** Default: `stubBotDriver(engine)` once the engine resolves — an SSR/no-driver-available
   *  fallback only. S2's real bot (`workerBotDriver`) is supplied here explicitly by the app
   *  route (`app/play/[gameId]/PlayClient.tsx`, via `app/bot-driver-singleton.ts`): GameShell
   *  itself cannot construct the concrete `new Worker(...)` (it would need to statically import
   *  `games/registry.ts`, which lives outside this package's tsconfig project — see
   *  `bot-driver.ts`'s `workerBotDriver` doc for the full reconciliation), so this prop is how
   *  the real driver reaches `useGame` without GameShell ever knowing a Worker exists. */
  botDriver?: BotDriver;
  /** Canonical share URL; default `${getSiteUrl()}/play/{gameId}` — a full, domain-qualified
   *  URL (plan §4.4's literal share artifacts, e.g. "twistarcade.game/d/fadeout", are never a
   *  bare path; C91 closed the gap where NEXT_PUBLIC_SITE_URL had no reader). Pass an explicit
   *  value to override (e.g. a future daily-mode caller using a `/d/{gameId}` route). */
  shareUrl?: string;
  /** Optional per-game emoji prefix for the share text's header (e.g. a daily-package caller's
   *  GLYPH_TABLE[gameId] entry — C8: shell's frame previously had no glyph concept at all).
   *  Omitted entirely (no leading space) when not supplied. */
  shareGlyph?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResolvedDefinition = { manifest: GameManifest; engine: any; presentation: any };

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | { kind: "ready"; definition: ResolvedDefinition };

const RESULT_MODAL_DELAY_MS = 300;

// Design 2a's header chip: a "daily N" badge takes priority over the tag facet whenever this
// instance is a certified daily run (real data already threaded through as `props.daily` —
// never a new field), falling back to the manifest's first tag (e.g. "◌ decay") otherwise.
// Omitted entirely when neither is available. Header accent (p1/p2) is derived from `mode`,
// not a new per-game manifest color: `solo-single` (score-chase/daily-puzzle formats, no
// opponent) gets the p2 band Crackstep's own mockup uses; every other mode (an opponent is
// present, human or bot) gets p1 — matching design 1b's own precedent of using these two hues
// as decorative chrome bands (app/page.tsx's masthead/hero), not "this names a player".
function headerChip(manifest: GameManifest, daily?: DailyOptions): string | undefined {
  if (daily) return `daily ${daily.dayNumber}`;
  return manifest.tags[0] ? `◌ ${manifest.tags[0]}` : undefined;
}

function headerAccent(mode: Mode): "p1" | "p2" {
  return mode === "solo-single" ? "p2" : "p1";
}

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

  const chip = headerChip(registryEntry.manifest, props.daily);
  const accent = headerAccent(props.mode);

  if (loadState.kind === "error") {
    return (
      <div className="mx-auto max-w-md space-y-3 p-4">
        <GameHeader title={registryEntry.manifest.title} accent={accent} {...(chip !== undefined ? { chip } : {})} />
        <RuleCard sentence={registryEntry.manifest.ruleSentence} onHow={() => {}} />
        {/* "Load error — never a blank board" (design 2a): a filled, stamped alert card, never
         *  a bare inline notice — the rules stayed fine, only the load failed. */}
        <div
          role="alert"
          className="rotate-[-0.4deg] rounded-xl border-brush border-ink bg-accent-p2 p-5 text-center text-paper shadow-print-3"
        >
          <p className="font-display text-2xl font-black">This twist didn&apos;t load.</p>
          <p className="mt-1 font-texture text-sm opacity-90">The rules are fine — the paper jammed.</p>
          <div className="mt-4 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => setRetryToken((t) => t + 1)}
              className="rounded-xl border-ui border-paper bg-marker px-4 py-2 font-mono text-sm font-semibold text-ink shadow-print-2 active:translate-x-0.5 active:translate-y-0.5 active:shadow-print-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Retry
            </button>
            <a
              href="/"
              className="rounded-xl border-ui border-paper px-4 py-2 font-mono text-sm font-semibold text-paper no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
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
      <div className="mx-auto max-w-md space-y-3 p-4">
        <GameHeader title={registryEntry.manifest.title} accent={accent} {...(chip !== undefined ? { chip } : {})} />
        <RuleCard sentence={registryEntry.manifest.ruleSentence} onHow={() => {}} />
        {/* "Loading — rule paints first" (design 2a): the rule sentence above is already real
         *  content (no skeleton needed for it); only the board area is a placeholder — a
         *  dimmed, staggered-blink grid with a "dealing the board…" caption, rather than one
         *  generic pulsing square. Purely decorative (`aria-hidden`) and covered by the global
         *  `prefers-reduced-motion` blanket (app/globals.css) like every other animation. */}
        <div
          aria-hidden="true"
          className="mx-auto grid grid-cols-3 grid-rows-3 gap-1 rounded bg-ink p-1.5"
          style={{ width: "min(calc(100vw - 32px), 52svh)", aspectRatio: "1 / 1" }}
        >
          {Array.from({ length: 9 }, (_, i) => (
            <span
              key={i}
              className="ta-blink block rounded-sm bg-paper-shade"
              style={{ animationDelay: `${i * 100}ms` }}
            />
          ))}
        </div>
        <p className="text-center font-mono text-xs uppercase tracking-wide text-ink-muted">dealing the board…</p>
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
      shareUrl={props.shareUrl ?? `${getSiteUrl()}/play/${props.gameId}`}
      {...(props.shareGlyph !== undefined ? { shareGlyph: props.shareGlyph } : {})}
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
  shareGlyph?: string;
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

// I9: `prefers-color-scheme` alone ignores app/layout.tsx's own theme bootstrap script, which
// honors an EXPLICIT `ta:settings.theme` override over the OS preference and applies it as the
// `.dark` class on `<html>` before paint (tokens.css/globals.css consume that class, not a raw
// media query, for every other color in the app). A board built from a raw matchMedia read
// could disagree with literally every other themed pixel on the page whenever an explicit
// override is in effect. Reads the actual applied class instead, via a MutationObserver so it
// stays correct if that class is ever toggled live (e.g. a future settings menu).
function useAppliedTheme(): "light" | "dark" {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark ? "dark" : "light";
}

function GameShellReady({ gameId, definition, manifests, mode, daily, humanSeat, tierId, botDriver, shareUrl, shareGlyph }: GameShellReadyProps) {
  const { manifest, engine, presentation } = definition;
  const [howOpen, setHowOpen] = useState(false);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [recentlyShownId, setRecentlyShownId] = useState<string | undefined>(undefined);
  // I4: best-effort text for ResultModal's share-failed fallback — set on every Share attempt
  // (success or failure) so the textarea always has SOMETHING sensible to show if the player
  // later needs it.
  const [shareFallbackText, setShareFallbackText] = useState("");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const theme = useAppliedTheme();

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

  // Minor: previously recomputed on every render (once inline in the ResultModal JSX prop
  // below) AND again inside handleShare on every Share click — memoized so it's computed once
  // per actual (history, view) change instead, and shared by both.
  const artifactBody = useMemo(
    () => presentation.shareArtifact(game.history, game.view),
    [presentation, game.history, game.view]
  );

  // Design 2a's italic reason line ("Patience wore down O's marks") — `presentation.
  // textureLine` already existed (Fadeout's own presentation.ts implements it) but had no
  // caller anywhere in the shell; ResultModal's own `textureLine` prop was likewise already
  // built and tested but never fed real data. Only meaningful once the game has actually
  // ended (`presentation.textureLine`'s own contract is a `finalView`), and only rendered when
  // it returns non-empty — a game whose textureLine has nothing to say for this particular
  // ending must never show an empty line.
  const textureLine =
    game.status.kind !== "ongoing" && presentation.textureLine ? presentation.textureLine(game.view) || undefined : undefined;

  async function handleShare(): Promise<ShareOutcome> {
    try {
      const text = composeShareArtifact({
        title: manifest.title,
        ...(shareGlyph !== undefined ? { glyph: shareGlyph } : {}),
        resultPhrase: resultText,
        artifactBody,
        url: shareUrl,
        ...(daily ? { daily: { dayNumber: daily.dayNumber, ...(daily.par !== undefined ? { par: daily.par } : {}) } } : {}),
        // Minor (stage-6 finding): restartCount accumulates across CASUAL rematches too — it
        // reflects "hit Rematch N times", not a meaningful retry signal outside daily. The share
        // frame's restart line is only meaningful where the plan defines it (§15 addendum 3):
        // daily contexts, where comparability is the point and a fifth attempt must never be
        // presented as a first. Gate on `daily` here, not just `restartCount > 0` — share-frame's
        // own contract ("mandatory whenever > 0") is correct for what IS passed to it; the bug was
        // this call site passing a casual restartCount at all.
        ...(daily && game.restartCount > 0 ? { restarts: game.restartCount } : {}),
      });
      setShareFallbackText(text);
      return await invokeShare(text);
    } catch {
      // I4: composeShareArtifact() throws ShareFrameTooLongError for a malformed (>7-line)
      // shareArtifact() body — a bug in a GAME's presentation, not something the player caused.
      // Uncaught, this crashed the Share button (an unhandled rejection with no UI feedback at
      // all). Degrade to the same "failed" state a real share/clipboard failure already has, so
      // there's still a working fallback rather than a dead button — falling back further to
      // just the raw artifact body (rather than nothing) since the full text couldn't be built.
      setShareFallbackText(artifactBody);
      return "failed";
    }
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

  // Design 2a's "Crackstep · daily solo · desktop" panel: a game gets a wider shell + a
  // responsive two-column layout (board+controls left, the game's own side panel right) at
  // md+ ONLY when it explicitly opts in via `presentation.sidePanel` (game-spec's `sidePanel`
  // flag) — every other game keeps the original single centered column at every viewport,
  // unchanged. Post-merge fix: this used to be inferred from `extraControls !== undefined`
  // alone, which silently opted Mine Run's BankBar and Tilt's Telegraph into this layout too —
  // both supply `extraControls` for their own, unrelated reasons and neither wants a right-hand
  // column (mine-run.md §8.1, tilt.md §6.1). Gate strictly on the explicit flag.
  const hasSidePanel = presentation.sidePanel === true;
  const readyChip = headerChip(manifest, daily);

  // Identical in both the side-panel and default branches below — hoisted once so the two
  // layout branches differ only in how they WRAP BoardShell/extraControls, never in BoardShell's
  // own props (avoids the two branches silently drifting apart under a future edit).
  const boardShellElement = (
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
        prefs={{ reducedMotion, theme }}
      />
    </BoardShell>
  );

  return (
    <div className={hasSidePanel ? "mx-auto max-w-3xl space-y-3 p-4" : "mx-auto max-w-md space-y-3 p-4"}>
      <GameHeader title={manifest.title} accent={headerAccent(mode)} {...(readyChip !== undefined ? { chip: readyChip } : {})} />

      <RuleCard sentence={manifest.ruleSentence} onHow={() => setHowOpen(true)} />

      {showBanner && <PassDeviceInterstitial nextLabel={`Player ${(game.handoff!.nextSeat ?? 0) + 1}`} variant="banner" onReady={game.confirmHandoff} />}

      <div className={dimmed ? "opacity-60" : undefined}>
        <div className="my-2">
          {mode === "solo-single" ? (
            <ScoreHUD
              movesUsed={game.moveCount}
              {...(game.score !== undefined ? { score: game.score } : {})}
              {...(daily?.par !== undefined ? { par: daily.par } : {})}
            />
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

        {hasSidePanel ? (
          // Opt-in two-column md+ panel (Crackstep's SidePanel only — presentation.sidePanel).
          // The wrapper grid div, and extraControls' own `mt-4 md:mt-0` (mobile stacking gap,
          // removed once the grid goes two-column at md+), exist ONLY on this branch, since
          // only this branch ever lays `extraControls` out beside the board instead of below it.
          <div className="md:grid md:grid-cols-[1fr_300px] md:items-start md:gap-6">
            {boardShellElement}

            {presentation.extraControls && (
              <div className="mt-4 md:mt-0">
                <presentation.extraControls
                  view={game.view}
                  legal={game.legal}
                  onMove={(m: Json) => handleCellAction(moveToCellId(m))}
                  seat={mode === "hotseat" ? game.presentingSeat : (humanSeat ?? 0)}
                  prefs={{ reducedMotion, theme }}
                />
              </div>
            )}
          </div>
        ) : (
          // Default, pre-existing layout (Mine Run's BankBar, Tilt's Telegraph, and every game
          // without extraControls): BoardShell and extraControls (if any) are plain siblings in
          // the single centered column, no grid wrapper and no extra spacing wrapper — exactly
          // the pre-design-2a DOM shape these games always had.
          <>
            {boardShellElement}

            {presentation.extraControls && (
              <presentation.extraControls
                view={game.view}
                legal={game.legal}
                onMove={(m: Json) => handleCellAction(moveToCellId(m))}
                seat={mode === "hotseat" ? game.presentingSeat : (humanSeat ?? 0)}
                prefs={{ reducedMotion, theme }}
              />
            )}
          </>
        )}
      </div>

      <div className="mt-2">
        <ControlsRow
          canUndo={game.canUndo}
          {...(game.canUndo ? { onUndo: game.undo } : {})}
          onRestart={game.restart}
          onHow={() => setHowOpen(true)}
          // I10, orchestrator ruling: hotseat confirms Restart whenever moveCount >= 1, NOT the
          // solo >= 3 threshold — destroying a shared two-player game with one accidental tap
          // is the STRONGER case for a guard, not the weaker one solo's higher threshold
          // implied. `mode !== "hotseat" && ...` previously made this unconditionally false for
          // every hotseat game — a mid-game restart never confirmed at all.
          confirmRestart={game.status.kind === "ongoing" && (mode === "hotseat" ? game.moveCount >= 1 : game.moveCount >= 3)}
          extras={
            // I6: describeBoard() (plan §6.2's "readback on request") had zero consumers —
            // composed but never triggerable. A visible, always-discoverable control (not just a
            // keybinding) so a screen-reader user doesn't have to already know a shortcut exists.
            <button
              type="button"
              onClick={game.describeBoard}
              className="rounded px-3 py-2 font-mono text-xs text-ink-muted underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Describe board
            </button>
          }
        />
      </div>

      <HowSheet open={howOpen} onOpenChange={setHowOpen} sentence={manifest.ruleSentence} frames={presentation.howSheetFrames} />

      {showBlockingInterstitial && (
        <PassDeviceInterstitial nextLabel={`Player ${(game.handoff!.nextSeat ?? 0) + 1}`} variant="blocking" onReady={game.confirmHandoff} />
      )}

      <ResultModal
        open={resultModalOpen}
        resultText={resultText}
        {...(textureLine !== undefined ? { textureLine } : {})}
        artifactBody={artifactBody}
        shareFallbackText={shareFallbackText || artifactBody}
        nextTwist={nextTwist}
        nextTwistHref={nextTwistHref}
        onRematch={game.rematch}
        onNextTwistClick={handleNextTwistClick}
        onShare={handleShare}
        onOpenChange={setResultModalOpen}
        {...(daily !== undefined ? { dayNumber: daily.dayNumber } : {})}
      />

      {/* I7: `token={game.announcement}` — useGame hands back a FRESH object literal every time
       *  it composes a new announcement (even when the resulting text repeats verbatim), so its
       *  identity is exactly the "this is a genuinely new event" signal AriaAnnouncer needs to
       *  force a live-region mutation for a repeated identical phrase. */}
      <AriaAnnouncer
        polite={game.announcement.polite ?? ""}
        assertive={game.announcement.assertive ?? ""}
        token={game.announcement}
      />
    </div>
  );
}
