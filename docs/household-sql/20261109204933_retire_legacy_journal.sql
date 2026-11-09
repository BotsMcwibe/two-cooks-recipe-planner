-- Yessy phase 5: MANUAL ONLY. Do not run automatically against the live project.
-- Deploy g21 first. Legacy data may be discarded; no archive or compatibility path.
-- Read-only inspection found no public function/view/matview referencing this table,
-- and no persistent migrate_prefs_to_household function. 0003 was a one-shot script.
-- merge_recipe_state() belongs to household_recipe_state and must remain.
begin;

drop table if exists public.user_recipe_state;
-- The table's own policies, indexes, constraints and triggers are removed with it.
-- No CASCADE: an unexpected dependency must be reviewed, not silently removed.

update public.user_preferences
set prefs = prefs - array['cookLog','recipeNotes','recipeLists','notForUs','journalMigratedAt']::text[]
where prefs ?| array['cookLog','recipeNotes','recipeLists','notForUs','journalMigratedAt'];
-- cookChallenge and all other active preferences stay untouched and writable.

commit;
