export const CRITERIA = [
  { key: 'tech', label: 'Technical depth', weight: 6 },
  { key: 'demo', label: 'Demo-ability', weight: 5 },
  { key: 'prac', label: 'Practicality', weight: 4 },
  { key: 'stretch', label: 'Stretch Tier', weight: 3 },
  { key: 'clarity', label: 'Clarity of write-up', weight: 2 },
] as const

export type CriterionKey = (typeof CRITERIA)[number]['key']
export type Scores = Partial<Record<CriterionKey, number | null>>

export interface ScoredCard extends Scores {
  juror_id: string
  status: 'draft' | 'submitted' | 'recused'
}

export const FLAG_THRESHOLD = 20

/** Weighted total out of 100. Missing scores count as 0. */
export function total(s: Scores): number {
  return CRITERIA.reduce((sum, c) => sum + c.weight * (s[c.key] ?? 0), 0)
}

/** Stretch score implied by the number of stretch items working, or null if the juror chooses (0-2). */
export function stretchFromItems(working: number): number | null {
  if (working <= 0) return null
  if (working === 1) return 3
  if (working === 2) return 4
  return 5
}

/** Only submitted cards count; drafts and recused are excluded. */
export function submitted(cards: ScoredCard[]): ScoredCard[] {
  return cards.filter((c) => c.status === 'submitted')
}

export function teamAverages(cards: ScoredCard[]) {
  const s = submitted(cards)
  const avg = (f: (c: ScoredCard) => number) => (s.length ? s.reduce((a, c) => a + f(c), 0) / s.length : null)
  return {
    n: s.length,
    total: avg(total),
    tech: avg((c) => c.tech ?? 0),
    demo: avg((c) => c.demo ?? 0),
    stretch: avg((c) => c.stretch ?? 0),
  }
}

export interface RankInput {
  id: string
  total: number | null
  stretch: number | null
  tech: number | null
  demo: number | null
}

/** Rank within one track: total, then stretch avg, then tech avg, then demo avg. Equal everything = shared rank. */
export function rankTeams<T extends RankInput>(teams: T[]): (T & { rank: number })[] {
  const v = (n: number | null) => n ?? -1
  const cmp = (a: T, b: T) =>
    v(b.total) - v(a.total) || v(b.stretch) - v(a.stretch) || v(b.tech) - v(a.tech) || v(b.demo) - v(a.demo)
  const sorted = [...teams].sort(cmp)
  const out: (T & { rank: number })[] = []
  sorted.forEach((t, i) => {
    const rank = i > 0 && cmp(sorted[i - 1], t) === 0 ? out[i - 1].rank : i + 1
    out.push({ ...t, rank })
  })
  return out
}

/** Jurors whose total is more than 20 points from the mean of the other jurors. */
export function flagOutliers(cards: ScoredCard[]): Set<string> {
  const s = submitted(cards)
  const flagged = new Set<string>()
  if (s.length < 2) return flagged
  const sum = s.reduce((a, c) => a + total(c), 0)
  for (const c of s) {
    const meanOthers = (sum - total(c)) / (s.length - 1)
    if (Math.abs(total(c) - meanOthers) > FLAG_THRESHOLD) flagged.add(c.juror_id)
  }
  return flagged
}
