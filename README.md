# Hackurity 2026 portal

Vite + React + TypeScript on Supabase (Postgres, Auth, RLS). Roles: team, jury, admin.

## Setup
1. Create a Supabase project. In the SQL editor run, in order: `supabase/migrations/0001_schema.sql`, `0002_rls.sql`, `0003_rpc.sql`, then `supabase/seed.sql`.
   Before seeding, change `admin@example.com` in `seed.sql` to your email so you become admin on first sign-in.
2. Auth > URL configuration: add your site URL (and `http://localhost:5173`) as redirect URLs. Email OTP/magic link is on by default.
3. `cp .env.example .env` and fill in the project URL and anon key.
4. `npm install`, `npm run dev`. `npm run build` outputs static files in `dist/` for any static host.

## Before the event
- Replace the placeholder problem statements: Admin > Problems (or edit `seed.sql`).
- Settings tab: caps (default 6 teams per PS, 4 members), deadline, lock, publish.
- Invite jurors in People, then assign tracks/teams in Assignments ("All tracks" lets a juror score everyone).

## Rules implemented
- Total = tech x6 + demo x5 + practicality x4 + stretch x3 + clarity x2, out of 100.
- Stretch is derived from ticked stretch items (1 = 3, 2 = 4, 3+ = 5; none = juror picks 0-2), enforced by a DB trigger.
- Team score = average of submitted totals; recused and drafts excluded. Rank per track; ties broken by stretch, tech, demo avg.
- Jurors more than 20 points from the mean of the others are flagged (advisory, does not block publishing).
- Privacy is enforced by RLS: jurors read only their own scorecards for assigned teams; teams have no table access to scorecards and get only their own rank, averages and anonymous comments from `team_results()` once published.

## Tests
- `npm test`: scoring unit tests.
- `supabase/tests/rls.sql`: run on a scratch Supabase project; it rolls back.

## After the event
Decide who owns the Supabase project and export data (Admin > Leaderboard > Export CSV, or `pg_dump`).
