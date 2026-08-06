-- 0003_match_players_user_fk_restrict.sql
--
-- Stage-6 review escalation on A0, ruled in docs/plans/platform-corrections.md ("C21
-- addendum, corrected" -> "Ruling on the reviewer's escalation").
--
-- match_players.user_id referenced auth.users(id) on delete cascade. Plan §4.5 records a
-- constraint in prose: "no anonymous-user cleanup job may run against this project while
-- matches reference anon users (deleting a stale anon user would cascade/violate into live
-- seats)." Paired with CASCADE, that prose isn't a constraint the schema enforces — it's an
-- intention the schema silently violates the moment such a job exists, unseating a live
-- player without a trace. That is the exact defect shape C21's moves-PK overrule condemned
-- two sections earlier in the same plan; the orchestrator applied the PK reasoning there but
-- not here, and corrected it in this ruling.
--
-- restrict makes a cleanup job that would corrupt a live match fail loudly instead of
-- succeeding quietly, and forces account deletion into an explicit anonymise-or-resolve
-- decision (the behaviour account deletion should have anyway) rather than a silent cascade.
--
-- Free right now because match_players is empty (reverified below); that window closes at
-- launch, which is why this rides in as its own migration rather than waiting.
alter table public.match_players drop constraint match_players_user_id_fkey;
alter table public.match_players
  add constraint match_players_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete restrict;
