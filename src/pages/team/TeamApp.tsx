import { useCallback, useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Shell } from '../../components/Shell'
import { check, supabase, type Member, type ProblemStatement, type Settings, type Team, type Track } from '../../lib/supabase'

interface Data {
  team: Team | null
  members: Member[]
  tracks: Track[]
  ps: ProblemStatement[]
  settings: Settings
  counts: Record<number, number>
}

function useTeamData() {
  const [data, setData] = useState<Data | null>(null)
  const reload = useCallback(async () => {
    const [team, tracks, ps, settings, all] = await Promise.all([
      supabase.from('teams').select('*').maybeSingle(),
      supabase.from('tracks').select('*').order('id'),
      supabase.from('problem_statements').select('*').eq('active', true).order('id'),
      supabase.from('settings').select('*').single(),
      supabase.rpc('ps_counts'),
    ])
    const t = check(team) as Team | null
    const members = t ? check(await supabase.from('team_members').select('*').eq('team_id', t.id)) : []
    const counts: Record<number, number> = {}
    for (const r of (check(all) as { ps_id: number; n: number }[]) ?? []) counts[r.ps_id] = r.n
    setData({
      team: t, members: members as Member[], tracks: check(tracks) as Track[],
      ps: check(ps) as ProblemStatement[], settings: check(settings) as Settings, counts,
    })
  }, [])
  useEffect(() => { reload() }, [reload])
  return { data, reload }
}

