import { Fragment, useCallback, useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Shell } from '../../components/Shell'
import { check, supabase, type Profile, type ProblemStatement, type Settings, type Team, type Track } from '../../lib/supabase'

interface Assignment { id: string; juror_id: string; team_id: string | null; track_id: string | null }
interface LeaderRow {
  team_id: string; team_name: string; track_id: string; ps_id: number; jurors_scored: number
  avg_total: number | null; avg_tech: number | null; avg_demo: number | null; avg_prac: number | null
  avg_stretch: number | null; avg_clarity: number | null; rank: number
}
interface CardRow {
  team_id: string; juror_id: string; juror_name: string; status: string; total: number
  mean_others: number | null; delta: number | null; flagged: boolean; comments: string; recommendation: string
}

function useAdminData() {
  const [d, setD] = useState<{
    teams: Team[]; people: Profile[]; tracks: Track[]; ps: ProblemStatement[]; settings: Settings
    assigns: Assignment[]; board: LeaderRow[]; cards: CardRow[]
  } | null>(null)
  const reload = useCallback(async () => {
    const q = (t: string) => supabase.from(t).select('*')
    const [teams, people, tracks, ps, settings, assigns, board, cards] = await Promise.all([
      q('teams').order('created_at'), q('profiles').order('email'), q('tracks').order('id'), q('problem_statements').order('id'),
      q('settings').single(), q('jury_assignments'), supabase.rpc('admin_leaderboard'), supabase.rpc('admin_scorecards'),
    ])
    setD({
      teams: check(teams) as Team[], people: check(people) as Profile[], tracks: check(tracks) as Track[],
      ps: check(ps) as ProblemStatement[], settings: check(settings) as Settings, assigns: check(assigns) as Assignment[],
      board: check(board) as LeaderRow[], cards: check(cards) as CardRow[],
    })
  }, [])
  useEffect(() => { reload() }, [reload])
  return { d, reload }
}
type D = NonNullable<ReturnType<typeof useAdminData>['d']>
type P = { d: D; reload: () => void }

function Overview({ d }: P) {
  const jurors = d.people.filter((p) => p.role === 'jury')
  const submitted = d.cards.filter((c) => c.status === 'submitted').length
  const tiles = [
    ['Teams', d.teams.length], ['Problem chosen', d.teams.filter((t) => t.ps_id).length],
    ['Projects submitted', d.teams.filter((t) => t.status === 'submitted').length],
    ['Jurors', jurors.length], ['Scorecards submitted', submitted], ['Flags to review', d.cards.filter((c) => c.flagged).length],
  ]
  return <div className="grid">{tiles.map(([l, n]) => <div className="tile" key={l}><div className="n">{n}</div>{l}</div>)}</div>
}

