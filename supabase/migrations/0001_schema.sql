-- Hackurity 2026 portal: schema
create type user_role as enum ('team', 'jury', 'admin');
create type scorecard_status as enum ('draft', 'submitted', 'recused');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null unique,
  role user_role not null default 'team'
);

-- Emails allowed to become jury/admin. Everyone else signs up as a team lead.
create table invitations (
  email text primary key,
  role user_role not null check (role in ('jury', 'admin')),
  name text not null default '',
  created_at timestamptz not null default now()
);

create table tracks (
  id char(1) primary key check (id in ('A','B','C','D')),
  name text not null,
  sponsor text
);

create table problem_statements (
  id smallint primary key check (id between 1 and 8),
  track_id char(1) not null references tracks(id),
  title text not null,
  difficulty text not null default '',
  brief text not null default '',
  core text[] not null default '{}',
  stretch text[] not null default '{}',
  active boolean not null default true
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  college text not null default '',
  lead_id uuid not null unique references profiles(id) on delete cascade,
  track_id char(1) references tracks(id),
  ps_id smallint references problem_statements(id),
  slot timestamptz,
  repo_url text,
  video_url text,
  writeup_url text,
  status text not null default 'draft' check (status in ('draft','registered','submitted')),
  created_at timestamptz not null default now(),
  check ((track_id is null) = (ps_id is null))
);

create table team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  email text not null default ''
);

create table jury_assignments (
  id uuid primary key default gen_random_uuid(),
  juror_id uuid not null references profiles(id) on delete cascade,
  team_id uuid references teams(id) on delete cascade,
  track_id char(1) references tracks(id) on delete cascade,
  check ((team_id is null) <> (track_id is null)),
  unique (juror_id, team_id),
  unique (juror_id, track_id)
);

create table scorecards (
  team_id uuid not null references teams(id) on delete cascade,
  juror_id uuid not null references profiles(id) on delete cascade,
  tech smallint check (tech between 0 and 5),
  demo smallint check (demo between 0 and 5),
  prac smallint check (prac between 0 and 5),
  stretch smallint check (stretch between 0 and 5),
  clarity smallint check (clarity between 0 and 5),
  core_checked int[] not null default '{}',
  stretch_checked int[] not null default '{}',
  demo_type text not null default '' check (demo_type in ('', 'live', 'video', 'slides')),
  conflict boolean not null default false,
  comments text not null default '',
  recommendation text not null default '' check (recommendation in ('', 'finalist', 'strong', 'maybe', 'no')),
  status scorecard_status not null default 'draft',
  updated_at timestamptz not null default now(),
  primary key (team_id, juror_id)
);

create table settings (
  id int primary key default 1 check (id = 1),
  registration_open boolean not null default true,
  registration_deadline timestamptz,
  max_teams_per_ps int not null default 6,
  max_team_size int not null default 4,
  scoring_closed boolean not null default false,
  results_published boolean not null default false
);
insert into settings default values;

-- Weighted total out of 100: tech x6, demo x5, prac x4, stretch x3, clarity x2
create function scorecard_total(s scorecards) returns int
language sql immutable as $$
  select 6*coalesce(s.tech,0) + 5*coalesce(s.demo,0) + 4*coalesce(s.prac,0)
       + 3*coalesce(s.stretch,0) + 2*coalesce(s.clarity,0)
$$;
