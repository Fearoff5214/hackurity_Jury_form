import { useState, type FormEvent } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { supabase } from './lib/supabase'
import TeamApp from './pages/team/TeamApp'
import JuryApp from './pages/jury/JuryApp'
import AdminApp from './pages/admin/AdminApp'

function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr('')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    })
    if (error) setErr(error.message)
    else setSent(true)
  }

  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <h1>Hackurity 2026</h1>
        <p className="muted">REVA Cybersecurity Club. Teams, jury and admins sign in with an email link.</p>
        {sent ? (
          <p>Check <b>{email}</b> for your sign-in link.</p>
        ) : (
          <>
            <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <button type="submit">Email me a sign-in link</button>
          </>
        )}
        {err && <p className="error">{err}</p>}
      </form>
    </div>
  )
}

export default function App() {
  const { session, profile, loading } = useAuth()
  if (loading) return <div className="center">Loading...</div>
  if (!session) return <Login />
  if (!profile) return <div className="center">Your profile is not ready. Reload, or sign out and in again.</div>

  const home = { team: '/team', jury: '/jury', admin: '/admin' }[profile.role]
  return (
    <Routes>
      <Route path="/team/*" element={profile.role === 'team' ? <TeamApp /> : <Navigate to={home} replace />} />
      <Route path="/jury/*" element={profile.role === 'jury' ? <JuryApp /> : <Navigate to={home} replace />} />
      <Route path="/admin/*" element={profile.role === 'admin' ? <AdminApp /> : <Navigate to={home} replace />} />
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  )
}
