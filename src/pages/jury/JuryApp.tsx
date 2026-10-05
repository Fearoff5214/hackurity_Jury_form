import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Route, Routes, useParams } from 'react-router-dom'
import { Shell } from '../../components/Shell'
import { CRITERIA, stretchFromItems, total } from '../../lib/scoring'
import { check, supabase, type ProblemStatement, type Scorecard, type Settings, type Team } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'

const blank = (team_id: string, juror_id: string): Scorecard => ({
  team_id, juror_id, tech: null, demo: null, prac: null, stretch: null, clarity: null,
  core_checked: [], stretch_checked: [], demo_type: '', conflict: false, comments: '', recommendation: '', status: 'draft',
})

function TeamList() {
  const [teams, setTeams] = useState<Team[]>([])
  const [cards, setCards] = useState<Record<string, Scorecard>>({})
  useEffect(() => {
    (async () => {
      setTeams(check(await supabase.from('teams').select('*').not('ps_id', 'is', null).order('slot', { nullsFirst: false })) as Team[])
      const c = check(await supabase.from('scorecards').select('*')) as Scorecard[]
      setCards(Object.fromEntries(c.map((x) => [x.team_id, x])))
    })()
  }, [])
  const label = (c?: Scorecard) => (!c ? 'not started' : c.status)
  return (
    <>
      <h2>My teams</h2>
      {teams.length === 0 && <p className="muted">No teams are assigned to you yet.</p>}
      <table>
        <thead><tr><th>Team</th><th>Track / PS</th><th>Slot</th><th>Status</th><th>My total</th><th /></tr></thead>
        <tbody>{teams.map((t) => (
          <tr key={t.id}>
            <td>{t.name}</td><td>{t.track_id} / PS-{t.ps_id}</td>
            <td>{t.slot ? new Date(t.slot).toLocaleString() : '-'}</td>
            <td><span className="pill">{label(cards[t.id])}</span></td>
            <td>{cards[t.id]?.status === 'submitted' ? total(cards[t.id]) : '-'}</td>
            <td><Link to={`/jury/team/${t.id}`}>Open</Link></td>
          </tr>
        ))}</tbody>
      </table>
    </>
  )
}

