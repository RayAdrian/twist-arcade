-- introspect-schema.sql
--
-- Canonical introspection query for the ENTIRE `public` schema. Used verbatim in three
-- places, so all sides of the drift check speak the same language:
--
--   1. By the implementer against the LIVE remote database, to freeze
--      test/fixtures/live-schema-snapshot.json.
--   2. By schema-drift.test.ts against a pglite instance with every migration applied.
--   3. By scripts/verify-remote-schema.ts, which runs it against a real Postgres
--      connection (SUPABASE_DB_URL) — the only channel that can catch a change applied
--      directly to the remote (e.g. via MCP) that never touched a checked-in migration.
--
-- If this file ever changes, the fixture must be regenerated from the live database again
-- (`tsx supabase/scripts/verify-remote-schema.ts --write` against the real remote) — never
-- hand-edited, and never regenerated from pglite's own output (that would make the check
-- tautological: the migrations would only ever be compared against themselves).
--
-- Schema-wide, deliberately (stage-6 review, C21 addendum "corrected" — a whitelist of
-- three table names left a new table, a new function, a grant, and a changed column
-- comment all invisible; all four executed green). `table_schema = 'public'` /
-- `pronamespace = 'public'::regnamespace` is the only scope — no per-object name filter
-- anywhere below. A1's commit_move() (and anything else that ever lands in `public`) is
-- covered the moment it exists, not opted into by name.
--
-- `contype <> 'n'` in the constraints CTE excludes catalogued NOT NULL pseudo-constraints:
-- pglite (this repo's local test runtime) catalogues every `not null` column as its own
-- pg_constraint row; the hosted remote (also Postgres 17.6, confirmed via `select
-- version()`) does not. That is a difference in constraint-cataloguing behaviour between
-- the two Postgres builds, not a schema drift — and NOT NULL-ness is already captured
-- losslessly by `columns.is_nullable` above, so excluding it here removes environment noise
-- without weakening the check.
select json_build_object(
  'tables', (
    select coalesce(json_agg(table_name order by table_name), '[]'::json)
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  ),
  'columns', (
    select coalesce(json_agg(row_to_json(c) order by c.table_name, c.ordinal_position), '[]'::json)
    from (
      select table_name, column_name, ordinal_position, column_default, is_nullable, data_type, udt_name
      from information_schema.columns
      where table_schema = 'public'
    ) c
  ),
  'constraints', (
    select coalesce(json_agg(row_to_json(k) order by k.table_name, k.conname), '[]'::json)
    from (
      select conrelid::regclass::text as table_name, conname, contype, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where connamespace = 'public'::regnamespace
        and contype <> 'n'
    ) k
  ),
  'indexes', (
    select coalesce(json_agg(row_to_json(i) order by i.tablename, i.indexname), '[]'::json)
    from (
      select tablename, indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
    ) i
  ),
  'rls', (
    select coalesce(json_agg(row_to_json(r) order by r.table_name), '[]'::json)
    from (
      select relname as table_name, relrowsecurity as rls_enabled
      from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r'
    ) r
  ),
  'policy_count', (
    select count(*)::int
    from pg_policies
    where schemaname = 'public'
  ),
  'table_comments', (
    select coalesce(json_agg(row_to_json(tc) order by tc.table_name), '[]'::json)
    from (
      select c.relname as table_name, obj_description(c.oid) as comment
      from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    ) tc
  ),
  'column_comments', (
    select coalesce(json_agg(row_to_json(cc) order by cc.table_name, cc.column_name), '[]'::json)
    from (
      select c.relname as table_name, a.attname as column_name, col_description(c.oid, a.attnum) as comment
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'public'::regnamespace
        and c.relkind = 'r'
        and a.attnum > 0
        and not a.attisdropped
        and col_description(c.oid, a.attnum) is not null
    ) cc
  ),
  'functions', (
    select coalesce(json_agg(row_to_json(f) order by f.proname, f.arguments), '[]'::json)
    from (
      select
        p.proname,
        pg_get_function_identity_arguments(p.oid) as arguments,
        pg_get_functiondef(p.oid) as definition
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace
    ) f
  )
) as schema_snapshot;
-- NOTE: table-level GRANTs are NOT part of this snapshot — they're covered by the separate
-- introspect-grants.sql, checked against TWO different fixtures in TWO different contexts.
-- They aren't folded in here because the correct expected answer differs by context (the
-- migrations' own grant surface locally vs. the live platform-configured grants remotely);
-- one shared `schema_snapshot` object can only hold one expected answer. See
-- introspect-grants.sql's header for what each comparison does and does not prove — in
-- particular, `anon`/`authenticated`/`service_role` CAN be seeded into pglite (they're
-- ordinary roles; no Supabase-specific bootstrap required to create them), so the grant
-- check is not remote-only. It runs locally in schema-drift.test.ts too.
