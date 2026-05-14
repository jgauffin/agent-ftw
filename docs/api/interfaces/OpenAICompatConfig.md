# Interface: OpenAICompatConfig

Defined in: adapters/openai-compat.ts:41

Configuration for [openaiCompatAdapter](../functions/openaiCompatAdapter.md). Works with any endpoint that
implements the OpenAI `/chat/completions` shape: OpenAI itself, Ollama
(`http://localhost:11434/v1`), LM Studio, vLLM, Together, etc.

## Properties

### baseUrl

```ts
readonly baseUrl: string;
```

Defined in: adapters/openai-compat.ts:43

Base URL ending in `/v1`. E.g. `http://localhost:11434/v1`.

***

### model

```ts
readonly model: string;
```

Defined in: adapters/openai-compat.ts:45

Model id sent in the `model` field of the request.

***

### apiKey?

```ts
readonly optional apiKey?: string;
```

Defined in: adapters/openai-compat.ts:47

Optional bearer token. Skip for local endpoints that don't need auth.

***

### temperature?

```ts
readonly optional temperature?: number;
```

Defined in: adapters/openai-compat.ts:48

***

### fetch?

```ts
readonly optional fetch?: {
  (input: URL | RequestInfo, init?: RequestInit): Promise<Response>;
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
};
```

Defined in: adapters/openai-compat.ts:50

Inject a custom `fetch` implementation. Tests use this; production code rarely needs to.

#### Call Signature

```ts
(input: URL | RequestInfo, init?: RequestInit): Promise<Response>;
```

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | `URL` \| `RequestInfo` |
| `init?` | `RequestInit` |

##### Returns

`Promise`\<`Response`\>

#### Call Signature

```ts
(input: string | URL | Request, init?: RequestInit): Promise<Response>;
```

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | `string` \| `URL` \| `Request` |
| `init?` | `RequestInit` |

##### Returns

`Promise`\<`Response`\>
