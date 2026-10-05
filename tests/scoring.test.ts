import { describe, expect, it } from 'vitest'
import { flagOutliers, rankTeams, stretchFromItems, teamAverages, total, type ScoredCard } from '../src/lib/scoring'

const card = (juror_id: string, v: number, status: ScoredCard['status'] = 'submitted'): ScoredCard => ({
  juror_id, status, tech: v, demo: v, prac: v, stretch: v, clarity: v,
})

describe('scoring', () => {
  it('weights sum to 100 at all fives', () => {
    expect(total(card('a', 5))).toBe(100)
    expect(total({ tech: 5, demo: 0, prac: 0, stretch: 0, clarity: 0 })).toBe(30)
  })

  it('derives stretch tier from items working', () => {
    expect([0, 1, 2, 3, 7].map(stretchFromItems)).toEqual([null, 3, 4, 5, 5])
  })

  it('averages only submitted cards, excluding recused and drafts', () => {
    const a = teamAverages([card('a', 5), card('b', 3), card('c', 0, 'recused'), card('d', 1, 'draft')])
    expect(a.n).toBe(2)
    expect(a.total).toBe(80)
  })

  it('breaks ties by stretch, then tech, then demo', () => {
    const r = rankTeams([
      { id: 'x', total: 80, stretch: 3, tech: 4, demo: 4 },
      { id: 'y', total: 80, stretch: 4, tech: 3, demo: 3 },
      { id: 'z', total: 80, stretch: 4, tech: 3, demo: 3 },
      { id: 'w', total: 90, stretch: 1, tech: 1, demo: 1 },
    ])
    expect(r.map((t) => [t.id, t.rank])).toEqual([['w', 1], ['y', 2], ['z', 2], ['x', 4]])
  })

  it('flags a juror more than 20 points from the mean of the others', () => {
    // totals: 80, 80, 50 -> third is 30 off the others' mean
    const cards = [card('a', 4), card('b', 4), { ...card('c', 0), tech: 3, demo: 3, prac: 3, stretch: 3, clarity: 3 }]
    expect(total(cards[2])).toBe(60)
    expect(flagOutliers(cards).size).toBe(0) // 20 off exactly: not flagged
    const far = [...cards.slice(0, 2), card('c', 2)]
    expect([...flagOutliers(far)]).toEqual(['c'])
  })

  it('does not flag with fewer than two submitted cards', () => {
    expect(flagOutliers([card('a', 5), card('b', 0, 'recused')]).size).toBe(0)
  })
})
