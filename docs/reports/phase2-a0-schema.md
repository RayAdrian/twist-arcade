# A0 report — schema home + amendments (`docs/plans/phase-2-async-multiplayer.md` §12.1–.2)

*Sonnet implementer, `feature/phase2-schema`. Covers the original A0 pass, the stage-6
review fix-up pass (`docs/plans/platform-corrections.md`, "C21 addendum, corrected"), and an
orchestrator follow-up that closed the grants check as a local, CI-catchable check instead
of a remote-only one (§4.4, §5 below).*

---

## 1. What's checked in

- `supabase/migrations/0001_async_multiplayer.sql` — faithful record of the schema as
  originally applied to the remote via MCP, generated from live introspection.
- `supabase/migrations/0002_async_multiplayer_amendments.sql` — plan §4 amendments as
  corrected by C21 (`game_version`/`engine_version` split, `(join_code, round)`,
  `step_count`, `display_name`, expanded `status`, `expires_at`, and the C21 PK overrule —
  `moves` PK drops `seat`).
- `supabase/migrations/0003_match_players_user_fk_restrict.sql` — stage-6 review escalation:
  `match_players.user_id` FK changes `on delete cascade` → `on delete restrict`.
- `supabase/test/introspect-schema.sql` — schema-wide (no per-table whitelist) structural
  introspection: tables, columns, constraints, indexes, RLS, policy count, table comments,
  column comments, functions.
- `supabase/test/introspect-grants.sql` — GRANT introspection, run against TWO different
  Postgres instances with TWO different expected answers (see its header): locally against
  pglite with `anon`/`authenticated`/`service_role` seeded (proves the migrations' own
  grant surface — they should grant nothing), and remotely against the real database (proves
  the live platform-configured privileges match what was last captured). `anon` et al. are
  ordinary Postgres roles — no Supabase-specific bootstrap is needed to create them, so this
  does not have to be remote-only, and isn't.
- `supabase/test/fixtures/live-schema-snapshot.json`, `live-grants-snapshot.json` — frozen
  from the live remote, not from pglite's own output. `migration-grants-snapshot.json` —
  what the migrations' own grant surface should look like (currently: `postgres`-the-owner
  only, nothing granted to the Data API roles), checked locally.
- `supabase/test/schema-drift.test.ts` — applies every checked-in migration (with the three
  Data API roles pre-seeded) to pglite, compares against the structural AND
  migration-grants fixtures. Runs in `npm test` (registered in `vitest.workspace.ts`).
- `supabase/scripts/verify-remote-schema.ts` — the remote-facing counterpart. `--check`
  compares a live Postgres connection (`SUPABASE_DB_URL`) against both fixtures; `--write`
  regenerates them. The only sanctioned way to touch the fixtures.

## 2. Emptiness verification before every apply

All three tables were confirmed at 0 rows immediately before each `apply_migration` call:

| Before | matches | match_players | moves |
|---|---|---|---|
| 0002 | 0 | 0 | 0 |
| 0003 | 0 | 0 | 0 |

(0001 was not "applied" by this work — it is a record of what MCP had already applied
earlier.)

## 3. Canary re-verification (plan §12.2's standing rule)

