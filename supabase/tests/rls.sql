-- RLS checks. Run in the Supabase SQL editor on a scratch project AFTER the migrations + seed.
-- Everything runs in one transaction and rolls back.
begin;

-- Dummy users (handle_new_user creates profiles; invitations decide the role)
insert into invitations (email, role) values ('j1@t.test', 'jury'), ('j2@t.test', 'jury');
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 't1@t.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 't2@t.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b1', 'j1@t.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'j2@t.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Teams register (as the teams)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select save_team('Team One', 'REVA', '[{"name":"A","email":"a@x"}]');
select choose_problem('A', 1::smallint);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select save_team('Team Two', 'REVA', '[]');
select choose_problem('A', 2::smallint);

-- 1. Wrong-track PS is rejected
do $$ begin
  begin perform choose_problem('B', 1::smallint); raise exception 'FAIL: wrong track accepted';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;

-- Admin-side setup: assign both jurors to track A, then jurors score team one
reset role;
insert into jury_assignments (juror_id, track_id) values
  ('00000000-0000-0000-0000-0000000000b1', 'A'), ('00000000-0000-0000-0000-0000000000b2', 'A');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
insert into scorecards (team_id, juror_id, tech, demo, prac, stretch, clarity, status)
  select id, '00000000-0000-0000-0000-0000000000b1', 5, 5, 5, 2, 5, 'submitted' from teams where name = 'Team One';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
insert into scorecards (team_id, juror_id, tech, demo, prac, stretch, clarity, status)
  select id, '00000000-0000-0000-0000-0000000000b2', 1, 1, 1, 1, 1, 'submitted' from teams where name = 'Team One';

-- 2. Juror 2 sees only their own scorecard
do $$ begin
  if (select count(*) from scorecards) <> 1 then raise exception 'FAIL: juror sees other jurors'' scorecards'; end if;
end $$;

-- 3. Team sees no scorecards directly, and no results before publish
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  if (select count(*) from scorecards) <> 0 then raise exception 'FAIL: team reads scorecards'; end if;
  if team_results() is not null then raise exception 'FAIL: results visible before publish'; end if;
end $$;

-- 4. After publish: results visible, without juror identities
reset role;
update settings set results_published = true;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  if team_results() is null then raise exception 'FAIL: results hidden after publish'; end if;
  if (team_results())::text like '%juror%' then raise exception 'FAIL: juror identity leaked'; end if;
end $$;

-- 5. Registration lock is enforced server side
reset role;
update settings set registration_open = false;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
do $$ begin
  begin perform choose_problem('A', 1::smallint); raise exception 'FAIL: locked registration accepted';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;

rollback;
select 'all RLS checks passed' as result;
