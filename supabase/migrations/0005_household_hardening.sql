-- Yessy 0005: hardening for the household tables (after 0002/0003). Safe to re-run.
-- 1. Client timestamps are clamped to now() + 5 min, so a wrong device clock (or a
--    crafted request) can't make a value win every future merge.
-- 2. "Who did it" columns are stamped server-side for client writes: a member can't
--    write someone else's id into updated_by / user_id / owner_id / added_by.
-- 3. Only a list's owner can change its visibility ('Bara för mig' <-> household).
-- 4. A stale status write (it won neither field) keeps the previous updated_by.
-- Writes from SECURITY DEFINER functions (join/merge/leave) run as the function owner
-- and are not re-stamped.

begin;

create or replace function public.clamp_ts(t timestamptz)
returns timestamptz language sql stable set search_path = '' as $$
  select least(t, now() + interval '5 minutes')
$$;

-- Vill laga / Lagad + Inte för oss: per-field newer wins (insert + update)
create or replace function public.merge_recipe_state()
returns trigger language plpgsql set search_path = '' as $$
declare won boolean;
begin
  new.status_at := public.clamp_ts(new.status_at);
  new.nfu_at := public.clamp_ts(new.nfu_at);
  if current_user = 'authenticated' then new.updated_by := auth.uid(); end if;
  if tg_op = 'INSERT' then
    new.updated_at := greatest(new.status_at, new.nfu_at, new.updated_at);
    return new;
  end if;
  won := new.status_at > old.status_at or new.nfu_at > old.nfu_at;
  if new.status_at < old.status_at then new.status := old.status; new.status_at := old.status_at; end if;
  if new.nfu_at < old.nfu_at then new.not_for_us := old.not_for_us; new.nfu_at := old.nfu_at; end if;
  if not won then new.updated_by := old.updated_by; end if;
  new.updated_at := greatest(new.status_at, new.nfu_at, old.updated_at);
  return new;
end $$;
drop trigger if exists household_recipe_state_merge on public.household_recipe_state;
create trigger household_recipe_state_merge before insert or update on public.household_recipe_state
  for each row execute function public.merge_recipe_state();

-- Stars + Recension: per-field newer wins (insert + update)
create or replace function public.merge_rating()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.rating_at := public.clamp_ts(new.rating_at);
  new.review_at := public.clamp_ts(new.review_at);
  if tg_op = 'INSERT' then
    new.updated_at := greatest(new.rating_at, new.review_at, new.updated_at);
    return new;
  end if;
  if new.rating_at < old.rating_at then new.rating := old.rating; new.rating_at := old.rating_at; end if;
  if new.review_at < old.review_at then new.review := old.review; new.review_at := old.review_at; end if;
  new.updated_at := greatest(new.rating_at, new.review_at, old.updated_at);
  return new;
end $$;
drop trigger if exists recipe_ratings_merge on public.recipe_ratings;
create trigger recipe_ratings_merge before insert or update on public.recipe_ratings
  for each row execute function public.merge_rating();

-- Generic keep-newer (cook_log, recipe_lists, recipe_list_items, recipe_notes) + actor stamps
create or replace function public.keep_newer()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := public.clamp_ts(new.updated_at);
  if current_user = 'authenticated' then
    if tg_table_name = 'cook_log' then
      if tg_op = 'INSERT' then new.user_id := auth.uid(); else new.user_id := old.user_id; end if;
    elsif tg_table_name = 'recipe_lists' then
      if tg_op = 'INSERT' then new.owner_id := auth.uid();
      else
        new.owner_id := old.owner_id;
        if old.owner_id is distinct from auth.uid() then new.visibility := old.visibility; end if;
      end if;
    elsif tg_table_name = 'recipe_list_items' then
      if tg_op = 'INSERT' then new.added_by := auth.uid(); else new.added_by := old.added_by; end if;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists cook_log_keep_newer on public.cook_log;
create trigger cook_log_keep_newer before insert or update on public.cook_log
  for each row execute function public.keep_newer();
drop trigger if exists recipe_lists_keep_newer on public.recipe_lists;
create trigger recipe_lists_keep_newer before insert or update on public.recipe_lists
  for each row execute function public.keep_newer();
drop trigger if exists recipe_list_items_keep_newer on public.recipe_list_items;
create trigger recipe_list_items_keep_newer before insert or update on public.recipe_list_items
  for each row execute function public.keep_newer();
drop trigger if exists recipe_notes_keep_newer on public.recipe_notes;
create trigger recipe_notes_keep_newer before insert or update on public.recipe_notes
  for each row execute function public.keep_newer();

revoke execute on function public.clamp_ts(timestamptz) from public, anon;
grant execute on function public.clamp_ts(timestamptz) to authenticated;

commit;
