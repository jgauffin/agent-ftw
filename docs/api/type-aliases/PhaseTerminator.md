# Type Alias: PhaseTerminator

```ts
type PhaseTerminator = 
  | {
  kind: "tool";
}
  | {
  kind: "external";
  await: (ctx: TerminatorCtx) => Promise<unknown>;
};
```

Defined in: [declare/index.ts:203](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L203)

How a phase decides it is finished.

  - `tool` (default): the framework injects a `finish_<phase>` tool; the model
    calls it with the deliverable and the loop ends.

  - `external`: the host resolves a promise with the deliverable. Useful when
    the deliverable is lifted from a host-managed live state (UI button, IPC,
    etc.) rather than produced by the agent. In this mode the phase-end tool
    is NOT exposed to the model — the model is expected to act on the live
    state via other tools and the host completes the phase out-of-band.
    The system prompt is also shortened (no "call finish_X" line).
