-- Yessy 0004 (phase 3): live updates for household tables via Supabase Realtime (applied as migration "realtime").
-- Realtime postgres_changes respects RLS, so members only receive their household's rows.
do $$
declare t text;
begin
  foreach t in array array['household_recipe_state', 'cook_log', 'recipe_lists', 'recipe_list_items', 'recipe_ratings'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
