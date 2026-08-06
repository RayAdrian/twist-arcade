// schema-drift.test.ts — A0's whole point (docs/plans/phase-2-async-multiplayer.md §12.1;
// ruling C21 in docs/plans/platform-corrections.md).
//
// The async-multiplayer schema was applied to the remote Supabase project via MCP and never
// checked in. Checking in the migrations fixes that only if something keeps them honest
// going forward — a file that *claims* to describe the database is worse than no file if
// nothing verifies the claim. This test is that something, but read its guarantee
// precisely (stage-6 review, C21 addendum "corrected", Finding 2 — the previous header
// overclaimed this):
//
//   THIS TEST PROVES: the checked-in migrations, replayed from scratch, reproduce the
//   schema snapshot in fixtures/live-schema-snapshot.json — a snapshot of the real remote
//   database as of the date it was last captured. It also proves the migrations never
//   themselves grant a privilege they shouldn't (fixtures/migration-grants-snapshot.json,
//   see below).
//
//   THIS TEST DOES NOT PROVE: that the fixtures still match the remote *right now*. It
//   never contacts the remote — nothing in `npm test` / CI does, by design (CLAUDE.md §5:
//   local dev and CI never point at the remote). A change applied directly to the remote
//   (e.g. via MCP) that never touches a checked-in migration is invisible to this test, by
//   construction, forever. That is a real, standing gap, not a bug in this file — closing
//   it needs a tool that actually opens a connection to the remote, which is what
//   supabase/scripts/verify-remote-schema.ts is for. Run it (`npm run
//   supabase:verify-remote`) whenever you need to know the live answer, and especially
//   before trusting a fixture regeneration — `--write` is the ONLY sanctioned way to
//   update the fixtures, because it is the only path that ever reads the real remote.
//   Regenerating a fixture from this test's own pglite output would make the whole thing
//   tautological (the M1 lesson: a golden vector computed from the implementation proves
//   nothing).
//
//   It also does not prove the remote's ACTUAL privilege configuration matches anything —
//   see the grants section below and introspect-grants.sql's header for exactly what the
//   local grants check does and doesn't cover, and what's still remote-only.
//
// Design: apply every migration in supabase/migrations, in filename order, to a real
// (WASM, in-process, no Docker) Postgres via pglite, then run the exact same introspection
// query (introspect-schema.sql) used to capture the fixture. The introspection is
// schema-wide (`table_schema = 'public'`, no per-table name filter) — a narrower, named
// whitelist was the stage-6 review's Finding 1: a new table, a new function, and a changed
// column comment all passed green under it, because none of the three were ever compared.
//
// GRANTs are checked separately (introspect-grants.sql), against a fixture of what the
// MIGRATIONS' own grant surface should be (fixtures/migration-grants-snapshot.json), not
// against the remote's fixture — the orchestrator caught that this can run locally too: the
// `anon`/`authenticated`/`service_role` roles are ordinary Postgres roles with no
// Supabase-specific bootstrap needed to create them, so they're seeded below before the
// migrations run. That closed the fourth stage-6-review blind mutant (`grant select on
// matches to public`) as a local, CI-catchable check instead of a remote-only one.
//
// auth.users is stubbed to the one column match_players' FK needs (id). This is a
// deliberate simplification of Supabase's real auth schema for structural testing only —
// see the comment at its creation below.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");
const introspectSchemaSql = readFileSync(path.join(here, "introspect-schema.sql"), "utf8");
const introspectGrantsSql = readFileSync(path.join(here, "introspect-grants.sql"), "utf8");
const schemaFixture = JSON.parse(
  readFileSync(path.join(here, "fixtures", "live-schema-snapshot.json"), "utf8")
) as unknown;
const grantsFixture = JSON.parse(
  readFileSync(path.join(here, "fixtures", "migration-grants-snapshot.json"), "utf8")
) as unknown;

const EXPECTED_MIGRATIONS = [
  "0001_async_multiplayer.sql",
  "0002_async_multiplayer_amendments.sql",
  "0003_match_players_user_fk_restrict.sql",
];

async function buildDatabase(): Promise<PGlite> {
  const db = new PGlite();

  // Structural stub only: real Supabase auth.users has dozens of columns this schema never
  // touches. match_players.user_id's FK needs a referenceable auth.users(id); nothing here
  // asserts anything about auth.users itself.
  await db.exec(`create schema auth; create table auth.users (id uuid primary key);`);

  // Seed the three Supabase Data API roles BEFORE the migrations run, so a migration that
  // ever granted one of them a privilege would show up in the grants introspection below.
  // These are ordinary Postgres roles — nothing Supabase-specific is required to create
  // them, which is exactly why the grants check does not have to be remote-only.
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;`);

  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  expect(migrationFiles, "expected the checked-in migrations to be present").toEqual(EXPECTED_MIGRATIONS);

  for (const file of migrationFiles) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    await db.exec(sql);
  }

  return db;
}

interface SchemaSnapshot {
  tables: string[];
  rls: { table_name: string; rls_enabled: boolean }[];
  policy_count: number;
  functions: unknown[];
}

describe("checked-in migrations vs. the snapshotted remote (C21)", () => {
  it("reproduce exactly the schema snapshot captured from the remote Supabase project", async () => {
    const db = await buildDatabase();
    const result = await db.query<{ schema_snapshot: unknown }>(introspectSchemaSql);
    const snapshot = result.rows[0]?.schema_snapshot;

    expect(snapshot).toEqual(schemaFixture);

    await db.close();
  });

  it("keeps RLS deny-all: enabled on all three tables, zero policies (plan §5, C21)", async () => {
    const db = await buildDatabase();
    const result = await db.query<{ schema_snapshot: SchemaSnapshot }>(introspectSchemaSql);
    const snapshot = result.rows[0]?.schema_snapshot;
    expect(snapshot?.rls.every((t) => t.rls_enabled)).toBe(true);
    expect(snapshot?.policy_count).toBe(0);

    await db.close();
  });

  it("limits the public schema to exactly the three async-multiplayer tables, with no functions yet (Finding 1)", async () => {
    // Named separately from the whole-snapshot equality above so a failure here reads as
    // "an unexpected object appeared in public" rather than an opaque deep-diff. A1's
    // commit_move() is expected to change `functions` from [] to a one-entry array — when
    // that happens, this assertion (and the fixture) update together, deliberately, not by
    // surprise.
    const db = await buildDatabase();
    const result = await db.query<{ schema_snapshot: SchemaSnapshot }>(introspectSchemaSql);
    const snapshot = result.rows[0]?.schema_snapshot;
    expect(snapshot?.tables).toEqual(["match_players", "matches", "moves"]);
    expect(snapshot?.functions).toEqual([]);

    await db.close();
  });

  it("grants no privilege to anon/authenticated/service_role from the migrations themselves (Finding 1, orchestrator follow-up)", async () => {
    // Only `postgres`-the-owner should have anything — Postgres's implicit owner grants,
    // not a statement any migration here issues. If a migration ever adds `grant select on
    // matches to public` (the exact stage-6-review mutant), this diverges from the frozen
    // fixture and fails here, without needing a live connection to the remote — see
    // introspect-grants.sql's header for what this does and does not prove.
    const db = await buildDatabase();
    const result = await db.query<{ grants: unknown }>(introspectGrantsSql);
    const grants = { grants: result.rows[0]?.grants };

    expect(grants).toEqual(grantsFixture);

    await db.close();
  });
});
