# Interface: OpenAICompatConfig

Defined in: [adapters/openai-compat.ts:41](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/openai-compat.ts#L41)

Configuration for [openaiCompatAdapter](../functions/openaiCompatAdapter.md). Works with any endpoint that
implements the OpenAI `/chat/completions` shape: OpenAI itself, Ollama
(`http://localhost:11434/v1`), LM Studio, vLLM, Together, etc.

## Properties

### baseUrl

```ts
readonly baseUrl: string;
```

Defined in: [adapters/openai-compat.ts:43](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/openai-compat.ts#L43)

Base URL ending in `/v1`. E.g. `http://localhost:11434/v1`.

***

### model

```ts
readonly model: string;
```

Defined in: [adapters/openai-compat.ts:45](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/openai-compat.ts#L45)

Model id sent in the `model` field of the request.

***

### apiKey?

```ts
readonly optional apiKey?: string;
```

Defined in: [adapters/openai-compat.ts:47](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/openai-compat.ts#L47)

Optional bearer token. Skip for local endpoints that don't need auth.

***

### temperature?

```ts
readonly optional temperature?: number;
```

Defined in: [adapters/openai-compat.ts:48](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/openai-compat.ts#L48)

***

### fetch?

```ts
readonly optional fetch?: {
  (input: URL | RequestInfo, init?: RequestInit): Promise<Response>;
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
};
```

Defined in: [adapters/openai-compat.ts:50](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/openai-compat.ts#L50)

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
