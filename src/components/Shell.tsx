import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ThemeToggle } from './ThemeToggle'

export interface NavItem { to: string; label: string; end?: boolean }

export function Shell({ title, nav, children }: { title: string; nav: NavItem[]; children: ReactNode }) {
  const { profile, signOut } = useAuth()
  return (
    <>
      <header className="top">
        <strong>Hackurity 2026 <span className="muted">/ {title}</span></strong>
        <nav>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>{n.label}</NavLink>
          ))}
        </nav>
        <span className="muted who">{profile?.email}</span>
        <ThemeToggle />
        <button className="ghost" onClick={signOut}>Sign out</button>
      </header>
      <main>{children}</main>
    </>
  )
}