function ScoreForm() {
  const { id } = useParams()
  const { profile } = useAuth()
  const [team, setTeam] = useState<Team | null>(null)
  const [ps, setPs] = useState<ProblemStatement | null>(null)
  const [card, setCard] = useState<Scorecard | null>(null)
  const [closed, setClosed] = useState(false)
  const [msg, setMsg] = useState('')
  const timer = useRef<number>()
  const dirty = useRef(false)

  useEffect(() => {
    (async () => {
      const t = check(await supabase.from('teams').select('*').eq('id', id!).single()) as Team
      setTeam(t)
      setPs(check(await supabase.from('problem_statements').select('*').eq('id', t.ps_id!).single()) as ProblemStatement)
      setClosed((check(await supabase.from('settings').select('*').single()) as Settings).scoring_closed)
      const c = check(await supabase.from('scorecards').select('*').eq('team_id', id!).maybeSingle()) as Scorecard | null
      setCard(c ?? blank(id!, profile!.id))
    })()
  }, [id, profile])

  const persist = useCallback(async (c: Scorecard) => {
    const { error } = await supabase.from('scorecards').upsert(c)
    setMsg(error ? error.message : 'Saved ' + new Date().toLocaleTimeString())
    return !error
  }, [])

  // Autosave 800ms after the last edit
  useEffect(() => {
    if (!card || !dirty.current || card.status === 'submitted') return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { persist(card); dirty.current = false }, 800)
    return () => window.clearTimeout(timer.current)
  }, [card, persist])

  if (!card || !team || !ps) return <p>Loading...</p>
  const locked = closed || card.status === 'submitted'
  const edit = (patch: Partial<Scorecard>) => { dirty.current = true; setCard({ ...card, ...patch }) }
  const toggle = (key: 'core_checked' | 'stretch_checked', i: number) => {
    const set = new Set(card[key]); set.has(i) ? set.delete(i) : set.add(i)
    const next = [...set].sort((a, b) => a - b)
    const patch: Partial<Scorecard> = { [key]: next }
    if (key === 'stretch_checked') {
      const forced = stretchFromItems(next.length)
      patch.stretch = forced ?? Math.min(card.stretch ?? 0, 2)
    }
    edit(patch)
  }
  const forcedStretch = stretchFromItems(card.stretch_checked.length)

  async function submit() {
    if (await persist({ ...card!, status: card!.conflict ? 'recused' : 'submitted' }))
      setCard({ ...card!, status: card!.conflict ? 'recused' : 'submitted' })
  }
  async function reopen() {
    const next = { ...card!, status: 'draft' as const }
    if (await persist(next)) setCard(next)
  }

  return (
    <>
      <p><Link to="/jury">&larr; My teams</Link></p>
      <h2>{team.name} <span className="pill">{card.status}</span></h2>
      <p className="muted">PS-{ps.id}: {ps.title} · {team.repo_url && <a href={team.repo_url} target="_blank" rel="noreferrer">repo</a>}{' '}
        {team.video_url && <a href={team.video_url} target="_blank" rel="noreferrer">video</a>}{' '}
        {team.writeup_url && <a href={team.writeup_url} target="_blank" rel="noreferrer">write-up</a>}</p>
      {closed && <p className="warn">Scoring is closed by the admin.</p>}

      <div className="card">
        <label>Demo type
          <select disabled={locked} value={card.demo_type} onChange={(e) => edit({ demo_type: e.target.value as Scorecard['demo_type'] })}>
            <option value="">Select...</option><option value="live">Live</option><option value="video">Video</option><option value="slides">Slides only</option>
          </select>
        </label>
        <label><input type="checkbox" disabled={locked} checked={card.conflict} onChange={(e) => edit({ conflict: e.target.checked })} />
          Conflict of interest (submitting will recuse me and exclude this scorecard)</label>
      </div>

      <div className="card">
        <h3>Core deliverables seen working</h3>
        {ps.core.map((c, i) => (
          <label key={i}><input type="checkbox" disabled={locked} checked={card.core_checked.includes(i)} onChange={() => toggle('core_checked', i)} />{c}</label>
        ))}
        <h3>Stretch items seen working</h3>
        {ps.stretch.map((c, i) => (
          <label key={i}><input type="checkbox" disabled={locked} checked={card.stretch_checked.includes(i)} onChange={() => toggle('stretch_checked', i)} />{c}</label>
        ))}
      </div>

      <div className="card">
        <h3>Scores (0-5)</h3>
        {CRITERIA.map((c) => {
          const fixed = c.key === 'stretch' && forcedStretch !== null
          const max = c.key === 'stretch' && forcedStretch === null ? 2 : 5
          return (
            <div key={c.key} className="row" style={{ margin: '8px 0' }}>
              <div style={{ width: 200 }}>{c.label} <span className="muted">x{c.weight}</span></div>
              <div className="scale">
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" className={card[c.key] === n ? 'on' : ''}
                    disabled={locked || fixed || n > max} onClick={() => edit({ [c.key]: n })}>{n}</button>
                ))}
              </div>
              {c.key === 'stretch' && <span className="muted">{fixed ? `auto: ${forcedStretch} from items ticked` : 'none working: choose 0-2'}</span>}
            </div>
          )
        })}
        <h3>Total: {total(card)} / 100</h3>
      </div>

      <div className="card">
        <label>Comments<textarea rows={4} disabled={locked} value={card.comments} onChange={(e) => edit({ comments: e.target.value })} /></label>
        <label>Recommendation
          <select disabled={locked} value={card.recommendation} onChange={(e) => edit({ recommendation: e.target.value as Scorecard['recommendation'] })}>
            <option value="">Select...</option><option value="finalist">Finalist</option><option value="strong">Strong</option><option value="maybe">Maybe</option><option value="no">No</option>
          </select>
        </label>
        <div className="row">
          {card.status === 'draft'
            ? <button onClick={submit} disabled={closed}>Submit scorecard</button>
            : <button className="ghost" onClick={reopen} disabled={closed}>Reopen</button>}
          <span className="muted">{msg}</span>
        </div>
      </div>
    </>
  )
}

export default function JuryApp() {
  return (
    <Shell title="Jury" nav={[{ to: '/jury', label: 'My teams', end: true }]}>
      <Routes>
        <Route index element={<TeamList />} />
        <Route path="team/:id" element={<ScoreForm />} />
      </Routes>
    </Shell>
  )
}
