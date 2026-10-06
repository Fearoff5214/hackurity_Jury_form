import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? 'http://localhost:54321',
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'missing-anon-key',
)

export interface Profile { id: string; name: string; email: string; role: 'team' | 'jury' | 'admin' }
export interface Track { id: string; name: string; sponsor: string | null }
export interface ProblemStatement {
  id: number; track_id: string; title: string; difficulty: string; brief: string
  core: string[]; stretch: string[]; active: boolean
}
export interface RepoCheck {
  error?: string; status?: number; repo_url?: string
  public?: boolean; created_at?: string; created_after_window?: boolean | null
  commits_earliest?: string | null; commits_latest?: string | null; commits_in_window?: boolean | null
  has_submission_tag?: boolean; readme_headings_found?: string[]; readme_headings_missing?: string[]
  has_license?: boolean; has_committed_dotenv?: boolean; checked_at: string
}
export interface Team {
  id: string; name: string; college: string; lead_id: string; track_id: string | null; ps_id: number | null
  slot: string | null; repo_url: string | null; video_url: string | null; writeup_url: string | null
  status: 'draft' | 'registered' | 'submitted'
  repo_check: RepoCheck | null; repo_checked_at: string | null
}
export interface Member { id: string; team_id: string; name: string; email: string }
export interface Settings {
  registration_open: boolean; registration_deadline: string | null; max_teams_per_ps: number
  max_team_size: number; scoring_closed: boolean; results_published: boolean
  coding_window_opens_at: string | null; coding_window_closes_at: string | null
}
export interface Scorecard {
  team_id: string; juror_id: string
  tech: number | null; demo: number | null; prac: number | null; stretch: number | null; clarity: number | null
  core_checked: number[]; stretch_checked: number[]
  demo_type: '' | 'live' | 'video' | 'slides'; conflict: boolean; comments: string
  recommendation: '' | 'finalist' | 'strong' | 'maybe' | 'no'
  status: 'draft' | 'submitted' | 'recused'
}

/** Throw the Postgres error message so the UI can show server-side rejections verbatim. */
export function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data
}
