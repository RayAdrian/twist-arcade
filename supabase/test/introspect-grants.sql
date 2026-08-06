-- introspect-grants.sql
--
-- Table-level GRANT introspection for the `public` schema. Used against TWO different
-- Postgres instances, compared against TWO different fixtures — because the two contexts
-- have different sources of truth, and conflating them into one comparison would either
-- always mismatch (the remote's platform-granted privileges vs. a pglite instance that has
-- none of that bootstrap) or prove nothing (comparing an empty result to another empty
-- result).
--
-- 1. Against pglite, with `anon`/`authenticated`/`service_role` roles seeded and the
--    checked-in migrations replayed (schema-drift.test.ts), compared to
--    fixtures/migration-grants-snapshot.json. THIS VERIFIES: the migrations themselves
--    never issue a GRANT — today that means anon/authenticated/service_role end up with
--    zero privileges on these tables, only `postgres`-the-owner does (Postgres's implicit
--    owner grants, not anything our DDL states explicitly). If a migration ever adds
--    `grant select on matches to public` (the exact stage-6-review mutant), this diverges
--    from the frozen fixture and the CI-local test goes red — no live connection required.
--    THIS DOES NOT VERIFY: what the real remote's roles actually have. Supabase applies its
--    own default-privilege bootstrap for anon/authenticated/service_role at the platform
--    level, entirely outside any migration in this repo — pglite has no such bootstrap and
--    cannot reproduce it, seeded roles or not. A local pass proves "the migrations don't
--    grant anything they shouldn't," not "the live database's privileges match some
--    expectation."
--
-- 2. Against a real Postgres connection to the remote (scripts/verify-remote-schema.ts),
--    compared to fixtures/live-grants-snapshot.json. THIS VERIFIES: the actual live
--    privilege configuration, platform bootstrap included — the only channel that can see
--    it, and the only place a mismatch here means "the live remote actually changed."
select coalesce(json_agg(row_to_json(g) order by g.table_name, g.grantee, g.privilege_type), '[]'::json) as grants
from (
  select table_name, grantee, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public'
) g;
