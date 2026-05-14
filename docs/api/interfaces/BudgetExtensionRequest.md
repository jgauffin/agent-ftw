# Interface: BudgetExtensionRequest

Defined in: hooks/index.ts:35

Snapshot handed to `Hooks.requestBudgetExtension` so the host can decide
whether to grant more turns. The host owns the policy — it may consult its
own user, apply a fixed cap, or refuse outright.

## Properties

### agent

```ts
readonly agent: string;
```

Defined in: hooks/index.ts:36

***

### phase

```ts
readonly phase: string;
```

Defined in: hooks/index.ts:37

***

### runId

```ts
readonly runId: string;
```

Defined in: hooks/index.ts:38

***

### originalBudget

```ts
readonly originalBudget: number;
```

Defined in: hooks/index.ts:40

The phase's configured turn budget (or framework default if unset).

***

### turnsUsed

```ts
readonly turnsUsed: number;
```

Defined in: hooks/index.ts:42

Total turns the phase has consumed so far (original + prior extensions).

***

### extensionsGranted

```ts
readonly extensionsGranted: number;
```

Defined in: hooks/index.ts:44

How many extensions have already been granted in this phase.

***

### suggestedExtension

```ts
readonly suggestedExtension: number;
```

Defined in: hooks/index.ts:46

What the framework would grant by default (= originalBudget).

***

### recentActivity

```ts
readonly recentActivity: BudgetExtensionRecentActivity;
```

Defined in: hooks/index.ts:48

Most recent activity, summarized for display.

***

### deliverableSchema

```ts
readonly deliverableSchema: JSONSchema;
```

Defined in: hooks/index.ts:50

JSON schema the phase is trying to produce — useful context for the decision.
