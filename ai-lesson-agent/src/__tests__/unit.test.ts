import { describe, it, expect } from 'vitest'

function progressFraction(currentObjectiveIndex: number, totalObjectives: number): number {
  if (totalObjectives <= 0) return 0
  const raw = (currentObjectiveIndex + 1) / totalObjectives
  return Math.min(1, Math.max(0, raw))
}

describe('progress bar calculation', () => {
  it('returns 0.5 for index=0, total=2', () => {
    expect(progressFraction(0, 2)).toBe(0.5)
  })

  it('returns 1.0 for last objective (index=1, total=2)', () => {
    expect(progressFraction(1, 2)).toBe(1.0)
  })

  it('returns 1.0 for single objective (index=0, total=1)', () => {
    expect(progressFraction(0, 1)).toBe(1.0)
  })

  it('clamps to 1.0 when index exceeds total', () => {
    expect(progressFraction(5, 2)).toBe(1.0)
  })

  it('returns 0 for total=0 (guard)', () => {
    expect(progressFraction(0, 0)).toBe(0)
  })
})