Re-run specifically for 0002's new `matches` columns (`game_version`, `engine_version`,
`round`, `expires_at`, `step_count`) — the original pre-C21 canary check (recorded in
`platform-corrections.md`'s "Remote Supabase — prepped" section) predates these columns.

1. Inserted a canary row into `matches`:
   `seed = 'SECRET-SEED-DO-NOT-LEAK-A0'`, `state = {"canary":"SECRET-STATE-DO-NOT-LEAK-A0"}`,
   `join_code = 'CANARY0000A0'`, plus the new columns (`game_version=1`,
   `engine_version='0.1.0-canary'`, `step_count=3`, `expires_at=now()+7d`).
2. Probed via PostgREST with the `anon` key:
   - `select=*` → `[]`
   - `select=seed,state,game_version,engine_version,round,expires_at,step_count` → `[]`
   - `PATCH .../matches?join_code=eq.CANARY0000A0` → `HTTP 200`, body `[]` (0 rows matched —
     confirmed via service-role read afterward: `step_count` still `3`, unmodified)
   - `DELETE .../matches?join_code=eq.CANARY0000A0` → `HTTP 200`, body `[]` (row still
     present afterward, confirmed via service-role read)
   - `POST .../matches` (insert attempt) → `HTTP 401`-class RLS refusal:
     `{"code":"42501","message":"new row violates row-level security policy for table \"matches\""}`
3. Deleted the canary row via service-role SQL; re-confirmed all three tables back to 0 rows.

Scope note: this canary pass covered `matches` only, where the new NOT NULL,
sensitive-shaped columns landed. `match_players.display_name` is a non-secret column with no
new leak surface, and match_players' RLS posture (enabled, zero policies) is re-confirmed
structurally by `schema-drift.test.ts`'s own RLS assertion on every run — a live-row probe
of `match_players` specifically was not performed this pass (would require a real
`auth.users` row, which this pass chose not to fabricate given the low marginal value for a
non-secret column).

## 4. The four blind mutants (stage-6 review), re-fired against the fixed guard

Each planted directly in `schema-drift.test.ts`'s `buildDatabase()`, confirmed applied via
`grep`, run, output captured, then reverted and confirmed clean.

**1. New table** (`create table public.evil (id int);`):
```
FAIL > keeps RLS deny-all...
  expected false to be true  // evil has rls_enabled: false
FAIL > limits the public schema to exactly the three async-multiplayer tables...
  expected [ 'evil', 'match_players', 'matches', 'moves' ] to deeply equal
  [ 'match_players', 'matches', 'moves' ]
```

**2. New function** (`create function public.evil_fn() returns int language sql as $$ select 1 $$;`):
```
FAIL > reproduce exactly the schema snapshot...
FAIL > limits the public schema to exactly the three async-multiplayer tables...
  expected [ { proname: 'evil_fn', ... } ] to deeply equal []
```

**3. Changed column comment** (`comment on column public.matches.seed is 'hacked';`):
```
FAIL > reproduce exactly the schema snapshot...
  + { "column_name": "seed", "comment": "hacked", "table_name": "matches" }
```

**4. Grant** (`grant select on public.matches to public;`) — first closed the same way as
finding 2 (proven against `@electric-sql/pglite-socket` as a stand-in remote, since this
session holds no direct Postgres credentials for the real hosted project):

```
=== BEFORE planting the grant mutant ===
exit 0
verify-remote-schema: the live remote matches the checked-in fixtures.

--- planting: grant select on matches to public ---

=== AFTER planting the grant mutant ===
exit 1
verify-remote-schema: GRANT DRIFT — live remote != live-grants-snapshot.json
  live:    [...,{"table_name":"matches","grantee":"PUBLIC","privilege_type":"SELECT"},...]
  fixture: [...no PUBLIC entry...]

--- reverting ---
=== AFTER reverting ===
exit 0
verify-remote-schema: the live remote matches the checked-in fixtures.
```

**Orchestrator follow-up, verified independently rather than accepted:** the orchestrator
tested that `anon`/`authenticated`/`service_role` can be seeded directly into pglite (they
are ordinary Postgres roles) and that `information_schema.role_table_grants` sees the
resulting grants — meaning the fourth mutant did not have to stay remote-only. Folded into
`schema-drift.test.ts`: the three roles are now created before the migrations run, and a
fourth test compares the resulting grants against `migration-grants-snapshot.json` (expected:
`postgres`-the-owner only — the migrations never issue a `GRANT`). Re-planted the same mutant
directly in the local suite:

```
FAIL > grants no privilege to anon/authenticated/service_role from the migrations themselves
  + { "grantee": "PUBLIC", "privilege_type": "SELECT", "table_name": "matches" }
```

Reverted, all 4 local tests green again. `verify-remote-schema.ts` is unchanged in purpose —
it remains the only channel that can see the *live* remote's actual privilege configuration
(finding 2's gap), not the only channel that can see a grant at all.

All four mutants fire — three locally from the start, the fourth locally after this
follow-up — and all four were reverted and the suite reconfirmed green before moving on.

## 5. Known scope boundaries (stated, not silently omitted — per C2's standard)

- **Grants against the migrations' own surface are checked locally** (`schema-drift.test.ts`,
  runs in `npm test`/CI) — a migration that ever grants a Data API role a privilege it
  shouldn't now fails there, no live connection required. **What's still remote-only** is
  whether the *live* database's actual privilege configuration (Supabase's platform-level
  default-privilege bootstrap, which no migration in this repo issues or could reproduce)
  still matches what was last captured — that's `npm run supabase:verify-remote`, and it is
  deliberately NOT wired into CI (CLAUDE.md §5: local dev and CI never point at the remote).
  This is a standing, documented gap, not a bug.
- **This session verified the remote-facing script's logic against a stand-in, not the real
  hosted project**, because it holds MCP-mediated access only, not a direct
  `SUPABASE_DB_URL`. The fixtures themselves ARE captured from the real remote (via MCP
  `execute_sql`, shown byte-for-byte in this report and reproduced independently by the
  stage-6 reviewer). Running `npm run supabase:verify-remote` for real against
  `fjiwrzaosluymamannaw` just requires setting `SUPABASE_DB_URL` — nothing else changes.
- **`commit_move()` is not implemented** — deferred to A1 by design (recorded in plan §16).

## 6. Migration filenames vs. remote migration history

Local files are content-numbered (`0001_`, `0002_`, `0003_`); the remote's own migration
history (`mcp__supabase__list_migrations`) uses timestamp versions:

| Local file | Remote version | Remote name |
|---|---|---|
| `0001_async_multiplayer.sql` | `20260803094200` | `phase2_async_match_schema_deny_all` |
| `0002_async_multiplayer_amendments.sql` | `20260806170509` | `async_multiplayer_amendments` |
| `0003_match_players_user_fk_restrict.sql` | (applied via MCP `apply_migration`, name `match_players_user_fk_restrict`; check `list_migrations` for its assigned version before relying on it) | |

**Standing note:** do not run `supabase link` + `supabase db push` against
`fjiwrzaosluymamannaw` from this repo. The CLI's push matches local migration files to the
remote's `supabase_migrations.schema_migrations` table by version; since local filenames
were not authored as timestamps, a linked push would not recognize 0001–0003 as already
applied and would attempt to re-run them, erroring on every `create table`/`add column`
that already exists. Reconciliation between this repo and the remote goes through
`mcp__supabase__apply_migration` (or, once credentials are available in an environment that
has them, `npm run supabase:verify-remote` for checking / `--write` for fixture sync) —
never CLI push/pull against this project.

## 7. Minor, noted rather than acted on

- **0002's empty-table premise is self-verifying** for its `not null`-without-default column
  adds (Postgres refuses those against a non-empty table on its own) — an explicit `RAISE`
  guard would have been redundant there. Worth using deliberately in a *future* migration
  whose statements don't have that automatic backstop.
- **`matches_join_code_idx`** (plain index on `join_code` alone) is now a prefix-duplicate of
  `matches_join_code_round_key` (unique on `(join_code, round)`). Left as-is — it is real,
  it is what's live, and the fixture pins it faithfully rather than "cleaning it up" into
  something that no longer matches the remote.
