import { useTheme } from '../lib/theme'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button type="button" className="ghost" onClick={toggle} title="Toggle theme">
      {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
    </button>
  )
}
