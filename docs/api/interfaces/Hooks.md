# Interface: Hooks

Defined in: hooks/index.ts:85

Host callbacks the framework invokes during a run. Required: `askUser`.
Everything else is optional.

The same `Hooks` instance is shared by every agent and phase in the session;
the framework supplies an [AskCtx](AskCtx.md) / [ReviewCtx](ReviewCtx.md) so the host can
route the call appropriately.

## Methods

### askUser()

```ts
askUser(input: AskUserInput, ctx: AskCtx): Promise<AskUserResult>;
```

Defined in: hooks/index.ts:87

Prompt the user. Calls are queued FIFO across concurrent agents in the same session.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`AskUserInput`](AskUserInput.md) |
| `ctx` | [`AskCtx`](AskCtx.md) |

#### Returns

`Promise`\<[`AskUserResult`](AskUserResult.md)\>

***

### review()?

```ts
optional review(deliverable: unknown, ctx: ReviewCtx): Promise<void>;
```

Defined in: hooks/index.ts:93

Drives the review chat. Resolves when the user approves the current deliverable.
For each user chat message, call ctx.requestRevision(text) and surface the
returned deliverable in the UI.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `deliverable` | `unknown` |
| `ctx` | [`ReviewCtx`](ReviewCtx.md) |

#### Returns

`Promise`\<`void`\>

***

### requestBudgetExtension()?

```ts
optional requestBudgetExtension(req: BudgetExtensionRequest): Promise<BudgetExtensionResponse>;
```

Defined in: hooks/index.ts:100

Called when a phase exhausts its turn budget. The host decides whether to
grant more turns (and how many), or to let the phase fail. If unset, an
exhausted phase fails with TurnBudgetExhausted — the framework does not
fall back to a generic askUser prompt.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | [`BudgetExtensionRequest`](BudgetExtensionRequest.md) |

#### Returns

`Promise`\<[`BudgetExtensionResponse`](../type-aliases/BudgetExtensionResponse.md)\>

***

### trace()?

```ts
optional trace(event: TraceEvent): void;
```

Defined in: hooks/index.ts:102

Receives every [TraceEvent](../type-aliases/TraceEvent.md) the framework emits. See `createTracer`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | [`TraceEvent`](../type-aliases/TraceEvent.md) |

#### Returns

`void`
