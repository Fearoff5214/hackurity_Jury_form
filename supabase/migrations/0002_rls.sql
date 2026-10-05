-- Helpers (security definer so policies do not recurse)
create function current_role_name() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;
create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false)
$$;
create function is_assigned(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from jury_assignments a
    left join teams t on t.id = p_team
    where a.juror_id = auth.uid()
      and (a.team_id = p_team or (a.track_id is not null and a.track_id = t.track_id))
  )
$$;
create function owns_team(p_team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams where id = p_team and lead_id = auth.uid())
$$;

-- New auth user -> profile, role from invitation
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv invitations;
begin
  select * into inv from invitations where lower(email) = lower(new.email);
  insert into profiles (id, email, name, role)
  values (new.id, new.email, coalesce(inv.name, ''), coalesce(inv.role, 'team'));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Users cannot change their own role
create function protect_role() returns trigger
language plpgsql as $$
begin
  if new.role <> old.role and not is_admin() then
    raise exception 'role can only be changed by an admin';
  end if;
  return new;
end $$;
create trigger profiles_protect_role before update on profiles
  for each row execute function protect_role();

alter table profiles enable row level security;
alter table invitations enable row level security;
alter table tracks enable row level security;
alter table problem_statements enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table jury_assignments enable row level security;
alter table scorecards enable row level security;
alter table settings enable row level security;

-- profiles
create policy profiles_select on profiles for select
  using (id = auth.uid() or is_admin());
create policy profiles_update on profiles for update
  using (id = auth.uid() or is_admin()) with check (id = auth.uid() or is_admin());

-- invitations: admin only
create policy invitations_admin on invitations for all using (is_admin()) with check (is_admin());

-- reference data
create policy tracks_read on tracks for select to authenticated using (true);
create policy tracks_admin on tracks for all using (is_admin()) with check (is_admin());
create policy ps_read on problem_statements for select to authenticated using (true);
create policy ps_admin on problem_statements for all using (is_admin()) with check (is_admin());
create policy settings_read on settings for select to authenticated using (true);
create policy settings_admin on settings for update using (is_admin()) with check (is_admin());

-- teams: lead reads own; assigned jurors read; admin all.
-- Writes go through RPCs, except project links (column-level grant below).
create policy teams_select on teams for select
  using (lead_id = auth.uid() or is_admin() or is_assigned(id));
create policy teams_update_links on teams for update
  using (lead_id = auth.uid() or is_admin()) with check (lead_id = auth.uid() or is_admin());
revoke insert, update, delete on teams from authenticated;
grant update (repo_url, video_url, writeup_url) on teams to authenticated;

create policy members_select on team_members for select
  using (owns_team(team_id) or is_admin() or is_assigned(team_id));
revoke insert, update, delete on team_members from authenticated;

-- jury assignments
create policy assign_select on jury_assignments for select
  using (juror_id = auth.uid() or is_admin());
create policy assign_admin on jury_assignments for all using (is_admin()) with check (is_admin());

-- scorecards: jurors own rows for assigned teams; admin read-only; teams never read directly
create policy score_select on scorecards for select
  using (juror_id = auth.uid() or is_admin());
create policy score_insert on scorecards for insert
  with check (juror_id = auth.uid() and current_role_name() = 'jury' and is_assigned(team_id));
create policy score_update on scorecards for update
  using (juror_id = auth.uid() and is_assigned(team_id))
  with check (juror_id = auth.uid() and is_assigned(team_id));

-- Scorecard integrity: closed scoring, derived stretch tier, complete on submit
create function scorecard_guard() returns trigger
language plpgsql as $$
declare n int; closed boolean;
begin
  select scoring_closed into closed from settings where id = 1;
  if closed then raise exception 'scoring is closed'; end if;
  new.updated_at := now();
  n := coalesce(array_length(new.stretch_checked, 1), 0);
  if n >= 1 then
    new.stretch := case when n = 1 then 3 when n = 2 then 4 else 5 end;
  elsif new.stretch is not null and new.stretch > 2 then
    new.stretch := 2;  -- nothing working: juror may pick 0-2 only
  end if;
  if new.status = 'submitted' and (new.tech is null or new.demo is null or new.prac is null
      or new.stretch is null or new.clarity is null) then
    raise exception 'all five scores are required to submit';
  end if;
  return new;
end $$;
create trigger scorecards_guard before insert or update on scorecards
  for each row execute function scorecard_guard();
