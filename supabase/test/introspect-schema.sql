-- introspect-schema.sql
--
-- Canonical introspection query for the async-multiplayer tables (matches, match_players,
-- moves). Used verbatim in two places, so both sides of the drift check speak the same
-- language:
--
--   1. By the A0 implementer against the LIVE remote database, to freeze
--      test/fixtures/live-schema-snapshot.json.
--   2. By schema-drift.test.ts against a pglite instance with 0001+0002 applied.
--
-- If this file ever changes, the fixture must be regenerated from the live database again
-- (re-run this query via the Supabase MCP execute_sql tool against the remote project) —
-- never hand-edited to make a failing comparison pass.
--
-- `contype <> 'n'` in the constraints CTE excludes catalogued NOT NULL pseudo-constraints:
-- pglite (this repo's local test runtime) catalogues every `not null` column as its own
-- pg_constraint row; the hosted remote (also Postgres 17.6, confirmed via `select
-- version()`) does not. That is a difference in constraint-cataloguing behaviour between
-- the two Postgres builds, not a schema drift — and NOT NULL-ness is already captured
-- losslessly by `columns.is_nullable` above, so excluding it here removes environment noise
-- without weakening the check.
select json_build_object(
  'columns', (
    select coalesce(json_agg(row_to_json(c) order by c.table_name, c.ordinal_position), '[]'::json)
    from (
      select table_name, column_name, ordinal_position, column_default, is_nullable, data_type, udt_name
      from information_schema.columns
      where table_schema = 'public' and table_name in ('matches', 'match_players', 'moves')
    ) c
  ),
  'constraints', (
    select coalesce(json_agg(row_to_json(k) order by k.table_name, k.conname), '[]'::json)
    from (
      select conrelid::regclass::text as table_name, conname, contype, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid in ('public.matches'::regclass, 'public.match_players'::regclass, 'public.moves'::regclass)
        and contype <> 'n'
    ) k
  ),
  'indexes', (
    select coalesce(json_agg(row_to_json(i) order by i.tablename, i.indexname), '[]'::json)
    from (
      select tablename, indexname, indexdef
      from pg_indexes
      where schemaname = 'public' and tablename in ('matches', 'match_players', 'moves')
    ) i
  ),
  'rls', (
    select coalesce(json_agg(row_to_json(r) order by r.table_name), '[]'::json)
    from (
      select relname as table_name, relrowsecurity as rls_enabled
      from pg_class
      where relname in ('matches', 'match_players', 'moves') and relnamespace = 'public'::regnamespace
    ) r
  ),
  'policy_count', (
    select count(*)::int
    from pg_policies
    where schemaname = 'public' and tablename in ('matches', 'match_players', 'moves')
  ),
  'table_comments', (
    select coalesce(json_agg(row_to_json(tc) order by tc.table_name), '[]'::json)
    from (
      select c.relname as table_name, obj_description(c.oid) as comment
      from pg_class c
      where c.relname in ('matches', 'match_players', 'moves') and c.relnamespace = 'public'::regnamespace
    ) tc
  )
) as schema_snapshot;
