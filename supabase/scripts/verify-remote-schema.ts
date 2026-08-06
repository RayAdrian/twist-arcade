// verify-remote-schema.ts — the honest path for touching the checked-in fixtures.
//
// Stage-6 review, Finding 2 (docs/plans/platform-corrections.md, "C21 addendum,
// corrected"): schema-drift.test.ts compares migrations replayed in pglite against a
// FROZEN fixture. That proves the migration files are internally consistent with each
// other. It proves nothing about whether the fixture still matches the actual remote
// database — nothing in CI ever contacts the remote. The exact original sin A0 exists to
// fix (apply a change to the remote via MCP, never check it in) still passes the CI test
// green, indefinitely, because CI is structurally incapable of seeing it.
//
// This script is the other half. It is the ONLY sanctioned way to:
//   --check  compare the live remote (via a direct Postgres connection) against the
//            checked-in fixtures and exit non-zero on any mismatch (both the structural
//            snapshot AND the grants snapshot — see introspect-grants.sql for why grants
//            are remote-only).
//   --write  overwrite the checked-in fixtures with what the remote actually has. This is
//            the ONLY sanctioned way to regenerate them. Regenerating from pglite's own
//            output instead would make schema-drift.test.ts tautological — the migrations
//            would only ever be compared against themselves, which is the M1 lesson
//            (golden vectors computed from the implementation prove nothing) in a new
//            place.
//
// Requires SUPABASE_DB_URL — a direct Postgres connection string (not the anon/service-role
// API keys; those go through PostgREST, which cannot run information_schema/pg_catalog
// queries). Fails closed: no URL, no run, no silent no-op fixture "verification" that
// never actually connected to anything.
//
// This is deliberately NOT wired into `npm test` / CI. Local dev and CI never point at the
// remote (CLAUDE.md §5) — this is an operator tool, run by whoever is making or reviewing a
// schema change, exactly the way `supabase db diff --linked` would be if this project's
// CLI session were authenticated (it is not, in every environment this has been run from
// so far — see docs/reports/phase2-a0-schema.md §5 for how this was instead validated
// against a real Postgres-wire-protocol server with no live-remote credentials in play).
import { Client } from "pg";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(here, "..", "test");
const fixturesDir = path.join(testDir, "fixtures");

const schemaSql = readFileSync(path.join(testDir, "introspect-schema.sql"), "utf8");
const grantsSql = readFileSync(path.join(testDir, "introspect-grants.sql"), "utf8");
const schemaFixturePath = path.join(fixturesDir, "live-schema-snapshot.json");
const grantsFixturePath = path.join(fixturesDir, "live-grants-snapshot.json");

function fail(message: string): never {
  console.error(`verify-remote-schema: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--write") ? "write" : "check";
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    fail(
      "SUPABASE_DB_URL is not set. This script talks to a real Postgres connection, not " +
        "the app's anon/service-role API keys — see .env.example. Refusing to run rather " +
        "than silently no-op."
    );
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  let schemaSnapshot: unknown;
  let grantsSnapshot: unknown;
  try {
    const schemaResult = await client.query<{ schema_snapshot: unknown }>(schemaSql);
    schemaSnapshot = schemaResult.rows[0]?.schema_snapshot;
    const grantsResult = await client.query<{ grants: unknown }>(grantsSql);
    grantsSnapshot = { grants: grantsResult.rows[0]?.grants };
  } finally {
    await client.end();
  }

  if (mode === "write") {
    writeFileSync(schemaFixturePath, `${JSON.stringify(schemaSnapshot, null, 2)}\n`);
    writeFileSync(grantsFixturePath, `${JSON.stringify(grantsSnapshot, null, 2)}\n`);
      console.log("verify-remote-schema: fixtures regenerated from the live remote.");
    return;
  }

  const schemaFixture = JSON.parse(readFileSync(schemaFixturePath, "utf8")) as unknown;
  const grantsFixture = JSON.parse(readFileSync(grantsFixturePath, "utf8")) as unknown;

  const schemaMatches = JSON.stringify(schemaSnapshot) === JSON.stringify(schemaFixture);
  const grantsMatches = JSON.stringify(grantsSnapshot) === JSON.stringify(grantsFixture);

  if (schemaMatches && grantsMatches) {
      console.log("verify-remote-schema: the live remote matches the checked-in fixtures.");
    return;
  }

  if (!schemaMatches) {
      console.error("verify-remote-schema: STRUCTURAL DRIFT — live remote != live-schema-snapshot.json");
      console.error("  live:    " + JSON.stringify(schemaSnapshot));
      console.error("  fixture: " + JSON.stringify(schemaFixture));
  }
  if (!grantsMatches) {
      console.error("verify-remote-schema: GRANT DRIFT — live remote != live-grants-snapshot.json");
      console.error("  live:    " + JSON.stringify(grantsSnapshot));
      console.error("  fixture: " + JSON.stringify(grantsFixture));
  }
  process.exit(1);
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
