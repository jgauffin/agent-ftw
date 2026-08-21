# Interface: BudgetExtensionRequest

Defined in: [hooks/index.ts:35](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L35)

Snapshot handed to `Hooks.requestBudgetExtension` so the host can decide
whether to grant more turns. The host owns the policy — it may consult its
own user, apply a fixed cap, or refuse outright.

## Properties

### agent

```ts
readonly agent: string;
```

Defined in: [hooks/index.ts:36](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L36)

***

### phase

```ts
readonly phase: string;
```

Defined in: [hooks/index.ts:37](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L37)

***

### runId

```ts
readonly runId: string;
```

Defined in: [hooks/index.ts:38](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L38)

***

### originalBudget

```ts
readonly originalBudget: number;
```

Defined in: [hooks/index.ts:40](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L40)

The phase's configured turn budget (or framework default if unset).

***

### turnsUsed

```ts
readonly turnsUsed: number;
```

Defined in: [hooks/index.ts:42](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L42)

Total turns the phase has consumed so far (original + prior extensions).

***

### extensionsGranted

```ts
readonly extensionsGranted: number;
```

Defined in: [hooks/index.ts:44](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L44)

How many extensions have already been granted in this phase.

***

### suggestedExtension

```ts
readonly suggestedExtension: number;
```

Defined in: [hooks/index.ts:46](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L46)

What the framework would grant by default (= originalBudget).

***

### recentActivity

```ts
readonly recentActivity: BudgetExtensionRecentActivity;
```

Defined in: [hooks/index.ts:48](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L48)

Most recent activity, summarized for display.

***

### deliverableSchema

```ts
readonly deliverableSchema: JSONSchema;
```

Defined in: [hooks/index.ts:50](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L50)

JSON schema the phase is trying to produce — useful context for the decision.
