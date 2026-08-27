# Event log

Status: designed, not built.

A per-phase view of the raw trace stream in the studio panel.

## Why

The timeline reports what a phase *cost*: turns, deliverable attempts, nudges,
tool errors, checklist failures. That says something went wrong without saying
what. Asked to diagnose a disappointing run, those counters are where you start
and immediately need to leave.

Everything that would answer the question is already emitted, already crosses
into the panel, and is already retained per phase in the run model. Nothing
renders it.

Until this exists, the whole stream is on disk as NDJSON under
`.agent-ftw/studio/runs/`, and the path of each run is written to the panel's
Output channel.

## What it shows

Expanding a phase in the timeline opens its events in order:

```
planner  root
 ▾ brainstorm   2 turns · 10.5s          [Pin through here]
     0.0s  user       a weekend hack project for a small team
     9.8s  assistant  Three ideas, each self-contained...
     9.8s  → call     finish_brainstorm({ ideas: [...] })
    10.4s  ✗ rejected attempt 1
                      /ideas/0: must have required property 'summary'
    10.5s  ✓ end      { ideas: [ ... ] }
   pick_best    2 turns · 6.4s           [Pin through here]
```

The load-bearing part is `model.turn`. Its payload is a `Turn`, so it renders as
the actual conversation: the user text a phase was given, what the model said,
which tools it called with which arguments, and what came back. That transcript
is the thing a person reads to work out why a phase behaved the way it did, and
it is currently discarded by the panel.

Each event type gets a specific rendering rather than a JSON dump:

| Event | Rendered as |
|---|---|
| `model.turn` | the turn's role and content; tool calls as `name(input)` |
| `tool.call` / `tool.result` / `tool.error` | the tool, its input, its outcome |
| `deliverable.rejected` | the attempt number and the schema errors verbatim |
| `phase.nudged` | the text that triggered the nudge |
| `askUser` | the prompt, the options, what was chosen |
| `budget.exhausted` / `budget.extended` | which limit, and by how much |
| `checklist.run` / `checklist.failed` | the checks and which failed |
| `contract.*` | the objective, the verdict, the reason |

## Filtering by agent

Required, not a refinement. A coordinator's run interleaves the coordinator's own
events with those of every child it contracted, and children in the same wave run
concurrently, so their events arrive shuffled together. Reading one child's run
means excluding the rest.

`runId` already makes this exact: it is a path (`root`, `root.2`, `root.2.1`), so
filtering to one agent is a prefix match, and "this agent and everything below
it" falls out of the same test. The filter should offer both the agent name and
its run path, since the same agent can appear as several contracted runs.

## Design notes

**Flatten into the existing row model.** The timeline is already a flat list of
rows with a `depth`, because the template engine has no recursion. Event rows are
more of the same, inserted after the phase row they belong to when it is
expanded. Nothing new is needed structurally.

**Expansion state belongs to the panel, not the webview.** Same reason all other
state does: a panel that VS Code discards and restores comes back the way it was.

**Cap what is rendered, and say so.** A long run produces a lot of events, and a
phase that spent forty turns should not lock the panel up. Render a bounded
window with an explicit "showing the last N of M" rather than silently
truncating, and point at the NDJSON for the whole thing.

**Do not re-derive on every trace event.** The panel already re-renders per
event during a run. Building event rows for every expanded phase on each of those
is wasted work; build them only for phases that are expanded.

## Open question

Whether the log should also read a *stored* run from `.agent-ftw/studio/runs/`,
so a previous run can be reopened and compared against the current one. The run
store already keeps every run and `RunStore.read` already parses one back. The
missing piece is only the UI for choosing which. Worth doing once the live log
proves its shape, not before.
