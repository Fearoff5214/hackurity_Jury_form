import { useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { supabase } from './lib/supabase'
import { ThemeToggle } from './components/ThemeToggle'
import TeamApp from './pages/team/TeamApp'
import JuryApp from './pages/jury/JuryApp'
import AdminApp from './pages/admin/AdminApp'

function Login() {
  const [err, setErr] = useState('')

  async function signInWithGoogle() {
    setErr('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    })
    if (error) setErr(error.message)
  }

  return (
    <div className="center">
      <div className="card narrow">
        <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
          <ThemeToggle />
        </div>
        <h1>Hackurity 2026</h1>
        <p className="muted">REVA Cybersecurity Club. Teams, jury and admins sign in with Google.</p>
        <button type="button" onClick={signInWithGoogle}>Sign in with Google</button>
        {err && <p className="error">{err}</p>}
      </div>
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
