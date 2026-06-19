# CLAUDE.md — Project Instructions for Claude Code

## What this project is

A take-home skills assessment for a Senior AI Agents Engineer role at an AI EdTech Startup.
Every decision, file, and session is being evaluated. Code quality, architecture reasoning, and documentation all matter equally.

---

## Session rules — read every session, no exceptions

### 1. AI_USAGE.md — update every session

Every Claude Code session must append an entry to `AI_USAGE.md` before closing.

Format:
```
## Session — YYYY-MM-DD [short title]
**Chat link:** [paste URL if browser session; "CLI session" if terminal-only]
**What changed:** [bullet list — files touched, decisions made, code written]
**Why:** [one line on the driving reason]
**Open threads:** [anything left unresolved or deferred to next session]
```

Rules:
- One entry per session, even if the session was short or produced no code.
- If the session was a browser chat (claude.ai), paste the chat link so the conversation is traceable.
- Append — never overwrite existing entries.

### 2. Locked files — PLAN.md and SYSTEM_DESIGN.md

`PLAN.md` and `SYSTEM_DESIGN.md` are **locked**. Do not edit them without explicit approval.

If a change to either file is genuinely required (a decision is outdated, a watchpoint was resolved, a new open question emerged from implementation):

1. **Stop.** Do not edit the file.
2. **Show the user** exactly what needs to change and why — quote the current text, propose the replacement, state the reason in one sentence.
3. **Wait for explicit approval** before making any edit.

"Required" means the file is actively misleading or incorrect. Clarifications that could go in a comment or commit message are not edits to the locked files.

### 3. README.md — update as applicable

Any session that adds, removes, or significantly changes a feature, dependency, or architectural component must update `README.md` to reflect the new state. Small refactors or bug fixes that don't change what the system does or how to run it do not require a README update.

When in doubt: if a new contributor reading the README would be confused by the gap between what it says and what the code does, update it.

### 4. CONSTITUTION.md — consult before writing agent logic

Before writing or modifying any agent node, prompt, state schema, or graph edge, read `CONSTITUTION.md`. It defines the hard limits the agent system must never violate. If a proposed implementation would violate a principle, flag it before writing the code.

---

## Project files reference

| File | Status | Purpose |
|---|---|---|
| `PLAN.md` | **Locked** | Implementation-facing architecture and data flow |
| `SYSTEM_DESIGN.md` | **Locked** | Design decisions with rationale and sources |
| `CONSTITUTION.md` | Read before agent work | Hard safety limits for the agent system |
| `AI_USAGE.md` | Append every session | Session log and AI usage audit trail |
| `README.md` | Update as applicable | Project overview and setup instructions |