function Settings_({ d, reload }: P) {
  const [s, setS] = useState(d.settings)
  const [msg, setMsg] = useState('')
  const save = async (patch: Partial<Settings>) => {
    const next = { ...s, ...patch }; setS(next)
    const { error } = await supabase.from('settings').update(patch).eq('id', 1)
    setMsg(error ? error.message : 'Saved'); reload()
  }
  return (
    <div className="card">
      <h2>Registration and results</h2>
      <label><input type="checkbox" checked={s.registration_open} onChange={(e) => save({ registration_open: e.target.checked })} />Registration open</label>
      <label>Deadline
        <input type="datetime-local" value={s.registration_deadline ? s.registration_deadline.slice(0, 16) : ''}
          onChange={(e) => save({ registration_deadline: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
      <label>Max teams per problem
        <input type="number" min={1} value={s.max_teams_per_ps} onChange={(e) => save({ max_teams_per_ps: +e.target.value })} /></label>
      <label>Max team size
        <input type="number" min={1} value={s.max_team_size} onChange={(e) => save({ max_team_size: +e.target.value })} /></label>
      <label><input type="checkbox" checked={s.scoring_closed} onChange={(e) => save({ scoring_closed: e.target.checked })} />Scoring closed (jurors can no longer edit)</label>
      <label><input type="checkbox" checked={s.results_published} onChange={(e) => save({ results_published: e.target.checked })} />Results published (teams can see rank, scores, comments)</label>
      <p className="muted">{msg}</p>
    </div>
  )
}

function Registrations({ d, reload }: P) {
  const [msg, setMsg] = useState('')
  const count = (id: number) => d.teams.filter((t) => t.ps_id === id).length
  async function update(t: Team, track: string | null, ps: number | null, slot: string | null) {
    const { error } = await supabase.rpc('admin_update_team', { p_team: t.id, p_track: track, p_ps: ps, p_slot: slot })
    setMsg(error ? error.message : 'Saved'); reload()
  }
  return (
    <>
      <h2>Registrations per problem</h2>
      <div className="grid">{d.ps.map((p) => {
        const n = count(p.id), cap = d.settings.max_teams_per_ps
        return <div className="tile" key={p.id}><b>PS-{p.id}</b> {p.title}<div className={n >= cap ? 'error' : ''}>{n} / {cap}{n >= cap ? ' (cap reached)' : ''}</div></div>
      })}</div>
      <h2>Teams and slots</h2>
      <p className="muted">{msg}</p>
      <table>
        <thead><tr><th>Team</th><th>College</th><th>Problem</th><th>Slot</th><th>Links</th></tr></thead>
        <tbody>{d.teams.map((t) => (
          <tr key={t.id}>
            <td>{t.name}<div className="muted">{t.status}</div></td><td>{t.college}</td>
            <td><select value={t.ps_id ?? ''} onChange={(e) => {
              const p = d.ps.find((x) => x.id === +e.target.value)
              update(t, p?.track_id ?? null, p?.id ?? null, t.slot)
            }}>
              <option value="">None</option>
              {d.ps.map((p) => <option key={p.id} value={p.id}>{p.track_id} / PS-{p.id}</option>)}
            </select></td>
            <td><input type="datetime-local" value={t.slot ? t.slot.slice(0, 16) : ''}
              onChange={(e) => update(t, t.track_id, t.ps_id, e.target.value ? new Date(e.target.value).toISOString() : null)} /></td>
            <td>{[['repo', t.repo_url], ['video', t.video_url], ['write-up', t.writeup_url]].map(([l, u]) =>
              u ? <div key={l}><a href={u} target="_blank" rel="noreferrer">{l}</a></div> : null)}</td>
          </tr>
        ))}</tbody>
      </table>
    </>
  )
}

function People({ d, reload }: P) {
  const [email, setEmail] = useState(''); const [name, setName] = useState('')
  const [role, setRole] = useState<'jury' | 'admin'>('jury'); const [msg, setMsg] = useState('')
  async function invite() {
    const { error } = await supabase.rpc('invite_user', { p_email: email, p_name: name, p_role: role })
    setMsg(error ? error.message : `Invited ${email}. Ask them to sign in with that email.`)
    if (!error) { setEmail(''); setName(''); reload() }
  }
  return (
    <>
      <div className="card">
        <h2>Invite jury or admin</h2>
        <div className="row">
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value as 'jury' | 'admin')}><option value="jury">Jury</option><option value="admin">Admin</option></select>
          <button disabled={!email} onClick={invite}>Invite</button>
        </div>
        <p className="muted">{msg}</p>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
        <tbody>{d.people.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.email}</td><td><span className="pill">{p.role}</span></td></tr>)}</tbody>
      </table>
    </>
  )
}

