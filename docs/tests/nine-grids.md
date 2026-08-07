# Test Plan — Nine Grids (Ultimate Tic-Tac-Toe, strict ruleset)

*Fable test design (stage 3), 2026-08-07. Branch `feature/ninegrids`, worktree
`/Users/raymundrafael/Desktop/repos/claude-project-ninegrids`.*

*Sources of acceptance criteria: `games/nine-grids/engine.ts` / `engine-internal.ts` /
`manifest.ts` module documentation (the engine's own rule statement),
`docs/research/games/game-theory-lens.md` §1.10 and §4 entry 2 (the strict-ruleset
definition), `docs/plans/platform-corrections.md` C4 / C5 / C16 / C17 / C23,
`docs/research/games/ux-lens.md` §8–§9, and `docs/plans/ui-direction.md` §5. Cases were
derived from the documented rules; the implementation was consulted only to (a) capture
verbatim error text for expected results and (b) validate the decode-built fixtures in
Appendix B, which were executed against the engine on 2026-08-07 and behaved exactly as
this plan predicts — so any future divergence on those fixtures is a regression, not a
fixture bug.*

**Ground-truth notes (read before executing):**

- The parent brief cited "C26" for the `ruthless-vs-standard: 42.0% [WARN]`. **C26 does not
  exist** — `platform-corrections.md` ends at C23. The applicable text is the **C19
  postscript** (~line 805): at CI's reduced rollout budget, `ruthless` collides with
  `standard`, so the ratio is a measurement artifact, not a game defect. The citation is
  wrong; the substance is right.
- The brief said the game is "not yet registered." **`games/registry.ts` already contains
  the `nine-grids` entry** (scaffold-inserted; the CHECKLIST confirm-line is still open).
  `/play/nine-grids` therefore already resolves — to the deliberate engine-only placeholder
  `ui/Board.tsx` (no macro layout, no active-board or closed-board rendering).
- `index.ts`'s `announce()`, `shareArtifact()`, and `howSheetFrames` are **TODO
  placeholders**. Every case below tagged **[SPEC]** is written against the required
  behavior and is **expected to FAIL on today's build**. Executors must record those as
  FAIL, not skip them and not mark them pass — a placeholder that happens to satisfy a
  weakened reading of the assertion is itself a finding.

---

## The ruleset under test (as derived from the documents)

1. Nine 3×3 micro boards arranged in a 3×3 macro grid. `Move = {board: 0..8, cell: 0..8}`,
   both row-major. X = player 0 moves first; strict alternation.
2. **The send rule:** a move in cell *c* of any board sends the opponent to board *c*
   (`activeBoard = c`) — *unless* board *c* is closed at the end of that move, in which
   case the opponent gets a **free move**: `activeBoard = null`, any empty cell of any
   still-open board.
3. A micro board is **closed** when it is *won* (three-in-a-row) or *full with no line*
   (drawn). Closed boards accept no further marks, ever — including empty cells of a
   won-but-not-full board, and including during free moves. A board that fills and
   completes a line on the same mark is **won**, not drawn (per `MicroBoardStatus`'s
   definition: `full` = "filled with **no** three-in-a-row").
4. **Game win:** three micro boards won by the same player forming a macro line. Drawn
   (full) boards count for **neither** player. **Game draw:** all nine boards closed with
   no macro line. Win takes precedence when one move produces both. The game ends the
   instant status is non-ongoing, even with boards still open.
5. The loose variant ("sent to a won board → anywhere, but a full board still confines")
   is deliberately **not** implemented; a case below distinguishes them.

### Send-rule decision table (Area SEND/FREE enumerates every row)

| # | Mover was | Plays (b, c) | Board *c* status **after** the move | Opponent's constraint | Case |
|---|---|---|---|---|---|
| 1 | free (opening) | any empty cell | open | confined to board *c* | SEND-001/002 |
| 2 | confined to *b* | c ≠ b, board *c* open | open | confined to board *c* | SEND-003 |
| 3 | confined to *b* | c = b, board *b* still open | open | confined to board *b* (same board) | SEND-004 |
| 4 | either | board *c* won on an earlier turn | won | **free** | SEND-007 |
| 5 | either | board *c* full (drawn) earlier | full | **free** | SEND-008 |
| 6 | either | c = b and this very move closes board *b* | closed by this move | **free** | SEND-009 |
| 7 | either | move ends the game (macro win / all closed) | — | none: game over, no send | WIN-003, TERM-002/003 |

Note row 6 is the only "closed by this very move" shape possible: a move at (b, c) can
change only board *b*'s status, so a same-move-closed send target requires c = b.

---

## How to execute (stage 4)

Two levels, marked per case in the **Lvl** column:

- **ENG** — engine-level. From the worktree root, write a scratch spec at
  `games/nine-grids/test/__qa__/<case-id>.test.ts` (or a `pnpm exec tsx` one-off importing
  `./games/nine-grids/engine`), run it, record actual vs. expected, then delete the scratch
  (or keep it if stage 5 promotes it — preferred for every Critical). Fixtures named `D*`
  come from Appendix B (decode-built); scripts named `S*` from Appendix A (played from
  `setup`).
- **UI** — browser-level via Playwright MCP / Claude in Chrome against `next dev` (or
  `next build && next start` where the case says so), route `/play/nine-grids`, hotseat
  mode so the executor controls both seats. UI cases tagged **[SPEC]** will FAIL against
  today's placeholder board — record the FAIL.
- A case **passes only if the exact expected result is observed**. "It threw something"
  does not satisfy an expectation naming `NineGridsDecodeError`; "some cells disabled"
  does not satisfy an expectation naming the exact legal-move count.
- Two harness gate runs are active on this machine: do **not** launch `harness suite`
  runs during execution; nothing in this plan requires one.
- Every case's **"A failure would mean"** column names the defect class the case exists to
  catch — if a case fails and the observed behavior doesn't match that column either,
  something *else* is broken: stop and report rather than re-running until green.

---

## Area SEND — the send rule

| ID | Sev | Lvl | Preconditions | Steps | Expected result | A failure would mean |
|---|---|---|---|---|---|---|
| SEND-001 | Critical | ENG | `setup(2, rng)` | Inspect initial state; `legalMoves(s, 0)` | `activeBoard === null`, `toMove === 0`, exactly **81** legal moves (every (b, c)); `legalMoves(s, 1)` is `[]` | Opening wrongly confined, or seat-1 allowed to open |
| SEND-002 | Critical | ENG | fresh game | X plays (4, 7); inspect | `activeBoard === 7`, `toMove === 1`; `legalMoves(s, 1)` = exactly the 9 moves of board 7; `isLegal(s, 1, {board: 3, cell: 0})` = false | The core rule broken: cell index not mapped to target board |
| SEND-003 | Critical | ENG | fresh game | Play X(0,5) → O(5,1) → X(1,6); assert `activeBoard` after each ply | 5, then 1, then 6 — each equals the **cell** index just played, with asymmetric indices | A row/col **transpose** in cell→board mapping (a bug the symmetric-mirror probe cannot see) |
| SEND-004 | High | ENG | fresh game | X(5,5)? No — X free plays (3,5) → O confined b5; O plays (5,5) | After O's move `activeBoard === 5`: X is sent to the **same board O just played in** | "Send to the board you're already in" special-cased away or skipped |
| SEND-005 | Medium | ENG | continue SEND-004 | X plays (5,3) | `activeBoard === 3`: ping-pong back; both boards accumulate marks; earlier marks intact | Constraint computed from stale state across bounces |
| SEND-006 | Critical | ENG | any state with `activeBoard = b` (e.g. after SEND-002) | For every open board b′ ≠ b, `isLegal(s, mover, {board: b′, cell: anyEmpty})` | **false for all of them**, even though those boards are open and the cells empty; `legalMoves` ⊆ board b | Confinement advisory only — legality computed from openness alone (game degenerates to 9 parallel TTTs) |
| SEND-007 | Critical | ENG | script S1 played, then O(5,0) (S1b) | X is sent to board 0, which was **won on an earlier turn** | `activeBoard === null`; X has **69** legal moves; none in board 0 | The closed-board free-move rule missing → either the loose variant or a hard-locked dead seat |
| SEND-008 | Critical | ENG | fixture **D1** (board 4 full-drawn; O confined to b0) | O plays (0, 4) → X sent to the **full** board 4 | `activeBoard === null`, `toMove === 0`; X has **71** legal moves; none in board 4 | Only the *won* branch of "closed" handled — the strict-vs-loose ruleset distinguisher |
| SEND-009 | Critical | ENG | script S1 through ply 4 | X plays (0,0) — this **wins board 0 and targets board 0** (row 6 of the table) | Board 0 status `won` winner 0; `activeBoard === null` (O free, **70** legal, none in b0) | Send computed against board status **before** the move — opponent locked into a just-closed board |
| SEND-010 | Medium | ENG | S1b state (X free) | X plays (3, 4) | `activeBoard === 4`: normal sending resumes after a free move | Free-move state sticky |
| SEND-011 | High | UI [SPEC] | real board UI; mid-game with `activeBoard` set | Observe the board | The active board is visually distinct **and** stated in text (StatusLine, e.g. "Play in the top-right board"); cells outside it are non-actionable | Send communicated by highlight alone — invisible to SR users and in grayscale |

## Area FREE — the closed-board free move

| ID | Sev | Lvl | Preconditions | Steps | Expected result | A failure would mean |
|---|---|---|---|---|---|---|
| FREE-001 | Critical | ENG | S1 state (b0 won by X, 6 of its cells still empty; O free) | `isLegal(s, 1, {board: 0, cell: 3})` (an **empty** cell of the **won** board) | **false**; b0 absent from `legalMoves` | The "play anywhere" misreading — marks into won-not-full boards (ambiguity A2, reading pinned here) |
| FREE-002 | High | ENG | S1 state | Enumerate O's free moves | All 70 empty cells of boards 1–8, including board 5 (where play just was) and boards O previously visited | Free move over-restricted (excluding "recent" boards) |
| FREE-003 | Medium | ENG | fixture **D2a** (8 boards closed, board 4 has exactly one empty cell; X confined to b4) | `legalMoves(s, 0)` | Exactly `[{board: 4, cell: 8}]` | Legal-move enumeration breaks at the near-terminal boundary |
| FREE-004 | Medium | ENG | scripts S1/S3 traces | Assert: `activeBoard === null` occurs **only** at the opening and immediately after rows 4–6 of the decision table | Holds at every ply | Free moves leaking out of ordinary sends |
| FREE-005 | High | UI [SPEC] | real board; reach S1's ply-5 state by playing script S1 in hotseat | Observe after the closing send | Whole-board free-move state shown: **all open boards** actionable, closed board visibly closed, text states "play in any open board" | The game's central teaching moment silent — the Fadeout failure shape |

## Area WIN — sub-board and macro wins

| ID | Sev | Lvl | Preconditions | Steps | Expected result | A failure would mean |
|---|---|---|---|---|---|---|
| WIN-001 | Critical | ENG | script S1 | After ply 5, board 0 = X at cells 0,1,2 | Board 0 derived status `won` winner 0; its 6 empty cells illegal for **both** players for the rest of the game (spot-check after 2 more plies) | Won board re-opens or keeps accepting marks |
| WIN-002 | Critical | ENG | fixture **D4** (boards 0 and 8 won by X; board 4 open with X at 0,4) | X plays (4, 8) | Board 4 `won` (diagonal 0-4-8); game status `{kind: "won", winner: 0}` — macro line b0-b4-b8 | Macro composition broken (sub-wins don't aggregate) |
| WIN-003 | Critical | ENG | D4 after the winning move | `legalMoves` for both seats; `apply` any move | Both `[]`; `apply` throws `Error` containing "illegal move" ; state unchanged (ATOM-001 shape) | Play past game end |
| WIN-004 | High | ENG | D4 after the winning move | Count boards still open | Boards 1,2,3,5,6,7 are **fully empty and open**, yet the game is over | Engine waits for all boards to resolve before declaring the win |
| WIN-005 | Critical | ENG | fixture **D3** (X won boards 0,2,3,7,8; O won 1,5,6; board 4 full-drawn) | `status(s)` | `{kind: "draw"}` — X's 0-4-8 macro diagonal is **not** a win because board 4 is drawn: drawn boards count for neither player | Drawn boards treated as wildcards or credited to a player |
| WIN-006 | Medium | ENG | isolated board: b0 = X{0,2,4,7}, O{1,3,5,8}, cell 6 empty (`activeBoard: 0`, `toMove: 0`, decode-built; see Appendix B) | X plays (0, 6) — fills the board **and** completes line 2-4-6. Observe `boardStatusOf(after.cells, 0)` (exported from `./games/nine-grids/engine-internal`) | `{kind: "won", winner: 0}` — **not** `full`; won-and-full resolves to won. Bonus observation (validated): `activeBoard` after the move is **6** — board 6 is open, so the send is a normal confinement despite the mover's own board closing | Fill-check running before line-check: a winning final mark scored as a draw |
| WIN-007 | Medium | ENG | fixture **D4m** (Appendix B): D4 with all owners swapped **plus one extra X mark** at (1, 0) to keep turn parity legal for `toMove: 1` | O plays (4, 8) | `{kind: "won", winner: 1}` (validated 2026-08-07) | Winner hardcoded to seat 0 somewhere in macro logic |
| WIN-008 | High | UI [SPEC] | real board; play S1 in hotseat | Board-0 win moment | Won board rendered closed with the **winner's glyph** at macro scale (glyph, not hue alone); state readable in grayscale | Sub-board ownership illegible — macro game unreadable |

## Area TERM — draw and termination

| ID | Sev | Lvl | Preconditions | Steps | Expected result | A failure would mean |
|---|---|---|---|---|---|---|
| TERM-001 | Critical | ENG | fixture **D3** | `status`, `legalMoves` both seats | `draw`; `[]` / `[]` | Terminal draw unreachable or non-terminal |
| TERM-002 | Critical | ENG | fixture **D2a** | X plays (4, 8) — the **last legal cell of the entire game** | Status flips to `{kind: "draw"}` immediately; zero legal moves; no error | Termination hole: `ongoing` with no legal moves (contract violation), or the final move rejected |
| TERM-003 | Critical | ENG | fixture **D2b** (same shape but the final fill also wins board 4, completing X's 0-4-8 macro line) | X plays (4, 8) | `{kind: "won", winner: 0}` — **won beats draw** when one move produces both | Status-check ordering: a game-winning final move scored a draw |
| TERM-004 | High — **pending ruling A1** | ENG | fixture **D2a** *before* the final move (macro win already impossible for both players: every macro line is blocked) | `status(s)` | Per the pinned reading: `{kind: "ongoing"}` — the game continues until all boards close, even though the result is already forced | If it returns `draw`: engine implements early dead-position adjudication the docs don't describe. Either way, orchestrator ruling A1 decides the *intended* rule |
| TERM-005 | Medium | UI [SPEC] | real board; hotseat game ending in D2b-style win | Observe end state | Result surfaced once (ResultModal), board frozen, no further input accepted; winning macro line drawn as the §9 stroke | UI lets play continue past the end, or result never surfaces |

## Area BND — boundary conditions

| ID | Sev | Lvl | Preconditions | Steps | Expected result | A failure would mean |
|---|---|---|---|---|---|---|
| BND-001 | High | ENG | `setup(2, rng)` | `decode(encode(s))` | Round-trips: 81 nulls, `activeBoard null`, `toMove 0`, `lastEffects []` | Empty-board encoding broken from day one |
| BND-002 | Medium | ENG | fresh game ×2 | X plays (0, 0); separately X plays (8, 8) | `activeBoard` 0 and 8 respectively — both index extremes map correctly | Off-by-one at the index boundaries |
| BND-003 | Medium | ENG | fixture D2a | Board 4 has 8 marks, one empty | Board 4 status still `open`; exactly 1 legal move | An 8-mark board prematurely closed |
| BND-004 | Medium | ENG | any mid-game state | `isLegal` with `board: 8, cell: 8` (max legal) and `board: 0, cell: 0` (min legal) on empty cells of open boards | Judged on the merits (true when in the active board / free) — bounds checks don't clip valid extremes | Fencepost in the bounds guard |

## Area INV — invalid and malformed moves

| ID | Sev | Lvl | Preconditions | Steps | Expected result | A failure would mean |
|---|---|---|---|---|---|---|
| INV-001 | Critical | ENG | fresh game: X plays (4, 4) → O confined to board 4 | O submits (4, 4) — the cell X just occupied | `isLegal` false; `apply` throws `Error` whose message contains `illegal move` and the stringified move; absent from `legalMoves` | Occupied-cell replacement |
| INV-002 | Critical | ENG | S1 state (O free) | O submits (0, 3) — empty cell, **won** board | `isLegal` false; `apply` throws | Closed-board writes (see FREE-001) |
| INV-003 | Critical | ENG | D1 after O(0,4) (X free, board 4 full) | X submits (4, 0)…(4, 8) each | All false | Full-board writes |
| INV-004 | Critical | ENG | after SEND-002 (confined to b7) | O submits (2, 0) — open board, empty cell, **outside the sent board** | `isLegal` false; `apply` throws; state unchanged | The confinement half of the send rule unenforced at the server-validation seam (`isLegal` is what servers call, per its contract) |
| INV-005 | High | ENG | any ongoing state | `isLegal` with `board: 9`, `board: -1`, `cell: 9`, `cell: -1`, `board: 4.5`, `cell: NaN` | **false** for each — a boolean, never a throw, never an array index out of bounds returning `undefined`-derived truthiness | Range guard missing → crash or phantom legality on hostile input |
| INV-006 | Critical | ENG | D3 (drawn) and D4-post (won) | `isLegal` any move; `legalMoves` both seats | false / `[]` — terminal states accept nothing | Post-game moves mutate a finished record |
| INV-007 | Medium | ENG | any ongoing state | `apply(s, new Map(), rng)` — no entry for the active player | Throws `Error` with message containing `apply() called without a move for the active player` | Missing-move path returns undefined state |
| INV-008 | Low | ENG | after SEND-002 | `isLegal(s, 1, {board: 7, cell: 0, extra: "x"})` on an empty cell | true — extra Json keys ignored; legality judged on `board`/`cell` only | Over-strict shape check rejecting decorated moves from the shell |

## Area DEC — `decode`/`encode` (platform-corrections C4)

Every rejection must throw an error with **`name === "NineGridsDecodeError"`** and a message
beginning `nine-grids engine: decode() received a malformed encoding:` — "it threw
something" is not a pass. `decode` must never return a partial, defaulted, or mutated
state.

| ID | Sev | Lvl | Preconditions | Steps | Expected result | A failure would mean |
|---|---|---|---|---|---|---|
| DEC-001 | Critical | ENG | — | `decode("")`, `decode("{")`, `decode("not json")` | Throws NineGridsDecodeError, message mentions `not valid JSON` | Lenient parse → forged record validates (the C4 trust boundary) |
| DEC-002 | Critical | ENG | — | `decode("42")`, `decode("null")`, `decode("\"x\"")`, `decode("[]")` | Throws NineGridsDecodeError (non-object; `[]` fails the cells check) | Same class |
| DEC-003 | Critical | ENG | — | cells length 80; length 82; a cell value `2`; `"0"`; `true`; `cells` key missing | Each throws, message names `cells` and the 81/0/1/null contract | Same class |
| DEC-004 | Critical | ENG | — | `toMove: "0"`, `2`, `null`, missing | Each throws (`toMove` must be 0 or 1) | Same class |
| DEC-005 | Critical | ENG | — | `activeBoard: 9`, `-1`, `4.5`, `"4"` (with otherwise-valid state) | Each throws; `activeBoard: null` on the same state is **accepted** | Same class; or null wrongly rejected, breaking every free-move encoding |
| DEC-006 | Critical | ENG | — | Valid shape, X=2 O=0 `toMove: 0`; also X=0 O=1 any `toMove` | Throws: mark counts inconsistent with `toMove` (P0 leads by exactly 0 or 1) | Turn-order forgery accepted into replay/verification |
| DEC-007 | Critical | ENG | — | Valid shape, `activeBoard` pointing at (a) a won board (b0 = pattern **WX0**, `activeBoard: 0`), (b) a full board (D1's cells with `activeBoard: 4`) | Both throw: `activeBoard` must refer to a still-open board (validated 2026-08-07) | Impossible confinement accepted — downstream `legalMoves` returns `[]` mid-game, soft-locking replays |
| DEC-008 | Critical | ENG | — | For three of the above rejects, call twice and `try/catch` | Same typed error both times; **no return value ever observed**; nothing about module state changes (a subsequent valid `decode` still works) | Partial-state leak on the error path |
| DEC-009 | Critical | ENG | fixtures D1, D3, D4 + S1 mid-game state | `decode(encode(s))` | Deep-equal on `cells`/`activeBoard`/`toMove`; `lastEffects` comes back `[]` | Round-trip drift — stored games diverge from live games |
| DEC-010 | High | ENG | S1 state | `encode(s)` vs `encode({...s, lastEffects: [<any effect>]})` | **Byte-identical** (validated 2026-08-07) — effects are excluded from the canonical encoding (CHECKLIST trap 2) | Position-key poisoning: identical positions hash differently for solver/repetition machinery |
| DEC-011 | High — **pending ruling A3** | ENG | — | `decode` of b0 = `[0,0,0,1,1,1,null,null,null]` (an X line **and** an O line in one board — structurally impossible: a board closes at its first line), rest empty, `toMove: 0`, `activeBoard: null` | **Observed 2026-08-07: decodes without error**, status `ongoing`, board 0 scored for X (LINES order). Per the strict C4 reading ("a state satisfying the engine's own invariants, or throws") this arguably should throw. **Executor: record the observed behavior; do not score pass/fail until ruling A3.** | Whichever way the ruling goes: today the behavior is undocumented, and which player owns a double-line board is decided by internal array order |
| DEC-012 | Medium | ENG | fixture D1 built twice (independent object literals) | `encode` both | Byte-identical — canonical key order via `stableStringify` | Encoding nondeterminism breaks certificates |

## Area TURN — turn order and identity

| ID | Sev | Lvl | Preconditions | Steps | Expected result | A failure would mean |
|---|---|---|---|---|---|---|
| TURN-001 | Critical | ENG | D1 (`toMove: 1`) | `legalMoves(s, 0)` | `[]` — the non-mover has no moves | Out-of-turn play enumerable |
| TURN-002 | Critical | ENG | D1 | `isLegal(s, 0, m)` for an `m` that is legal for seat 1 | false — the same move, wrong seat | The wrong-seat submission hole: a move validated for whoever sends it |
| TURN-003 | High | ENG | D1 | `apply(s, new Map([[0, m]]), rng)` — map keyed only to the non-mover | Throws (`without a move for the active player`); state unchanged | Seat identity ignored at apply |
| TURN-004 | Critical | ENG | fresh game | X plays (4, 4); then X immediately submits another move (`isLegal(s', 0, …)`) | false for every move — the same seat cannot move twice; `toMove` is now 1 | Turn never advances / double-move |
| TURN-005 | High | UI [SPEC] | real board, hotseat | Double-tap the same legal cell as fast as possible | Exactly one mark placed; turn advances exactly once; second tap is a no-op (cell now occupied → rejected path) | Duplicate submission races through the UI seam |
| TURN-006 | High | UI [SPEC] | real board, hotseat | Tap two *different* legal cells in immediate succession (before re-render) | Exactly one of the two applies (the first); board state consistent with a single ply | Concurrency at the commit path applies both, corrupting `activeBoard` |
| TURN-007 | Medium | UI/shell — **deferred** | async-link mode (phase 2 shell) | Submit a move over the link as the wrong seat | Server-side rejection; game state unchanged for both viewers | Marked DEFERRED until the async shell exists; the engine-side halves are TURN-001/002/003 |

## Area ATOM — state after failure (no partial application)

| ID | Sev | Lvl | Preconditions | Steps | Expected result | A failure would mean |
|---|---|---|---|---|---|---|
| ATOM-001 | Critical | ENG | after SEND-002; capture `pre = encode(s)` and `preEffects = s.lastEffects` | Attempt each of: occupied cell, out-of-sent-board, out-of-range board, move after making the state terminal (use D4-post) — via `apply`, catching the throw | Every attempt throws; after each, `encode(s) === pre`, `s.toMove` unchanged, `s.activeBoard` unchanged, `s.lastEffects === preEffects` (same reference, nothing appended) | Partial write on the rejection path — the exact "no partial writes, no orphaned rows" clause of §2 stage 3 |
| ATOM-002 | Critical | ENG | S1 mid-game state | `apply` a **legal** move; then re-`encode` the *input* state | Input state byte-identical to before the call; returned state is a new object; input `cells` array not mutated | `apply` mutates in place — replay, undo, and MCTS rollouts all silently corrupt |
| ATOM-003 | High | UI [SPEC] | real board, mid-game with `activeBoard` set | Tap an empty cell **outside** the active board | No mark appears, turn does not flip, active-board indication unchanged, no move announcement fired; (optional feedback like a shake is fine — it must not be motion-only) | UI half of the atomicity contract: a rejected move that half-renders |
| ATOM-004 | Medium | UI [SPEC] | real board | Tap an occupied cell; tap a closed board's empty cell | Same as ATOM-003 | Same |

## Area A11Y — accessibility (load-bearing; all [SPEC] — `announce()` is TODO today)

The rule this area enforces (ux-lens §8–9, C5): **the send is the game**, and a
screen-reader or reduced-motion player must be *told* "which board am I sent to, and why,"
not shown a highlight. Verbatim strings do not exist yet; expected results below are
**information-content contracts** with example sentences. When the UI pass writes the real
strings, pin them verbatim into this plan (ground-truth discipline) and re-run.

| ID | Sev | Lvl | Preconditions | Steps | Expected result | A failure would mean |
|---|---|---|---|---|---|---|
| A11Y-001 | Critical | UI [SPEC] | real board, SR-inspectable live region (`AriaAnnouncer`) | X plays (4, 7); read the polite live region | One composed sentence, order *what happened → what's imminent/constraint → whose turn*, that names: the mover's glyph, where it was placed (human terms, e.g. "center board, bottom middle"), **which board the opponent is sent to**, and whose move it is. Example shape: "X placed in the center board, bottom middle. O plays in the bottom-middle board. O's move." | The send inaudible — a SR user cannot know where they're allowed to play; Fadeout shipped exactly this failure |
| A11Y-002 | Critical | UI [SPEC] | play script S1 in hotseat | Read the live region after ply 5 (the winning, self-closing send) | The sentence conveys **all three** events: board 0 won by X, the opponent's destination is closed, **and the consequence + reason**: e.g. "X wins the top-left board. The top-left board is closed — O may play in any open board. O's move." | The rule's teaching moment silent at exactly the ply where the game teaches its twist |
| A11Y-003 | Critical | UI [SPEC] | reach S1b (send to a board closed on an *earlier* turn) | Read the live region | States the free move **and why**: destination board already won/full | Free move announced with no reason — player can't build the rule's mental model |
| A11Y-004 | Critical | UI [SPEC] | play to a macro win (D4 script or hotseat game); also a drawn game if reachable in-session | Game end | Announced **assertively, once**: winner and how ("X wins — three boards in a row down the diagonal") or "Draw — all nine boards are closed." No repeat on re-render | Result invisible to SR users, or announcement spam |
| A11Y-005 | High | UI [SPEC] | mid-game, `activeBoard` set | Inspect cells' accessible semantics outside the active board | Programmatically non-actionable (`aria-disabled` or excluded from the action set) **plus** a textual constraint statement ("Play in the top-right board") — not conveyed by highlight only | Constraint exists only as a visual style |
| A11Y-006 | High | UI [SPEC] | free-move state | Same inspection | All open-board cells actionable; text states "any open board"; closed boards exposed as closed with owner ("top-left board, won by X" / "…, full") | Closed/open distinction unavailable non-visually |
| A11Y-007 | High | UI [SPEC] | real board, keyboard only | Tab to board (one tab stop); arrows traverse the 9×9 grid; Enter/Space on a legal cell; Enter on an illegal cell | Roving tabindex per APG grid; focus ring visible (≥3:1, distinct from selection); legal activation places; illegal activation changes nothing (ATOM-003) | Keyboard players excluded, or focus lost after placement |
| A11Y-008 | Critical | UI [SPEC] | Playwright context with `reducedMotion: 'reduce'` (or CDP emulation) | **First**, inside the page assert `window.matchMedia('(prefers-reduced-motion: reduce)').matches === true` — the emulation has silently failed to apply on this project before; a run that skips this check proves nothing. Then play SEND-002 and S1 ply 5 | With the emulation *verified*: every state fact (active board, send destination, closed reason, win line) present via static styles/text; animations effectively off (computed durations ≤ 0.01s per ui-direction §5.3 R3, or `animateSafe` jump-to-final); nothing conveyed **only** by pulse/motion (C5) | Motion as sole information carrier — game unplayable under reduced motion; or the test config silently not applied (a pass that measured nothing) |
| A11Y-009 | High | UI [SPEC] | real board, mid-game | Grayscale screenshot (CSS filter or post-process) at: active-board state, one closed-won board each owner, one full board, free-move state | Every distinction legible without hue: player identity glyph-first (X/O), active board marked by weight/border/texture, closed boards by pattern/glyph — per the grayscale-screenshot gate | Hue-only encoding (colorblind + grayscale failure) |
| A11Y-010 | Medium | UI [SPEC] | several consecutive moves | Observe live region volume | One composed sentence per state change; no full-board readback per move (on request only) | Verbosity as its own accessibility failure (ux-lens §8) |

## Area ROUTE — route-level smoke (C17)

| ID | Sev | Lvl | Preconditions | Steps | Expected result | A failure would mean |
|---|---|---|---|---|---|---|
| ROUTE-001 | Critical | UI | `next dev` running | GET `/play/nine-grids`; open in browser | HTTP **200**; a rendered board (81 cell elements / `role="grid"` reachable); **zero** console errors; no failed chunk/network requests. *Today's placeholder should already pass this minimal form — if it 500s, that is the exact C17 class (a server-only import leaked into the game's browser graph) and blocks everything else.* | A shipped route 500ing while 1,321 tests are green — it has happened (Crackstep) |
| ROUTE-002 | Critical | UI | `next build && next start` (production) | Same request + click one legal cell | 200, interactive, mark renders. Production build catches bundler-resolution leaks dev mode can mask | Same class, production-only variant |
| ROUTE-003 | Medium | UI | home page | Library shows a Nine Grids card exactly once; card links to `/play/nine-grids`; rule sentence shown is the manifest's ("Where you play in a small board sends your opponent to that board.") | As stated | Registration drift between registry, manifest, and home |
| ROUTE-004 | Medium | ENG/CI | production build output | Route chunk for `/play/nine-grids` ≤ **75 kB gz** (hard CI gate); confirm `heuristic`/harness code is not in the route chunk | Within budget | The C17 quiet leak: barrel re-export defeating code-splitting |
| ROUTE-005 | High | UI [SPEC] | real board UI | Play the first 3 plies of SEND-003 by clicking | Marks render where clicked; active-board indication moves 5 → 1 → 6; turn indicator alternates | The UI↔engine seam mis-wired (cellId↔move mapping) even though both halves pass their own tests |

## Area SUITE — existing automated gates (preconditions for sign-off, not re-designed here)

| ID | Sev | Steps | Expected |
|---|---|---|---|
| SUITE-001 | Critical | `pnpm --filter @twist-arcade/nine-grids test` | Green: engine unit tests, `engineContract`, scenario suite (`ede4a99`), manifest rule-sentence length assert |
| SUITE-002 | Critical | Confirm the recorded CI gate run (do **not** re-run — two gate runs are active): strong-vs-random 100%, FPA 46% ∈ [35, 65], draw 30%, mean-plies 50.2 / 0 cap hits | As recorded. `ruthless-vs-standard 42% WARN` is the C19-postscript budget-collision artifact (mislabeled "C26" in the brief), **not** a defect — but it must be re-checked at the nightly full-budget table before ship |
| SUITE-003 | High | Mirror probe (`probes.ts`, `"symmetric"` tag) runs in CI | Present and green — C16's caveat: symmetry probes are load-bearing, never assume already-passed |

---

## Coverage summary

| Plan requirement (§2 stage 3) | Cases |
|---|---|
| Happy path | SEND-001..005, WIN-001/002, ROUTE-001/005, SUITE-* |
| Boundary (empty/zero/one/max/off-by-one) | SEND-001, BND-001..004, FREE-003, TERM-001/002, INV-005 |
| Invalid / malformed input | INV-001..008, DEC-001..008/011 |
| Auth/permission analog (wrong seat, out of turn) | TURN-001..007 |
| Concurrency / duplicate submission | TURN-005/006 (UI seam); engine is pure/synchronous by construction |
| Network/dependency failure | Not applicable at engine level (no I/O); ROUTE-001/002 covers the module-graph failure class; async-link server failures DEFERRED with TURN-007 to phase-2 |
| State after failure | ATOM-001..004, DEC-008 |
| Send rule (the twist) — exhaustive | Decision table rows 1–7 ↔ SEND-001..010, FREE-001..004, WIN-003, TERM-002/003 |
| Accessibility at the teaching plies | A11Y-001..010 (all [SPEC], all FAIL today by design) |
| Route smoke (C17) | ROUTE-001..005 |
| decode contract (C4) | DEC-001..012 |

## Risk assessment (execution priority)

1. **Send × closure interaction** (SEND-007/008/009, FREE-001) — the four-way boundary
   (won-earlier / full-earlier / closed-by-this-move / won-not-full's empty cells) is where
   every UTT implementation subtly diverges; three of the four differences are silent
   (no crash, just a wrong legal-move set).
2. **decode leniency** (DEC-*) — failure is invisible by definition (C4): a forged record
   validating produces no error anywhere.
3. **Atomicity** (ATOM-001/002) — a mutating `apply` corrupts MCTS rollouts and replays
   *while all unit tests pass*, because tests rarely re-read the input state.
4. **A11Y at the teaching plies** — this project has already shipped this exact failure
   (Fadeout); today's build fails all of Area A11Y by construction, so the risk is the
   *executor marking them pass* against the placeholder.
5. **Route smoke** — cheap, and the only coverage for the one defect class (C17) proven
   invisible to every other gate.

## Regression suite notes (stage-5 promotion)

Promote every Critical ENG case into `games/nine-grids/` permanent tests, minimally:
SEND-002/003/006/007/008/009, FREE-001, WIN-002/005, TERM-002/003, DEC-001..010,
TURN-001..004, ATOM-001/002. ROUTE-001 belongs in the C17 registry-loop CI step, not in
this game's suite. A11Y cases join the Playwright pass once the real board exists and the
verbatim strings are pinned.

## Ambiguities requiring an orchestrator ruling

- **A1 — dead-position draws (TERM-004).** When no macro line is achievable for either
  player but boards remain open, the engine (per its documented draw rule) plays on until
  all nine boards close. Both readings are defensible in the UTT community; the difference
  is pure UX (forced-draw games can drag for many plies — note the recorded mean-plies of
  50.2 already runs long against ux-lens §2.4's 10–40 band). This plan pins **play
  continues**; ruling requested because it is a product decision, not a bug.
- **A2 — "free move anywhere" scope (FREE-001).** Casual statements of the rule say "move
  anywhere"; a won-but-not-full board has empty cells. This plan pins **anywhere =
  any empty cell of any *open* board** (closed boards never accept marks), per the engine
  doc and game-theory-lens §1.10's "won/full boards are closed." Confirm the pin.
- **A3 — decode's semantic depth (DEC-011).** C4 says decode returns "a state satisfying
  the engine's own invariants" or throws. The engine checks shape + turn-parity +
  activeBoard-open, and explicitly leaves full reachability to `replay()`. A
  structurally-impossible double-line board passes those cheap checks (observed), and
  which player owns such a board is decided by internal line-scan order. Ruling: is
  cheap-invariants the intended C4 scope for this game (then document it and pin DEC-011's
  expected = decodes-with-defined-owner), or should a "no board contains lines for both
  players" check be added (then DEC-011 expected = throws)?

## Gaps — behavior not derivable from the documented rules

- **`activeBoard` in terminal states**: what `transition` sets it to on a game-ending move
  is undocumented. It has no gameplay effect (no legal moves either way) but affects
  encode round-trips of terminal states and what the end-screen shows. Observed terminal
  fixtures use `null`; not asserted anywhere.
- **`lastEffects` vocabulary**: the rules documents never enumerate which Effect kinds
  `transition` emits (board-won? board-closed? sent-to?). The announce/animation layer
  will hang off these; they need documenting before the UI pass or the [SPEC] A11Y cases
  cannot be wired.
- **Screen-reader semantics of the 9×9 flat grid**: `boardDimensions` reports 9×9, so the
  shell's grid semantics are flat; how the macro/micro structure is conveyed to SR users
  (row/col naming? group labels per micro board?) is unspecified in both ux-lens §8 and
  the game docs. Flagged for the UI plan.
- **Verbatim announce/share/how-sheet copy**: TODO placeholders; every A11Y expected
  result is a content contract awaiting verbatim pinning.

---

## Appendix A — move scripts (from `setup`; X = seat 0)

**S1 — win board 0, self-closing send (validated against the engine 2026-08-07):**

| Ply | Move | `activeBoard` after | Notes |
|---|---|---|---|
| 1 | X (0, 1) | 1 | opening free move |
| 2 | O (1, 0) | 0 | |
| 3 | X (0, 2) | 2 | |
| 4 | O (2, 0) | 0 | |
| 5 | X (0, 0) | **null** | wins board 0 (row 0-1-2) **and** targets board 0 → O free; O has 70 legal moves, none in board 0 |

**S1b — continue:** 6. O (5, 0) → X sent to closed board 0 → `activeBoard null`, X has 69
legal moves. **S1c:** 7. X (3, 4) → `activeBoard 4` (normal sending resumes).

**S3 — same-board send:** 1. X (3, 5) → O confined b5. 2. O (5, 5) → `activeBoard 5`: X
sent to the board O just played in. 3. X (5, 3) → `activeBoard 3` (ping-pong back).

## Appendix B — decode-built fixtures (all validated against the engine 2026-08-07)

Build states as `engine.decode(JSON.stringify({cells, activeBoard, toMove}))` — key order
irrelevant to `JSON.parse`. Assemble `cells` (length 81) by concatenating nine 9-cell
board patterns, board 0 first:

```ts
const N = null;
const A   = [0,1,0,0,1,1,1,0,0];      // full, drawn (no line either side)
const B   = [1,0,1,1,0,0,0,1,1];      // full, drawn (A with owners swapped)
const WX0 = [0,0,0,1,1,N,1,N,N];      // won by X (top row), 3 cells still empty
const WO0 = [1,1,1,0,0,N,0,N,N];      // won by O (top row)
const E   = [N,N,N,N,N,N,N,N,N];      // empty, open
const cells = (...boards) => boards.flat();
```

| Fixture | `cells` = | `activeBoard` | `toMove` | Validated behavior |
|---|---|---|---|---|
| **D1** | `cells(E,E,E,E,A,E,E,E,E)` | 0 | 1 | Decodes; ongoing; O has 9 legal. After O (0,4): `activeBoard null`, X has **71** legal, none in board 4 |
| **D3** | `cells(WX0,WO0,WX0,WX0,A,WO0,WO0,WX0,WX0)` | null | 1 | Decodes; status **draw**; 0 legal moves (X won 0,2,3,7,8; O won 1,5,6; board 4 drawn blocks X's 0-4-8 diagonal) |
| **D2a** | `cells(WX0,WO0,WX0,WX0,[0,1,0,0,1,1,1,0,N],WO0,WO0,WX0,WX0)` | 4 | 0 | Decodes; ongoing; X's only legal move is (4,8); playing it → **draw**, 0 legal |
| **D2b** | `cells(WX0,WO0,B,A,[0,N,1,N,0,1,1,N,N],WO0,A,WX0,WX0)` | 4 | 0 | Decodes; X (4,8) wins board 4 (0-4-8) **and** the game: `{kind:"won",winner:0}` — won beats draw on the final cell |
| **D4** | `cells(WX0,E,E,E,[0,N,1,N,0,1,N,N,N],E,E,E,WX0)` | 4 | 0 | Decodes; X (4,8) → board 4 won → macro 0-4-8 → `{kind:"won",winner:0}` with boards 1,2,3,5,6,7 fully open; both seats then have 0 legal moves |
| **REJ-won** | `cells(WX0,E,E,E,E,E,E,E,E)` | 0 | 0 | **Throws** NineGridsDecodeError: activeBoard must refer to a still-open board (`"won"`) |
| **REJ-full** | `cells(E,E,E,E,A,E,E,E,E)` | 4 | 1 | **Throws** (same, `"full"`) |
| **REJ-parity** | `cells([0,0,N,N,N,N,N,N,N],E,…,E)` | null | 0 | **Throws**: mark counts P0=2, P1=0 inconsistent with toMove=0 |
| **AMB-double** (DEC-011) | `cells([0,0,0,1,1,1,N,N,N],E,…,E)` | null | 0 | **Observed: decodes without error**; board 0 scored won-by-X by line-scan order — pending ruling A3 |

**WIN-006's fixture:** board 0 = X{0,2,4,7}, O{1,3,5,8} → `cells([0,1,0,1,0,1,N,0,1],
E,E,E,E,E,E,E,E)`, `activeBoard 0`, `toMove 0`. Board 0 is open (no line either side, one
empty cell); X plays (0, 6), completing line 2-4-6 on the same mark that fills the board —
validated: derived status `{kind:"won",winner:0}`, not `full`, and `activeBoard` becomes 6.

**D4m (WIN-007):** owner-swap of D4's patterns (`inv` maps 0↔1, null unchanged) with one
extra X at (1, 0) for parity: `cells(inv(WX0), [0,N,N,N,N,N,N,N,N], E, E, inv([0,N,1,N,0,1,N,N,N]),
E, E, E, inv(WX0))`, `activeBoard 4`, `toMove 1`. Note: a *pure* owner-swap of D4 is
decode-**rejected** (equal mark counts require `toMove: 0`) — itself a nice incidental
confirmation of DEC-006. Validated: O (4, 8) → `{kind:"won",winner:1}`.
