# agent-ftw

## Classes

| Class | Description |
| ------ | ------ |
| [TurnBudgetExhausted](classes/TurnBudgetExhausted.md) | Raised when a phase exceeds its `turnBudget` and the host either has no `requestBudgetExtension` hook or denies the request. |
| [CompileError](classes/CompileError.md) | Thrown by [validate](functions/validate.md) when an agent declaration is structurally invalid: cycles in the sub-agent graph, duplicate phase/tool names, empty phases, etc. |
| [Session](classes/Session.md) | Single root for an agent invocation. Owns the cancellation tree, trace bus, AskUser FIFO queue, and agent-run tree. |
| [TraceBus](classes/TraceBus.md) | Internal bus that timestamps and dispatches [TraceEvent](type-aliases/TraceEvent.md)s to the host's [TraceCallback](type-aliases/TraceCallback.md). Exceptions thrown by the callback are swallowed so tracing never breaks a run. |

## Interfaces

| Interface | Description |
| ------ | ------ |
| [AnthropicApiConfig](interfaces/AnthropicApiConfig.md) | Configuration for [anthropicApiAdapter](functions/anthropicApiAdapter.md). |
| [ClaudeAgentConfig](interfaces/ClaudeAgentConfig.md) | Configuration for [claudeAgentAdapter](functions/claudeAgentAdapter.md). |
| [OpenAICompatConfig](interfaces/OpenAICompatConfig.md) | Configuration for [openaiCompatAdapter](functions/openaiCompatAdapter.md). Works with any endpoint that implements the OpenAI `/chat/completions` shape: OpenAI itself, Ollama (`http://localhost:11434/v1`), LM Studio, vLLM, Together, etc. |
| [ToolCall](interfaces/ToolCall.md) | A model-issued tool call. Adapter implementations translate provider-native tool-call shapes into this normalized form. |
| [ToolSpec](interfaces/ToolSpec.md) | Per-tool descriptor adapters receive on `RunContext.tools`. This is the framework-normalized view; adapters convert it to provider-native shapes (OpenAI function tools, MCP tool defs, etc.) before sending it to the model. |
| [RunContext](interfaces/RunContext.md) | The contract between the framework and an [Adapter](interfaces/Adapter.md). The framework builds one per phase invocation, hands it to `adapter.runUntilPhaseEnd`, and expects the adapter to drive the model loop until the phase-end tool is called (or `signal` aborts). |
| [PersistenceCtx](interfaces/PersistenceCtx.md) | Adapter-facing slice of session persistence. Provides a per-(session, phase) scratchpad for adapter-private state (e.g. the Claude SDK's resumable session id). Available only when the session has persistence enabled AND the run is top-level — sub-agent runs do not persist. |
| [PhaseEndResult](interfaces/PhaseEndResult.md) | Value an adapter returns from [Adapter.runUntilPhaseEnd](interfaces/Adapter.md#rununtilphaseend). `payload` is the raw deliverable the model passed to the phase-end tool (still pre-validation); `conversation` is the full transcript the adapter built for the phase (persistence reads this on resume). |
| [Adapter](interfaces/Adapter.md) | Pluggable model backend. The framework ships three implementations: |
| [CompiledAgent](interfaces/CompiledAgent.md) | The output of [validate](functions/validate.md) — an [AgentDecl](interfaces/AgentDecl.md) that has been structurally checked, with every phase's exposed tools resolved. Pass this to `new Session({ agent, ... })` to skip re-validation. |
| [CompiledPhase](interfaces/CompiledPhase.md) | A phase after compilation. Carries the synthesized phase-end tool and the full set of tools exposed to the model during this phase. |
| [ToolDecl](interfaces/ToolDecl.md) | Plain tool the model may call inside a phase. Created via [tool](functions/tool.md). |
| [ToolHandlerCtx](interfaces/ToolHandlerCtx.md) | Context passed to a [ToolDecl](interfaces/ToolDecl.md) handler when the model invokes the tool. |
| [AskUserInput](interfaces/AskUserInput.md) | Input to an `askUser` call. The host's UI presents `prompt` and `options`; the framework appends a synthetic "Other" option so the user can always reply with free text (returned as `result.other`). |
| [AskUserResult](interfaces/AskUserResult.md) | Result returned from `askUser`. `selected` lists the predefined options the user picked (with the synthetic "Other" stripped); `other` is the user's free text reply when they chose Other. |
| [SubAgentDecl](interfaces/SubAgentDecl.md) | Sub-agent exposed to the model as a tool. Calling the tool spawns a child AgentRun against the embedded `agent` declaration and returns its final phase's deliverable as the tool result. |
| [CustomSubAgentDecl](interfaces/CustomSubAgentDecl.md) | Sub-agent whose body is a custom TS handler instead of a phased AgentDecl. Use when coordination is conditional (fail-fast gating, fan-out/join, deterministic pre/post-processing) and expressing it as phases would be awkward. The handler receives a context that can spawn full child AgentRuns via `runChild`. |
| [CustomSubAgentCtx](interfaces/CustomSubAgentCtx.md) | Context passed to a [CustomSubAgentDecl](interfaces/CustomSubAgentDecl.md) handler. In addition to the usual `signal` / `emit` / `askUser`, it can spawn a phased child agent run via [CustomSubAgentCtx.runChild](interfaces/CustomSubAgentCtx.md#runchild). |
| [SideQuestProposalDecl](interfaces/SideQuestProposalDecl.md) | Framework-internal: the auto-injected `propose_side_quest` tool. Created by compile when an AgentDecl declares `sideQuests.mode === "agent"`. The model sees it as a normal tool spec; dispatch handles it specially (askUser gate + synthesized child AgentRun against the approved tool subset). |
| [SideQuestsDecl](interfaces/SideQuestsDecl.md) | Per-agent configuration for agent-triggered side quests (feature B). |
| [ChecklistDecl](interfaces/ChecklistDecl.md) | Optional LLM-as-judge gate run after a phase produces its deliverable. |
| [TerminatorCtx](interfaces/TerminatorCtx.md) | Context passed to an `external` [PhaseTerminator](type-aliases/PhaseTerminator.md)'s `await` callback. |
| [AssistantTextCtx](interfaces/AssistantTextCtx.md) | Context passed to [OnAssistantText](type-aliases/OnAssistantText.md) when the model emits text without any tool calls. |
| [PhaseDecl](interfaces/PhaseDecl.md) | A single stage in an agent pipeline. Created via [phase](functions/phase.md). |
| [AgentDecl](interfaces/AgentDecl.md) | An agent: a named pipeline of phases. Created via [agent](functions/agent.md). |
| [AskCtx](interfaces/AskCtx.md) | Context passed to [Hooks.askUser](interfaces/Hooks.md#askuser) so the host knows which agent/phase is asking. |
| [ReviewCtx](interfaces/ReviewCtx.md) | Context for a [Hooks.review](interfaces/Hooks.md#review) callback. The host drives a chat loop with the user; for each user message it calls `requestRevision`, which re-runs the phase and returns the revised deliverable. Resolving the callback (with `void`) signals user approval. |
| [BudgetExtensionRequest](interfaces/BudgetExtensionRequest.md) | Snapshot handed to `Hooks.requestBudgetExtension` so the host can decide whether to grant more turns. The host owns the policy — it may consult its own user, apply a fixed cap, or refuse outright. |
| [BudgetExtensionRecentActivity](interfaces/BudgetExtensionRecentActivity.md) | Compact, host-renderable summary of the last few model/tool actions in a budget-exhausted phase. Attached to [BudgetExtensionRequest](interfaces/BudgetExtensionRequest.md) so the host can show the user "what was it doing?" before deciding to grant turns. |
| [Hooks](interfaces/Hooks.md) | Host callbacks the framework invokes during a run. Required: `askUser`. Everything else is optional. |
| [SessionMeta](interfaces/SessionMeta.md) | Mutable persistence record for a single session. Written to `{sessionDirectory}/{agentName}/{sessionId}/meta.json` after each phase boundary. Hosts usually don't construct this directly — use [Session.listSessions](classes/Session.md#listsessions) to enumerate persisted sessions. |
| [SessionInfo](interfaces/SessionInfo.md) | Read-only snapshot returned by [Session.listSessions](classes/Session.md#listsessions). Carries the fields a host UI typically renders (creation/update timestamps, current phase, completion progress) without exposing adapter-internal metadata. |
| [ForkOptions](interfaces/ForkOptions.md) | Options for [Session.fork](classes/Session.md#fork). |
| [ForkResult](interfaces/ForkResult.md) | Return value of [Session.fork](classes/Session.md#fork): the new sibling Session plus the seed input the host should pass to `session.run(seed)`. |
| [SessionOptions](interfaces/SessionOptions.md) | Constructor options for [Session](classes/Session.md). |
| [TracerOptions](interfaces/TracerOptions.md) | Configuration for [createTracer](functions/createTracer.md). |

## Type Aliases

| Type Alias | Description |
| ------ | ------ |
| [Turn](type-aliases/Turn.md) | One entry in a phase's conversation transcript. The framework keeps these for the in-progress phase only — across phase boundaries only structured deliverables carry forward. |
| [ExposedTool](type-aliases/ExposedTool.md) | Anything the model can call as a tool in a compiled phase: plain tools, sub-agents, custom-handler sub-agents, and the synthetic side-quest proposal. |
| [PhaseTerminator](type-aliases/PhaseTerminator.md) | How a phase decides it is finished. |
| [OnAssistantText](type-aliases/OnAssistantText.md) | Host callback invoked when the model emits a turn with text but no tool calls. The default behavior is to nudge the model with a "you must call X" message; supplying this callback overrides that. Return the user reply that should become the next user turn. To terminate the phase, throw or abort the signal. |
| [BudgetExtensionResponse](type-aliases/BudgetExtensionResponse.md) | Host's reply to a [BudgetExtensionRequest](interfaces/BudgetExtensionRequest.md): either grant `extendBy` additional turns or deny (which raises `TurnBudgetExhausted`). |
| [JSONSchema](type-aliases/JSONSchema.md) | JSON Schema type used everywhere in the framework. Re-exported from `json-schema-to-ts` so authors can write `as const` schemas and (optionally) derive a TS type via [Infer](type-aliases/Infer.md). |
| [Infer](type-aliases/Infer.md) | Derive the TS type of a value that satisfies the given JSON Schema. Schema must be authored `as const` for inference to work. |
| [ValidationResult](type-aliases/ValidationResult.md) | Result of [validateAgainstSchema](functions/validateAgainstSchema.md). Pattern-match on `valid` to access errors. |
| [TraceEvent](type-aliases/TraceEvent.md) | Discriminated union of every event the framework emits on the trace bus. |
| [TraceCallback](type-aliases/TraceCallback.md) | Subscriber signature for the trace bus. Set as `Hooks.trace` on a `Session` to receive every framework event. |

## Variables

| Variable | Description |
| ------ | ------ |
| [SIDE\_QUEST\_TOOL\_NAME](variables/SIDE_QUEST_TOOL_NAME.md) | Well-known name for the auto-injected agent-triggered side-quest proposal tool. |

## Functions

| Function | Description |
| ------ | ------ |
| [anthropicApiAdapter](functions/anthropicApiAdapter.md) | Raw Anthropic Messages API adapter — drives the model→tool loop by hand with `messages.create` for `runUntilPhaseEnd`, and a single forced-tool call for `runStructured`. |
| [claudeAgentAdapter](functions/claudeAgentAdapter.md) | Claude Agent SDK adapter — drives the model loop via the SDK's `query()` for both `runUntilPhaseEnd` and `runStructured` (the latter as a one-shot query forced through a single `submit` tool). |
| [openaiCompatAdapter](functions/openaiCompatAdapter.md) | Build an [Adapter](interfaces/Adapter.md) that talks to an OpenAI-style chat endpoint. |
| [validate](functions/validate.md) | Validate and compile an [AgentDecl](interfaces/AgentDecl.md). Throws [CompileError](classes/CompileError.md) on structural problems (cycles, duplicates, illegal terminator/review combos). |
| [tool](functions/tool.md) | Define a plain tool the model may call. The handler's return value is passed back to the model as the tool result (stringified if not already a string). |
| [subAgent](functions/subAgent.md) | Define a sub-agent the parent can call as a tool. The sub-agent's pipeline runs as a child AgentRun; its final phase's deliverable becomes the tool result returned to the parent model. |
| [customSubAgent](functions/customSubAgent.md) | Define a custom-handler sub-agent. The handler runs TypeScript directly (instead of a phased pipeline) and may spawn nested child agents via `ctx.runChild`. Output is validated against `output` before being returned. |
| [checklist](functions/checklist.md) | Define a checklist gate for a phase. The session's `localModel` adapter runs the checklist after the deliverable is produced; failing checks trigger a phase re-run with the failure attached as feedback. |
| [phase](functions/phase.md) | Define a phase. Optional fields default sensibly: - `tools` defaults to `[]` (the agent's global tools are still available) - `terminator` defaults to `{ kind: "tool" }` - `turnBudget` defaults to the framework default if unset |
| [agent](functions/agent.md) | Define an agent: an ordered list of phases and (optionally) global tools shared by every phase. An optional `adapter` overrides the session default for every phase in this agent. |
| [validateAgainstSchema](functions/validateAgainstSchema.md) | Validate a value against a JSON Schema using `@cfworker/json-schema`. Returns a structured result; errors are stringified as `"<location>: <message>"`. |
| [createTracer](functions/createTracer.md) | Build a `TraceCallback` suitable for `Hooks.trace`. Useful when bridging the framework's bus to an external observability system or to stdout — for example, when running AgentPipeline as a subprocess of a host that consumes NDJSON on stdout. |
