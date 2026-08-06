// schema-drift.test.ts — A0's whole point (docs/plans/phase-2-async-multiplayer.md §12.1;
// ruling C21 in docs/plans/platform-corrections.md).
//
// The async-multiplayer schema was applied to the remote Supabase project via MCP and never
// checked in. Checking in migrations 0001/0002 fixes that only if something keeps them
// honest going forward — a file that *claims* to describe the database is worse than no
// file if nothing verifies the claim. This test is that something.
//
// Design: apply every migration in supabase/migrations, in filename order, to a real
// (WASM, in-process, no Docker) Postgres via pglite, then run the exact same introspection
// query (introspect-schema.sql) used to capture test/fixtures/live-schema-snapshot.json
// from the actual live remote database. The two must match byte-for-byte. If a migration
// file is edited without the live database being changed to match (or vice versa), this
// goes red — that is the guard.
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
const introspectSql = readFileSync(path.join(here, "introspect-schema.sql"), "utf8");
const fixture = JSON.parse(
  readFileSync(path.join(here, "fixtures", "live-schema-snapshot.json"), "utf8")
) as unknown;

async function buildDatabase(): Promise<PGlite> {
  const db = new PGlite();

  // Structural stub only: real Supabase auth.users has dozens of columns this schema never
  // touches. match_players.user_id's FK needs a referenceable auth.users(id); nothing here
  // asserts anything about auth.users itself.
  await db.exec(`create schema auth; create table auth.users (id uuid primary key);`);

  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  expect(migrationFiles, "expected the checked-in migrations to be present").toEqual([
    "0001_async_multiplayer.sql",
    "0002_async_multiplayer_amendments.sql",
  ]);

  for (const file of migrationFiles) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    await db.exec(sql);
  }

  return db;
}

describe("checked-in migrations vs. the live database (C21)", () => {
  it("reproduce exactly the schema snapshot captured from the remote Supabase project", async () => {
    const db = await buildDatabase();
    const result = await db.query<{ schema_snapshot: unknown }>(introspectSql);
    const snapshot = result.rows[0]?.schema_snapshot;

    expect(snapshot).toEqual(fixture);

    await db.close();
  });

  it("keeps RLS deny-all: enabled on all three tables, zero policies (plan §5, C21)", async () => {
    const db = await buildDatabase();
    const result = await db.query<{ schema_snapshot: { rls: { rls_enabled: boolean }[]; policy_count: number } }>(
      introspectSql
    );
    const snapshot = result.rows[0]?.schema_snapshot;
    expect(snapshot?.rls.every((t) => t.rls_enabled)).toBe(true);
    expect(snapshot?.policy_count).toBe(0);

    await db.close();
  });
});
