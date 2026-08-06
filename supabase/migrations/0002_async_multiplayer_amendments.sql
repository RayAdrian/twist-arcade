-- 0002_async_multiplayer_amendments.sql
--
-- A0 (docs/plans/phase-2-async-multiplayer.md §12.2, §4), amendments as corrected by
-- ruling C21 (docs/plans/platform-corrections.md). All three tables are empty (verified
-- immediately before this migration was applied remotely — see docs/reports/
-- phase2-a0-schema.md §2), so every change here is a plain ALTER with zero
-- data-migration risk.
--
-- §4.1 — matches.engine_version (int) conflated ReplayRecord's gameVersion: number and
-- engineVersion: string (packages/engine/src/replay.ts). Split into the two columns the
-- replay format actually needs.
alter table public.matches drop column engine_version;
alter table public.matches add column game_version integer not null;
alter table public.matches add column engine_version text not null;

-- §4.3 — the URL names a series; rounds are matches sharing a join_code. join_code alone is
-- no longer unique; (join_code, round) is.
alter table public.matches add column round integer not null default 1;
alter table public.matches drop constraint matches_join_code_key;
alter table public.matches add constraint matches_join_code_round_key unique (join_code, round);

-- §4.4 — lifecycle: status gains 'expired' (lazy-evaluated at read time) and 'void'
-- (quarantine, §4.2/§11). expires_at is set by the application at creation/on each
-- committed move; no default here because the value is always a caller-supplied policy
-- decision (+7d while open with one player, refreshed to +30d on every committed move —
-- plan §4.4), never a schema-derived one.
alter table public.matches drop constraint matches_status_check;
alter table public.matches add constraint matches_status_check
  check (status = any (array['open'::text, 'ongoing'::text, 'finished'::text, 'expired'::text, 'void'::text]));
alter table public.matches add column expires_at timestamptz not null;

-- §4.6 — the compare-and-set token for §8.3's commit_move primitive and the poll comparator.
alter table public.matches add column step_count integer not null default 0;

-- §4.5 — match_players.display_name, nullable (cuttable per §14; feeds ux-lens's
-- "playing as Guest ✎").
alter table public.match_players add column display_name text;

-- C21 overrules plan §4.5: the moves primary key drops `seat`. §4.2 makes the move log the
-- record of truth, and a PK of (match_id, idx, seat) permits two rows for the same idx (one
-- per seat) — exactly the state plan §4.5's prose ("Phase 2 writes only one row per idx")
-- asserted could not happen. A comment or a CAS in application code does not enforce that;
-- the primary key does. `seat` stays as a plain not-null column — the data is unchanged,
-- only which columns identify a row.
alter table public.moves drop constraint moves_pkey;
alter table public.moves add constraint moves_pkey primary key (match_id, idx);

-- moves_match_idx (match_id, idx) is now a byte-for-byte duplicate of the new PK's own
-- backing index; dropping it removes dead weight the PK change introduced rather than
-- expanding scope.
drop index public.moves_match_idx;