function Assignments({ d, reload }: P) {
  const jurors = d.people.filter((p) => p.role === 'jury')
  const [msg, setMsg] = useState('')
  const has = (j: string, track: string) => d.assigns.some((a) => a.juror_id === j && a.track_id === track)
  async function toggleTrack(j: string, track: string) {
    const ex = d.assigns.find((a) => a.juror_id === j && a.track_id === track)
    const { error } = ex
      ? await supabase.from('jury_assignments').delete().eq('id', ex.id)
      : await supabase.from('jury_assignments').insert({ juror_id: j, track_id: track })
    setMsg(error?.message ?? ''); reload()
  }
  async function assignAll(j: string) {
    const rows = d.tracks.filter((t) => !has(j, t.id)).map((t) => ({ juror_id: j, track_id: t.id }))
    if (rows.length) { const { error } = await supabase.from('jury_assignments').insert(rows); setMsg(error?.message ?? '') }
    reload()
  }
  async function addTeam(j: string, team: string) {
    if (!team) return
    const { error } = await supabase.from('jury_assignments').insert({ juror_id: j, team_id: team })
    setMsg(error?.message ?? ''); reload()
  }
  async function removeAssign(id: string) { await supabase.from('jury_assignments').delete().eq('id', id); reload() }
  return (
    <>
      <h2>Jury assignments</h2>
      <p className="muted">Tick a track to assign every team in it. Use "all tracks" for a juror who scores everyone. {msg}</p>
      {jurors.length === 0 && <p>Invite jurors first (People).</p>}
      {jurors.map((j) => (
        <div className="card" key={j.id}>
          <b>{j.name || j.email}</b>
          <div className="row" style={{ margin: '8px 0' }}>
            {d.tracks.map((t) => (
              <label key={t.id} style={{ margin: 0 }}><input type="checkbox" checked={has(j.id, t.id)} onChange={() => toggleTrack(j.id, t.id)} />Track {t.id}</label>
            ))}
            <button className="ghost" onClick={() => assignAll(j.id)}>All tracks</button>
          </div>
          <div className="row">
            {d.assigns.filter((a) => a.juror_id === j.id && a.team_id).map((a) => (
              <span className="pill" key={a.id}>{d.teams.find((t) => t.id === a.team_id)?.name}{' '}
                <a href="#x" onClick={(e) => { e.preventDefault(); removeAssign(a.id) }}>x</a></span>
            ))}
            <select value="" onChange={(e) => addTeam(j.id, e.target.value)}>
              <option value="">Add single team...</option>
              {d.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
      ))}
    </>
  )
}

function Leaderboard({ d }: P) {
  const [open, setOpen] = useState<string | null>(null)
  const f = (n: number | null) => (n == null ? '-' : n)
  function exportCsv() {
    const head = ['Track', 'Rank', 'Team', 'PS', 'Jurors', 'Avg total', 'Tech', 'Demo', 'Practicality', 'Stretch', 'Clarity']
    const rows = d.board.sort((a, b) => a.track_id.localeCompare(b.track_id) || a.rank - b.rank).map((r) =>
      [r.track_id, r.rank, r.team_name, r.ps_id, r.jurors_scored, r.avg_total, r.avg_tech, r.avg_demo, r.avg_prac, r.avg_stretch, r.avg_clarity])
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'hackurity-2026-results.csv'; a.click()
  }
  const ties = (r: LeaderRow) => d.board.filter((x) => x.track_id === r.track_id && x.rank === r.rank).length > 1
  return (
    <>
      <div className="row"><h2 style={{ flex: 1 }}>Leaderboard</h2><button onClick={exportCsv}>Export CSV</button></div>
      {d.tracks.map((t) => {
        const rows = d.board.filter((r) => r.track_id === t.id).sort((a, b) => a.rank - b.rank)
        return (
          <Fragment key={t.id}>
            <h3>Track {t.id}</h3>
            <table>
              <thead><tr><th>#</th><th>Team</th><th>PS</th><th>Jurors</th><th>Avg total</th><th>Stretch</th><th>Tech</th><th>Demo</th><th /></tr></thead>
              <tbody>{rows.length === 0 ? <tr><td colSpan={9} className="muted">No teams yet</td></tr> : rows.map((r) => {
                const cs = d.cards.filter((c) => c.team_id === r.team_id)
                return (
                  <Fragment key={r.team_id}>
                    <tr>
                      <td>{r.rank}{ties(r) && r.avg_total != null && <span className="warn" title="Exact tie: admin to resolve"> tie</span>}</td>
                      <td>{r.team_name}{cs.some((c) => c.flagged) && <span className="warn"> flag</span>}</td>
                      <td>{r.ps_id}</td><td>{r.jurors_scored}</td><td><b>{f(r.avg_total)}</b></td>
                      <td>{f(r.avg_stretch)}</td><td>{f(r.avg_tech)}</td><td>{f(r.avg_demo)}</td>
                      <td><button className="ghost" onClick={() => setOpen(open === r.team_id ? null : r.team_id)}>{open === r.team_id ? 'Hide' : 'Jurors'}</button></td>
                    </tr>
                    {open === r.team_id && cs.map((c) => (
                      <tr key={c.juror_id} className="muted">
                        <td /><td colSpan={3}>{c.juror_name} <span className="pill">{c.status}</span>{c.flagged && <b className="warn"> flagged: {c.delta} vs others' mean {c.mean_others}</b>}
                          <div>{c.comments}</div></td>
                        <td>{c.total}</td><td colSpan={4}>{c.recommendation}</td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}</tbody>
            </table>
          </Fragment>
        )
      })}
    </>
  )
}

function Problems({ d, reload }: P) {
  const [msg, setMsg] = useState('')
  async function save(p: ProblemStatement, patch: Partial<ProblemStatement>) {
    const { error } = await supabase.from('problem_statements').update(patch).eq('id', p.id)
    setMsg(error ? error.message : 'Saved'); reload()
  }
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
  return (
    <>
      <h2>Problem statements</h2><p className="muted">{msg}</p>
      {d.ps.map((p) => (
        <div className="card" key={p.id}>
          <b>PS-{p.id} (Track {p.track_id})</b>
          <label>Title<input defaultValue={p.title} onBlur={(e) => save(p, { title: e.target.value })} /></label>
          <label>Difficulty<input defaultValue={p.difficulty} onBlur={(e) => save(p, { difficulty: e.target.value })} /></label>
          <label>Brief<textarea rows={3} defaultValue={p.brief} onBlur={(e) => save(p, { brief: e.target.value })} /></label>
          <label>Core deliverables (one per line)<textarea rows={4} defaultValue={p.core.join('\n')} onBlur={(e) => save(p, { core: lines(e.target.value) })} /></label>
          <label>Stretch items (one per line)<textarea rows={4} defaultValue={p.stretch.join('\n')} onBlur={(e) => save(p, { stretch: lines(e.target.value) })} /></label>
          <label><input type="checkbox" checked={p.active} onChange={(e) => save(p, { active: e.target.checked })} />Active</label>
        </div>
      ))}
    </>
  )
}

export default function AdminApp() {
  const { d, reload } = useAdminData()
  const nav = [
    { to: '/admin', label: 'Overview', end: true }, { to: '/admin/registrations', label: 'Registrations' },
    { to: '/admin/people', label: 'People' }, { to: '/admin/assignments', label: 'Assignments' },
    { to: '/admin/leaderboard', label: 'Leaderboard' }, { to: '/admin/problems', label: 'Problems' },
    { to: '/admin/settings', label: 'Settings' },
  ]
  if (!d) return <Shell title="Admin" nav={nav}><p>Loading...</p></Shell>
  const p = { d, reload }
  return (
    <Shell title="Admin" nav={nav}>
      <Routes>
        <Route index element={<Overview {...p} />} />
        <Route path="registrations" element={<Registrations {...p} />} />
        <Route path="people" element={<People {...p} />} />
        <Route path="assignments" element={<Assignments {...p} />} />
        <Route path="leaderboard" element={<Leaderboard {...p} />} />
        <Route path="problems" element={<Problems {...p} />} />
        <Route path="settings" element={<Settings_ {...p} />} />
      </Routes>
    </Shell>
  )
}
