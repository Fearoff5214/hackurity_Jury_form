-- Registration (all checks server side)
create function registration_is_open() returns boolean
language sql stable security definer set search_path = public as $$
  select registration_open and (registration_deadline is null or now() < registration_deadline)
  from settings where id = 1
$$;

create function save_team(p_name text, p_college text, p_members jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; max_size int; m jsonb;
begin
  if current_role_name() <> 'team' then raise exception 'only team accounts can register'; end if;
  if not registration_is_open() then raise exception 'registration is closed'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'team name is required'; end if;
  select max_team_size into max_size from settings where id = 1;
  if jsonb_array_length(coalesce(p_members, '[]')) > max_size then
    raise exception 'a team can have at most % members', max_size;
  end if;
  insert into teams (name, college, lead_id) values (trim(p_name), coalesce(p_college, ''), auth.uid())
  on conflict (lead_id) do update set name = excluded.name, college = excluded.college
  returning id into tid;
  delete from team_members where team_id = tid;
  for m in select * from jsonb_array_elements(coalesce(p_members, '[]')) loop
    if coalesce(trim(m->>'name'), '') <> '' then
      insert into team_members (team_id, name, email) values (tid, trim(m->>'name'), coalesce(m->>'email', ''));
    end if;
  end loop;
  return tid;
end $$;

create function choose_problem(p_track char, p_ps smallint) returns void
language plpgsql security definer set search_path = public as $$
declare tid uuid; cap int; taken int; ps problem_statements;
begin
  if current_role_name() <> 'team' then raise exception 'only team accounts can register'; end if;
  if not registration_is_open() then raise exception 'registration is closed'; end if;
  select id into tid from teams where lead_id = auth.uid();
  if tid is null then raise exception 'create your team first'; end if;
  select * into ps from problem_statements where id = p_ps and active;
  if ps.id is null then raise exception 'unknown or inactive problem statement'; end if;
  if ps.track_id <> p_track then raise exception 'PS-% does not belong to track %', p_ps, p_track; end if;
  perform pg_advisory_xact_lock(p_ps);
  select max_teams_per_ps into cap from settings where id = 1;
  select count(*) into taken from teams where ps_id = p_ps and id <> tid;
  if cap is not null and taken >= cap then raise exception 'PS-% is full', p_ps; end if;
  update teams set track_id = p_track, ps_id = p_ps,
    status = case when status = 'draft' then 'registered' else status end
  where id = tid;
end $$;

-- Teams per PS (teams cannot read other teams, so expose counts only)
create function ps_counts() returns table (ps_id smallint, n bigint)
language sql stable security definer set search_path = public as $$
  select ps_id, count(*) from teams where ps_id is not null group by ps_id
$$;

-- Project submission: mark submitted once any link exists
create function touch_team_status() returns trigger
language plpgsql as $$
begin
  if new.ps_id is not null and (new.repo_url is not null or new.video_url is not null or new.writeup_url is not null)
     and new.status = 'registered' then
    new.status := 'submitted';
  end if;
  return new;
end $$;
create trigger teams_status before update on teams for each row execute function touch_team_status();

-- Admin helpers
create function admin_update_team(p_team uuid, p_track char, p_ps smallint, p_slot timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_ps is not null and not exists (select 1 from problem_statements where id = p_ps and track_id = p_track) then
    raise exception 'PS-% does not belong to track %', p_ps, p_track;
  end if;
  update teams set track_id = p_track, ps_id = p_ps, slot = p_slot,
    status = case when p_ps is not null and status = 'draft' then 'registered' else status end
  where id = p_team;
end $$;

create function invite_user(p_email text, p_name text, p_role user_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_role = 'team' then raise exception 'teams self-register'; end if;
  insert into invitations (email, name, role) values (lower(trim(p_email)), coalesce(p_name, ''), p_role)
  on conflict (email) do update set role = excluded.role, name = excluded.name;
  update profiles set role = p_role, name = case when name = '' then coalesce(p_name, '') else name end
  where lower(email) = lower(trim(p_email));
end $$;

-- Per-scorecard detail with 20-point outlier flag (admin only)
create function admin_scorecards() returns table (
  team_id uuid, juror_id uuid, juror_name text, status scorecard_status,
  tech smallint, demo smallint, prac smallint, stretch smallint, clarity smallint,
  total int, mean_others numeric, delta numeric, flagged boolean, comments text, recommendation text, conflict boolean
) language sql stable security definer set search_path = public as $$
  with sc as (
    select s.*, scorecard_total(s) as total from scorecards s where is_admin()
  ), agg as (
    select team_id, sum(total) filter (where status = 'submitted') as sum_t,
           count(*) filter (where status = 'submitted') as n
    from sc group by team_id
  )
  select sc.team_id, sc.juror_id, p.name, sc.status, sc.tech, sc.demo, sc.prac, sc.stretch, sc.clarity, sc.total,
    case when sc.status = 'submitted' and a.n > 1 then round((a.sum_t - sc.total)::numeric / (a.n - 1), 1) end,
    case when sc.status = 'submitted' and a.n > 1 then round(sc.total - (a.sum_t - sc.total)::numeric / (a.n - 1), 1) end,
    coalesce(sc.status = 'submitted' and a.n > 1 and abs(sc.total - (a.sum_t - sc.total)::numeric / (a.n - 1)) > 20, false),
    sc.comments, sc.recommendation, sc.conflict
  from sc join agg a using (team_id) join profiles p on p.id = sc.juror_id
$$;

-- Leaderboard, ranked within track (admin only). Recused/draft excluded.
-- Tie-break: stretch avg, then tech avg, then demo avg. rank() keeps true ties visible.
create function admin_leaderboard() returns table (
  team_id uuid, team_name text, track_id char, ps_id smallint, jurors_scored bigint,
  avg_total numeric, avg_tech numeric, avg_demo numeric, avg_prac numeric, avg_stretch numeric, avg_clarity numeric,
  rank bigint
) language sql stable security definer set search_path = public as $$
  with a as (
    select t.id, t.name, t.track_id, t.ps_id,
      count(s.*) as n,
      round(avg(scorecard_total(s)), 2) as avg_total,
      round(avg(s.tech), 2) as avg_tech, round(avg(s.demo), 2) as avg_demo,
      round(avg(s.prac), 2) as avg_prac, round(avg(s.stretch), 2) as avg_stretch,
      round(avg(s.clarity), 2) as avg_clarity
    from teams t left join scorecards s on s.team_id = t.id and s.status = 'submitted'
    where is_admin() and t.track_id is not null
    group by t.id
  )
  select id, name, track_id, ps_id, n, avg_total, avg_tech, avg_demo, avg_prac, avg_stretch, avg_clarity,
    rank() over (partition by track_id
      order by avg_total desc nulls last, avg_stretch desc nulls last, avg_tech desc nulls last, avg_demo desc nulls last)
  from a
$$;

-- What a team sees after publish: own rank, averaged scores, anonymous comments
create function team_results() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid; r record; out jsonb;
begin
  if not (select results_published from settings where id = 1) then return null; end if;
  select id into tid from teams where lead_id = auth.uid();
  if tid is null then return null; end if;
  with a as (
    select t.id, t.track_id, count(s.*) as n,
      round(avg(scorecard_total(s)), 2) as total, round(avg(s.tech), 2) as tech, round(avg(s.demo), 2) as demo,
      round(avg(s.prac), 2) as prac, round(avg(s.stretch), 2) as stretch, round(avg(s.clarity), 2) as clarity
    from teams t left join scorecards s on s.team_id = t.id and s.status = 'submitted'
    where t.track_id is not null group by t.id
  ), ranked as (
    select *, rank() over (partition by track_id
      order by total desc nulls last, stretch desc nulls last, tech desc nulls last, demo desc nulls last) as rnk,
      count(*) over (partition by track_id) as of_n
    from a
  )
  select * into r from ranked where id = tid;
  if r.id is null then return null; end if;
  select jsonb_build_object(
    'rank', r.rnk, 'of', r.of_n, 'jurors', r.n, 'total', r.total,
    'scores', jsonb_build_object('tech', r.tech, 'demo', r.demo, 'prac', r.prac, 'stretch', r.stretch, 'clarity', r.clarity),
    'comments', coalesce((select jsonb_agg(c.comments order by c.updated_at) from scorecards c
      where c.team_id = tid and c.status = 'submitted' and trim(c.comments) <> ''), '[]'::jsonb)
  ) into out;
  return out;
end $$;

revoke all on function ps_counts(), admin_scorecards(), admin_leaderboard(), team_results(), admin_update_team(uuid,char,smallint,timestamptz),
  invite_user(text,text,user_role), save_team(text,text,jsonb), choose_problem(char,smallint) from public;
grant execute on function ps_counts(), admin_scorecards(), admin_leaderboard(), team_results(), admin_update_team(uuid,char,smallint,timestamptz),
  invite_user(text,text,user_role), save_team(text,text,jsonb), choose_problem(char,smallint) to authenticated;
