-- 0001_async_multiplayer.sql
--
-- A0 (docs/plans/phase-2-async-multiplayer.md §12.1; ruling C21 in
-- docs/plans/platform-corrections.md): faithful record of the async-multiplayer schema as it
-- exists on the remote Supabase project (fjiwrzaosluymamannaw), applied there directly via
-- MCP as migration `phase2_async_match_schema_deny_all` (remote version 20260803094200) and
-- never previously checked into version control.
--
-- Generated from the live database on 2026-08-07 via `list_tables` (verbose) and
-- `execute_sql` against information_schema.columns, pg_constraint, pg_indexes, pg_policies,
-- and pg_class — not reconstructed from the plan or from memory. This file is a snapshot of
-- what is true, not a corrected version: amendments (game_version/engine_version split,
-- round, step_count, expires_at, expanded status, moves PK) land in
-- 0002_async_multiplayer_amendments.sql, which is a separate, reviewable diff.
--
-- All three tables: RLS enabled, zero policies (deny-all, the Phase 2 end-state per plan §5
-- and C21), zero rows at the time of this snapshot.

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  game_id text not null,
  engine_version integer not null,
  seed text not null,
  state jsonb not null,
  status text not null default 'open',
  active_seats integer[] not null default '{}'::integer[],
  join_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matches_status_check
    check (status = any (array['open'::text, 'ongoing'::text, 'finished'::text])),
  constraint matches_join_code_key unique (join_code)
);

comment on table public.matches is
  'Async multiplayer matches. RLS deny-all until Phase 2 writes policies. state and seed are server-only — clients receive playerView(state, seat), never this row.';

-- Redundant with the unique index backing matches_join_code_key above, but faithfully
-- reproduced because it exists on the live database.
create index matches_join_code_idx on public.matches using btree (join_code);
create index matches_updated_at_idx on public.matches using btree (updated_at);

alter table public.matches enable row level security;

create table public.match_players (
  match_id uuid not null references public.matches (id) on delete cascade,
  seat integer not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (match_id, seat),
  constraint match_players_match_id_user_id_key unique (match_id, user_id)
);

comment on table public.match_players is
  'Seat-to-user mapping, anonymous users included. RLS deny-all until Phase 2.';

alter table public.match_players enable row level security;

create table public.moves (
  match_id uuid not null references public.matches (id) on delete cascade,
  idx integer not null,
  seat integer not null,
  move jsonb not null,
  created_at timestamptz not null default now(),
  primary key (match_id, idx, seat)
);

comment on table public.moves is
  'Per-ply move log; the leaderboard verifier replays this through the pure engine. RLS deny-all until Phase 2.';

create index moves_match_idx on public.moves using btree (match_id, idx);

alter table public.moves enable row level security;
