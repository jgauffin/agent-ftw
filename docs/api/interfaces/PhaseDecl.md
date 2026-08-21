# Interface: PhaseDecl

Defined in: [declare/index.ts:239](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L239)

A single stage in an agent pipeline. Created via [phase](../functions/phase.md).

A phase runs against a fresh model context (system prompt + `prompt` + prior
phases' deliverables, *not* prior phases' raw chat). It ends when the model
calls the auto-injected `finish_<name>` tool with a JSON payload that
validates against `deliverable`, or when the turn budget is exhausted, or
(for `external` terminators) when the host resolves the await callback.

## Properties

### kind

```ts
readonly kind: "phase";
```

Defined in: [declare/index.ts:240](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L240)

***

### name

```ts
readonly name: string;
```

Defined in: [declare/index.ts:242](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L242)

Phase name. Unique within an agent. Used to derive the `finish_<name>` tool.

***

### prompt

```ts
readonly prompt: string;
```

Defined in: [declare/index.ts:244](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L244)

The phase's user-visible task description. Appended after the framework's system prompt.

***

### deliverable

```ts
readonly deliverable: JSONSchema;
```

Defined in: [declare/index.ts:246](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L246)

JSON Schema the deliverable must satisfy. Phase doesn't end until the model emits a valid payload.

***

### tools

```ts
readonly tools: readonly (
  | ToolDecl
  | SubAgentDecl
  | CustomSubAgentDecl)[];
```

Defined in: [declare/index.ts:248](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L248)

Tools available to the model during this phase, in addition to the agent's global tools.

***

### adapter?

```ts
readonly optional adapter?: Adapter;
```

Defined in: [declare/index.ts:250](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L250)

Adapter override for this phase's model loop. Falls back to the agent's adapter, then the session default.

***

### checklist?

```ts
readonly optional checklist?: ChecklistDecl;
```

Defined in: [declare/index.ts:252](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L252)

Optional LLM-as-judge gate. Failing checks trigger a re-run with feedback.

***

### turnBudget?

```ts
readonly optional turnBudget?: number;
```

Defined in: [declare/index.ts:254](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L254)

Max model turns before `TurnBudgetExhausted` is raised. Framework default applies if unset.

***

### review?

```ts
readonly optional review?: boolean;
```

Defined in: [declare/index.ts:256](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L256)

If `true`, the host's `Hooks.review` callback drives a review chat after the deliverable validates. Top-level phases only.

***

### terminator?

```ts
readonly optional terminator?: PhaseTerminator;
```

Defined in: [declare/index.ts:258](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L258)

How the phase decides it is done. Defaults to `{ kind: "tool" }`.

***

### onAssistantText?

```ts
readonly optional onAssistantText?: OnAssistantText;
```

Defined in: [declare/index.ts:260](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L260)

Override for model turns that emit text without tool calls. See [OnAssistantText](../type-aliases/OnAssistantText.md).

***

### phaseEndToolName?

```ts
readonly optional phaseEndToolName?: string;
```

Defined in: [declare/index.ts:262](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L262)

Override the auto-generated phase-end tool name. Defaults to `finish_<name>`.