function Register({ data, reload }: { data: Data; reload: () => void }) {
  const { team, members, tracks, ps, settings, counts } = data
  const locked = !settings.registration_open || (!!settings.registration_deadline && new Date() > new Date(settings.registration_deadline))
  const [name, setName] = useState(team?.name ?? '')
  const [college, setCollege] = useState(team?.college ?? '')
  const [ppl, setPpl] = useState<{ name: string; email: string }[]>(
    members.length ? members.map((m) => ({ name: m.name, email: m.email })) : [{ name: '', email: '' }],
  )
  const [track, setTrack] = useState(team?.track_id ?? '')
  const [psId, setPsId] = useState<number | null>(team?.ps_id ?? null)
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)
  const step = !team ? 1 : !track ? 2 : 3

  async function saveTeam() {
    try {
      check(await supabase.rpc('save_team', { p_name: name, p_college: college, p_members: ppl }))
      setBad(false); setMsg('Team saved'); reload()
    } catch (e) { setBad(true); setMsg((e as Error).message) }
  }
  async function confirm() {
    if (!track || !psId) return
    try {
      check(await supabase.rpc('choose_problem', { p_track: track, p_ps: psId }))
      setBad(false); setMsg('Registration confirmed'); reload()
    } catch (e) { setBad(true); setMsg((e as Error).message) }
  }

  const trackPs = ps.filter((p) => p.track_id === track)
  const selected = ps.find((p) => p.id === psId)

  return (
    <>
      <div className="steps">
        {['1. Team', '2. Track', '3. Problem'].map((s, i) => <span key={s} className={step === i + 1 ? 'on' : ''}>{s}</span>)}
      </div>
      {locked && <p className="warn">Registration is locked. You can view your registration but not change it.</p>}

      <div className="card">
        <h2>Team</h2>
        <label>Team name<input value={name} disabled={locked} onChange={(e) => setName(e.target.value)} /></label>
        <label>College<input value={college} disabled={locked} onChange={(e) => setCollege(e.target.value)} /></label>
        <h3>Members (max {settings.max_team_size})</h3>
        {ppl.map((m, i) => (
          <div className="row" key={i}>
            <input placeholder="Name" value={m.name} disabled={locked}
              onChange={(e) => setPpl(ppl.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input placeholder="Email" value={m.email} disabled={locked}
              onChange={(e) => setPpl(ppl.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
            <button className="ghost" disabled={locked} onClick={() => setPpl(ppl.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="ghost" disabled={locked || ppl.length >= settings.max_team_size}
            onClick={() => setPpl([...ppl, { name: '', email: '' }])}>Add member</button>
          <button disabled={locked || !name.trim()} onClick={saveTeam}>{team ? 'Save team' : 'Create team'}</button>
        </div>
      </div>

      {team && (
        <div className="card">
          <h2>Track</h2>
          <div className="grid">
            {tracks.map((t) => (
              <div key={t.id} className={'opt' + (track === t.id ? ' sel' : '')}
                onClick={() => { if (!locked) { setTrack(t.id); if (selected?.track_id !== t.id) setPsId(null) } }}>
                <b>{t.name}</b>{t.sponsor && <span className="pill" style={{ marginLeft: 8 }}>{t.sponsor} sponsored</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {team && track && (
        <div className="card">
          <h2>Problem statement</h2>
          <div className="grid">
            {trackPs.map((p) => {
              const full = (counts[p.id] ?? 0) >= settings.max_teams_per_ps && team.ps_id !== p.id
              return (
                <div key={p.id} className={'opt' + (psId === p.id ? ' sel' : '')} style={{ opacity: full ? .5 : 1 }}
                  onClick={() => { if (!locked && !full) setPsId(p.id) }}>
                  <b>PS-{p.id}: {p.title}</b>
                  <div className="muted">{p.difficulty} · {counts[p.id] ?? 0}/{settings.max_teams_per_ps} teams{full ? ' · FULL' : ''}</div>
                </div>
              )
            })}
          </div>
          {selected && (
            <div style={{ marginTop: 12 }}>
              <p>{selected.brief}</p>
              <h3>Core deliverables</h3>
              <ul>{selected.core.map((c, i) => <li key={i}>{c}</li>)}</ul>
              <h3>Stretch</h3>
              <ul>{selected.stretch.map((c, i) => <li key={i}>{c}</li>)}</ul>
              <button disabled={locked || team.ps_id === selected.id} onClick={confirm}>
                {team.ps_id === selected.id ? 'Confirmed' : team.ps_id ? 'Change to PS-' + selected.id : 'Confirm PS-' + selected.id}
              </button>
            </div>
          )}
        </div>
      )}
      {msg && <p className={bad ? 'error' : 'ok'}>{msg}</p>}
    </>
  )
}

function Mine({ data }: { data: Data }) {
  const { team, ps, settings } = data
  if (!team) return <p>You have not registered a team yet.</p>
  const p = ps.find((x) => x.id === team.ps_id)
  const steps = [
    ['Team created', true],
    ['Problem chosen', !!team.ps_id],
    ['Project submitted', team.status === 'submitted'],
    ['Results published', settings.results_published],
  ] as const
  return (
    <div className="card">
      <h2>{team.name}</h2>
      <p className="muted">{team.college}</p>
      <p>Track {team.track_id ?? '-'} · {p ? `PS-${p.id}: ${p.title}` : 'no problem chosen yet'}</p>
      <p>Presentation slot: {team.slot ? new Date(team.slot).toLocaleString() : 'not assigned yet'}</p>
      <div className="steps">{steps.map(([s, done]) => <span key={s} className={done ? 'on' : ''}>{s}</span>)}</div>
    </div>
  )
}

function Project({ data, reload }: { data: Data; reload: () => void }) {
  const { team } = data
  const [f, setF] = useState({ repo_url: team?.repo_url ?? '', video_url: team?.video_url ?? '', writeup_url: team?.writeup_url ?? '' })
  const [msg, setMsg] = useState('')
  if (!team?.ps_id) return <p>Choose a problem statement before submitting your project.</p>
  async function save() {
    const patch = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]))
    const { error } = await supabase.from('teams').update(patch).eq('id', team!.id)
    setMsg(error ? error.message : 'Saved'); if (!error) reload()
  }
  const repoLooksLikeGithub = !f.repo_url.trim() || /^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/i.test(f.repo_url.trim())
  return (
    <div className="card narrow" style={{ maxWidth: 560 }}>
      <h2>Project links</h2>
      <label>GitHub repository URL (must be public, or shared with the organisers)
        <input value={f.repo_url} onChange={(e) => setF({ ...f, repo_url: e.target.value })} placeholder="https://github.com/your-team/your-repo" /></label>
      {!repoLooksLikeGithub && <p className="warn">That doesn't look like a github.com repo URL — double check it.</p>}
      <label>Demo video URL<input value={f.video_url} onChange={(e) => setF({ ...f, video_url: e.target.value })} /></label>
      <label>Write-up URL<input value={f.writeup_url} onChange={(e) => setF({ ...f, writeup_url: e.target.value })} /></label>
      <button onClick={save}>Save links</button> <span className="muted">{msg}</span>
    </div>
  )
}

interface Results {
  rank: number; of: number; jurors: number; total: number
  scores: Record<'tech' | 'demo' | 'prac' | 'stretch' | 'clarity', number>
  comments: string[]
}

function ResultsView({ data }: { data: Data }) {
  const [res, setRes] = useState<Results | null>(null)
  useEffect(() => {
    if (data.settings.results_published) supabase.rpc('team_results').then((r) => setRes(r.data as Results | null))
  }, [data.settings.results_published])
  if (!data.settings.results_published) return <p>Results have not been published yet.</p>
  if (!res) return <p>No results available for your team.</p>
  const labels = { tech: 'Technical depth', demo: 'Demo-ability', prac: 'Practicality', stretch: 'Stretch Tier', clarity: 'Clarity of write-up' }
  return (
    <div className="card">
      <h2>Rank {res.rank} of {res.of} in Track {data.team?.track_id}</h2>
      <p>Average total: <b>{res.total}</b> / 100 from {res.jurors} jurors</p>
      <table>
        <tbody>{Object.entries(labels).map(([k, l]) => (
          <tr key={k}><td>{l}</td><td>{res.scores[k as keyof typeof labels]} / 5</td></tr>
        ))}</tbody>
      </table>
      <h3>Jury comments</h3>
      {res.comments.length ? <ul>{res.comments.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p className="muted">No comments.</p>}
    </div>
  )
}

export default function TeamApp() {
  const { data, reload } = useTeamData()
  if (!data) return <Shell title="Team" nav={[]}><p>Loading...</p></Shell>
  return (
    <Shell title="Team" nav={[
      { to: '/team', label: 'Register', end: true }, { to: '/team/mine', label: 'My registration' },
      { to: '/team/project', label: 'Project' }, { to: '/team/results', label: 'Results' },
    ]}>
      <Routes>
        <Route index element={<Register key={data.team?.id ?? 'new'} data={data} reload={reload} />} />
        <Route path="mine" element={<Mine data={data} />} />
        <Route path="project" element={<Project data={data} reload={reload} />} />
        <Route path="results" element={<ResultsView data={data} />} />
      </Routes>
    </Shell>
  )
}
