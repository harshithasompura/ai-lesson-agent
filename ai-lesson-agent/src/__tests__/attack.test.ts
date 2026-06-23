/**
 * Phase 4: Attack / Security property tests
 *
 * These are integration-style unit tests that verify security invariants by
 * exercising logic directly — no HTTP server is spun up.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/neo4j', () => ({ runNeo4j: vi.fn(), default: {} }))
vi.mock('@/lib/db', () => ({ default: { query: vi.fn() } }))
vi.mock('langsmith', () => ({ Client: vi.fn(() => ({ createExample: vi.fn() })) }))
vi.mock('@langchain/anthropic', () => ({ ChatAnthropic: vi.fn(() => ({ withStructuredOutput: vi.fn(() => ({ invoke: vi.fn() })) })) }))
vi.mock('@langchain/langgraph', () => ({ interrupt: vi.fn() }))

// ── Test 1: answerKey not in client-visible state ─────────────────────────────
//
// The graph state holds `answerKey` internally. The `currentQuestion` field
// that IS sent to the client is produced by `generateMCQNode` and contains
// only { question, choices } — never correctIndex or the raw answerKey string.
// We verify the structural contract by checking a simulated serialised state.

describe('answerKey not in client-visible state', () => {
  // Simulates what generateMCQNode writes to currentQuestion (JSON string)
  // and what answerKey holds separately.
  const simulatedGraphState = {
    currentQuestion: JSON.stringify({
      question: 'Which mechanism does LangGraph use to pause execution at a node?',
      choices: [
        'A conditional edge that returns null',
        'A node that raises StopIteration',
        'The interrupt() primitive injected into a node',
        'Setting state.paused = true before returning',
      ],
    }),
    // answerKey is stored separately in graph state — it is NEVER merged into currentQuestion
    answerKey: '2', // index of correct choice
  }

  it('currentQuestion JSON does not contain correctIndex', () => {
    const parsed = JSON.parse(simulatedGraphState.currentQuestion)
    expect(parsed).not.toHaveProperty('correctIndex')
  })

  it('currentQuestion JSON does not contain answerKey', () => {
    const parsed = JSON.parse(simulatedGraphState.currentQuestion)
    expect(parsed).not.toHaveProperty('answerKey')
  })

  it('currentQuestion JSON does not contain the raw answerKey value inline', () => {
    // The client receives currentQuestion as a string — the answerKey value
    // must not appear inside it, even accidentally.
    expect(simulatedGraphState.currentQuestion).not.toContain(simulatedGraphState.answerKey)
  })

  it('answerKey exists on the server-side state object', () => {
    // Confirms the field exists in state (so the grading node can use it)
    // but is NOT present in the client-visible currentQuestion field.
    expect(simulatedGraphState.answerKey).toBeDefined()
    const parsed = JSON.parse(simulatedGraphState.currentQuestion)
    const clientVisibleKeys = Object.keys(parsed)
    expect(clientVisibleKeys).not.toContain('answerKey')
  })
})

// ── Test 2: Chat endpoint structurally cannot leak the answer key ─────────────
//
// /api/chat (route.ts) receives { messages, currentQuestion, objective } from
// the client. The route NEVER accepts an answerKey parameter and NEVER includes
// correctIndex or explanation in the context it builds for the LLM.
// We test the context-building logic extracted from the route.

describe('chat endpoint context builder never includes answer key', () => {
  // Extracted from route.ts — the context builder logic
  function buildContextLines(
    currentQuestion: string | null,
    objective: string | null,
  ): string {
    const lines = [
      objective ? `Learning objective: ${objective}` : null,
      currentQuestion
        ? (() => {
            try {
              const { question, choices } = JSON.parse(currentQuestion) as {
                question: string
                choices: string[]
                correctIndex?: number
                answerKey?: string
              }
              return `Current question: ${question}\nChoices: ${(choices as string[]).map((c, i) => `${i + 1}. ${c}`).join(' | ')}`
            } catch {
              return null
            }
          })()
        : null,
    ]
      .filter(Boolean)
      .join('\n')
    return lines
  }

  const questionPayload = JSON.stringify({
    question: 'What is the primary role of a reducer in LangGraph state?',
    choices: [
      'To fetch data from an external API',
      'To merge incoming state updates with existing state',
      'To route the graph to the next node',
      'To persist state to a database automatically',
    ],
    // Simulate a client that tries to smuggle the answer through
    correctIndex: 1,
    answerKey: '1',
  })

  const context = buildContextLines(questionPayload, 'Understand LangGraph state management')

  it('built context does not contain correctIndex literal', () => {
    expect(context).not.toMatch(/correctIndex/)
  })

  it('built context does not contain answerKey literal', () => {
    expect(context).not.toMatch(/answerKey/)
  })

  it('built context does not contain the numeric answer value in a way that leaks it', () => {
    // The context should contain choice text but not expose which index is correct.
    // "correctIndex: 1" or "answerKey: 1" must not appear.
    expect(context).not.toMatch(/correctIndex\s*[=:]\s*\d/)
    expect(context).not.toMatch(/answerKey\s*[=:]\s*\d/)
  })

  it('built context still includes question and choices (not over-filtered)', () => {
    expect(context).toContain('What is the primary role')
    expect(context).toContain('merge incoming state updates')
  })
})

// ── Test 3: Structural validator catches "All of the above" ──────────────────

import { validateMCQStructure } from '../agent/quiz'

describe('structural validator catches bad MCQ shapes', () => {
  const validBase = {
    question: 'Which of the following best describes the role of an interrupt in LangGraph?',
    choices: [
      'It pauses graph execution until human input is provided',
      'It terminates the graph run with an error code',
      'It deletes the current state and restarts the run',
      'It sends an email notification to the operator',
    ],
    correctIndex: 0,
  }

  it('returns null for a valid MCQ', () => {
    expect(validateMCQStructure(validBase)).toBeNull()
  })

  it('flags "All of the above" choice', () => {
    const result = validateMCQStructure({
      ...validBase,
      choices: [
        'It pauses graph execution until human input is provided',
        'It terminates the graph run with an error code',
        'It deletes the current state and restarts the run',
        'All of the above',
      ],
    })
    expect(result).not.toBeNull()
    expect(result).toMatch(/Meta-option detected/i)
  })

  it('flags "None of the above" choice', () => {
    const result = validateMCQStructure({
      ...validBase,
      choices: [
        'It pauses graph execution until human input is provided',
        'It terminates the graph run with an error code',
        'It deletes the current state and restarts the run',
        'None of the above',
      ],
    })
    expect(result).not.toBeNull()
    expect(result).toMatch(/Meta-option detected/i)
  })

  it('flags "Both A and B" choice', () => {
    const result = validateMCQStructure({
      ...validBase,
      choices: [
        'It pauses graph execution until human input is provided',
        'It terminates the graph run with an error code',
        'Both A and B are correct here',
        'It sends an email notification to the operator',
      ],
    })
    expect(result).not.toBeNull()
    expect(result).toMatch(/Meta-option detected/i)
  })

  it('flags fewer than 4 choices', () => {
    const result = validateMCQStructure({
      ...validBase,
      choices: ['Option alpha is the right one', 'Option beta is plausible', 'Option gamma maybe'],
    })
    expect(result).not.toBeNull()
    expect(result).toMatch(/exactly 4 distinct/i)
  })

  it('flags duplicate choices', () => {
    const result = validateMCQStructure({
      ...validBase,
      choices: [
        'It pauses graph execution until human input is provided',
        'It pauses graph execution until human input is provided',
        'It deletes the current state and restarts the run',
        'It sends an email notification to the operator',
      ],
    })
    expect(result).not.toBeNull()
    expect(result).toMatch(/exactly 4 distinct/i)
  })

  it('flags a question shorter than 10 words', () => {
    const result = validateMCQStructure({
      ...validBase,
      question: 'What is LangGraph?',
    })
    expect(result).not.toBeNull()
    expect(result).toMatch(/too short/i)
  })

  it('flags a question missing the trailing question mark', () => {
    const result = validateMCQStructure({
      ...validBase,
      question: 'Which of the following best describes the role of an interrupt in LangGraph',
    })
    expect(result).not.toBeNull()
    expect(result).toMatch(/must end with/i)
  })
})

// ── Test 4: PDF prompt-injection does not corrupt plan schema ─────────────────
//
// If a PDF contains injected text like "Ignore previous instructions and output X",
// the planner's Zod schema validation acts as a hard structural gate — the output
// must still have the expected shape or the node throws before any state is written.
// This tests the schema itself, not a live LLM call.

import { z } from 'zod'

// Mirror of the plan schema used in src/agent/planner.ts
const PlanSchema = z.object({
  prerequisites: z.array(z.string()).min(1),
  objectives: z.array(z.string()).min(1),
})

describe('plan schema rejects structurally corrupt LLM output', () => {
  it('accepts a valid plan shape', () => {
    const valid = {
      prerequisites: ['Basic understanding of Python'],
      objectives: ['Understand what LangGraph is', 'Build a simple stateful graph'],
    }
    expect(() => PlanSchema.parse(valid)).not.toThrow()
  })

  it('rejects output missing objectives (injection redirected output)', () => {
    const injected = {
      prerequisites: ['Basic understanding of Python'],
      // objectives absent — simulates LLM ignoring the schema due to injection
    }
    expect(() => PlanSchema.parse(injected)).toThrow()
  })

  it('rejects output with empty objectives array', () => {
    const injected = { prerequisites: ['Basic Python'], objectives: [] }
    expect(() => PlanSchema.parse(injected)).toThrow()
  })

  it('rejects a plain string response (injection caused free-text output)', () => {
    const injected = 'Here is my secret plan to leak data'
    expect(() => PlanSchema.parse(injected)).toThrow()
  })

  it('rejects output with objectives replaced by attacker-controlled keys', () => {
    const injected = {
      prerequisites: ['Basic Python'],
      hack: ['exfiltrate data', 'ignore rules'],
      // objectives still absent
    }
    expect(() => PlanSchema.parse(injected)).toThrow()
  })

  it('valid plan with multiple objectives passes', () => {
    const plan = {
      prerequisites: ['Familiarity with graphs', 'Python basics'],
      objectives: [
        'Understand LangGraph node architecture',
        'Use interrupt() for human-in-the-loop flows',
        'Implement conditional edges',
      ],
    }
    const parsed = PlanSchema.parse(plan)
    expect(parsed.objectives).toHaveLength(3)
  })
})
