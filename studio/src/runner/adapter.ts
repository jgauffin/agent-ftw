/**
 * The studio runs an agent against the adapters the agent itself declares.
 * That is the point of per-phase model routing: a tree tuned in the studio
 * against a different model is a tree you have not actually tested.
 *
 * `Session` still requires a `defaultAdapter`, so a phase that declares none,
 * and whose agent declares none, would silently fall through to whatever the
 * host passed. This stands in that slot and refuses instead, naming the phase
 * that needs an adapter.
 */

/** Structural copy of the library's `Adapter`; the studio never imports the type. */
export interface AdapterLike {
  runUntilPhaseEnd(ctx: unknown): Promise<unknown>;
  runStructured(args: unknown): Promise<unknown>;
  dispose?(): Promise<void>;
}

export function undeclaredAdapter(agentName: string): AdapterLike {
  return {
    async runUntilPhaseEnd(ctx: unknown): Promise<never> {
      throw new Error(explain(agentName, phaseNameOf(ctx)));
    },
    async runStructured(): Promise<never> {
      throw new Error(
        `Agent "${agentName}" ran a checklist but declares no adapter. ` +
          `Give the checklist its own \`adapter\`, or declare one on the phase or the agent.`
      );
    },
  };
}

function explain(agentName: string, phaseName: string | null): string {
  const where = phaseName ? `Phase "${phaseName}" of agent "${agentName}"` : `Agent "${agentName}"`;
  return (
    `${where} reached the model loop with no adapter declared anywhere above it. ` +
    `The studio runs whatever the agent declares and does not substitute one of its own. ` +
    `Add \`adapter\` to the phase, or to the agent so every phase inherits it.`
  );
}

/**
 * `RunContext` carries no phase name of its own. Persistence does, and the
 * studio always enables it; the phase-end tool name is the fallback.
 */
function phaseNameOf(ctx: unknown): string | null {
  const c = ctx as {
    persistence?: { phaseName?: string };
    phaseEndToolName?: string;
  };
  if (c?.persistence?.phaseName) return c.persistence.phaseName;
  const endTool = c?.phaseEndToolName;
  if (typeof endTool === "string" && endTool.startsWith("finish_")) return endTool.slice("finish_".length);
  return null;
}
