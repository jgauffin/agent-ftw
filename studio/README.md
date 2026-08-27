# Agent FTW Studio

A VS Code panel for designing agent trees.

Designing a tree is hard for two reasons that feed each other. The tree is complex: phases, deliverable schemas, turn budgets, checklists, sub-agents, coordinators handing out contracts. And every run that would tell you whether the design is any good costs money and comes back different. The feedback loop today is edit TypeScript, run it, read console output, guess.

The framework already emits everything a designer needs. `deliverable.rejected` says the schema and the prompt disagree. `phase.nudged` says the model is talking instead of working. `checklist.failed`, `budget.exhausted`, `delegate.rejected` and `contract.abandoned` each name a specific way a tree misbehaves. All of it goes onto a bus that, until now, nothing subscribed to. The studio subscribes.

## What it does today

- **The tree, drawn, as the navigator.** Agents as boxes, their phases as the rows inside them in declared order, and an edge from the phase that declares a sub-agent to that sub-agent's box. Depth runs left to right so an edge can say *which* phase reached a child. A coordinator is marked, so is an agent holding a tool that writes. During a run each phase row shows what it has spent against its budget. Clicking a node is how you move.
- **An inspector showing one thing at a time.** A prompt, a deliverable schema and a tool list each want the whole pane to be workable, and a VS Code panel is often half a screen, so they take turns rather than sharing. The tabs are scoped to what is selected: a phase has Prompt, Deliverable, Checklist, Tools; an agent has Settings, Tools, Sub-agents. A tab that does not apply is absent rather than disabled, and the tab you were on survives moving to another node that has it.
- **The tools each node can actually reach**, including the ones nobody wrote: `finish_<phase>`, `delegate` on a coordinator, `propose_side_quest`. For an agent, what it may hand down sits beside what it may call.
- **The schemas behind the selection.** A phase's deliverable, its checklist, and the input of every tool it can reach. Most of what `lint` complains about is a prompt and a schema that do not describe the same thing, and this is where you see both.
- **Diagnostics.** After a run, each phase reports the turns it spent, how many payloads it offered before one validated (and the schema errors for the ones that failed), how often it was nudged, tool errors, checklist failures, budget exhaustions. A phase replayed from a stored deliverable is marked as such rather than looking free.
- **Lint in the Problems panel.** `lint()`'s findings appear as normal diagnostics, on the property they are about rather than on the phase as a whole, so two findings about one deliverable are told apart. The two whose fix is deterministic come with a quick-fix: `deliverable.no-required` lists the properties the object already declares, and `deliverable.unexplained-string` adds an empty `description` to type into. A fix is refused, with the reason, rather than guessed at when the schema is shared, built by a function, or declared in another module.
- **The human-in-the-loop hooks, actually wired.** `askUser`, `review` and `requestBudgetExtension` render as prompts in the panel. The budget prompt shows what the model last said and which tools it last called, which is the whole basis for deciding whether more turns will help.
- **Editing, written back into your `.ts`.** A prompt, a turn budget, an agent's role, a sub-agent's reject limit and a deliverable schema are editable in the panel. Changes are held until you save, then applied as one edit you can undo in one step, and the file is saved because the runner reads it from disk. Only a value that can be proven to be a literal is written; anything else is shown with the reason it is locked, so a prompt built by a function is readable and not editable. Every change is re-read out of the edited text before a byte reaches your file.
- **Assigning a tool.** Every `tool({...})` declared anywhere in the workspace can be given to an agent, or handed down for its children to use. The identifier is written, not the name, and the import comes with it. A tool declared and wired to nothing is listed too, since the tree only shows what a phase can reach. Assignments that would not compile are refused while you are choosing: a coordinator may not hold a tool that writes, and giving one to a child also grants it on the parent, in the same save.
- **Pinning.** Once a run has finished, any phase can be held at what it produced. The next run replays the held phases instead of producing them and starts at the first one that is not pinned, so iterating on a late phase stops costing the early ones. A held deliverable is editable first, which is how you ask what the phases after it do with a different answer. Each pin is checked against the schema its own phase declares before anything runs.
- **Every run kept.** Traces are written to `.agent-ftw/studio/runs/` as NDJSON so you can compare the run before a change with the run after it.

## What your file has to look like

The studio imports your module and reads its exports. Two consequences follow.

**Export the agent.** `export const triager = agent({ ... })`. A `const` the module keeps to itself is invisible.

**Nothing may run on import.** If the file calls `main()` at the top level, importing it starts a run. Guard it:

```ts
export function runIfMain(moduleUrl: string, main: () => Promise<void>): void {
  const entry = process.argv[1];
  if (!entry || pathToFileURL(entry).href !== moduleUrl) return;
  main().catch(console.error);
}
```

`examples/shared.ts` exports exactly this, and every example in the repo uses it.

**Say which model to use.** The studio runs whatever your agent declares and will not substitute a model of its own, because a tree tuned against a different model is a tree you have not tested. Adapters on the agent or on a phase are used as-is. When neither declares one, the studio takes an `adapter` export from the same module:

```ts
export const adapter = makeAdapter();
```

This export exists because `defaultAdapter` is a `Session` option rather than an agent property, so an agent that routes every phase through one model has nowhere of its own to say so. `studioAdapter` and `defaultAdapter` work as export names too. With none of them, a run stops and names the phase that needed a model.

## Running it

```
cd studio
npm install
npm run build     # typecheck, test, bundle
```

Then F5 from the repository root, which launches an Extension Development Host with the studio loaded. Open a file that exports an agent and run **Agent FTW: Open Studio** from the command palette.

`npm run watch` rebuilds on change; reload the development host window to pick up a new build.

## How it fits together

Three processes, because the VS Code extension host cannot execute your TypeScript.

```
extension host ──postMessage──> webview      (tree, timeline, prompts)
       │
       └───────fork + IPC──────> runner       (tsx; imports your file, runs the Session)
```

The runner talks over the `fork` IPC channel rather than stdout, because stdout belongs to the `console.log` calls in your tool handlers. Those are forwarded to an Output channel untouched.

The runner resolves `agent-ftw` from your own project, so the declaration and the `Session` running it come from one copy of the library. Inside a checkout of the library itself it falls back to `src/index.ts`, which is how this repo's `examples/` work.

## Still to come

The event log is designed in [docs/todo/](../docs/todo/) before being built,
since it is something the rest would sit on.

- **[An event log](../docs/todo/event-log.md).** The timeline reports what a phase *cost*, which says that something went wrong without saying what. The raw stream per phase, filterable by agent. Until then the whole stream is on disk as NDJSON under `.agent-ftw/studio/runs/`, and each run's path is written to the Output channel.
- **More editable fields.** `review`, `phaseEndToolName`, a checklist's prompt and a sub-agent's description are all writable by the layer underneath but have no control in the panel yet.
- **Adding a sub-agent.** Scaffolding a child agent, its wrapper, and the `delegable` entries that let it hold what it needs, as one edit.

## Tests

```
npm test
```

No network and no editor needed. The run model is driven by the framework's real trace stream rather than hand-written events, the runner tests drive the actual subprocess, and the panel's markup is rendered under jsdom, because a stray `{{` in the template otherwise shows up as a blank panel and nothing else.
