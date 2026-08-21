/**
 * Turn accounting across a whole run tree.
 *
 * A phase's `turnBudget` limits that one phase's model loop. It says nothing
 * about the tree: a sub-agent starts with a fresh budget of its own, so without
 * a ledger the total turns a nested agent tree can spend is unbounded.
 *
 * The ledger is the second, harder gate. Every {@link AgentRun} is a node; a
 * node either holds a balance of its own or draws from the nearest ancestor
 * that does. Consumption is conserved: turns spent anywhere in the subtree come
 * out of one pool, so no arrangement of sub-agents can spend more than the root
 * was given.
 *
 * Only a human-granted extension adds turns (see `grant`). Nothing inside the
 * run can mint them, which is what makes the root budget an actual ceiling
 * rather than a suggestion.
 */
export class TurnLedger {
  private readonly nodes = new Map<string, LedgerNode>();

  /**
   * Open the root pool. `budget` of `Infinity` leaves the run ungoverned, which
   * is the default when the host sets no session turn budget.
   */
  createRoot(path: string, budget: number): void {
    this.nodes.set(path, { path, parent: null, remaining: budget });
  }

  /**
   * Register a child run. With no balance of its own it draws from its parent,
   * so a plain sub-agent spends from the same pool as the agent that called it.
   */
  createChild(path: string, parentPath: string): void {
    this.nodes.set(path, { path, parent: parentPath, remaining: null });
  }

  /**
   * Give a registered child a balance of its own, taken out of its parent's.
   * Conservation lives here: the turns leave the parent at reservation time, so
   * the sum of everything outstanding can never exceed what the parent held.
   *
   * Returns false when the parent cannot cover it, in which case nothing moves.
   */
  reserve(path: string, turns: number): boolean {
    const node = this.nodes.get(path);
    if (!node || node.parent === null) return false;
    const source = this.holder(node.parent);
    if (!source || source.remaining < turns) return false;
    source.remaining -= turns;
    // Additive, so a top-up on a partly-spent balance adds to it rather than
    // replacing it.
    node.remaining = (node.remaining ?? 0) + turns;
    return true;
  }

  /**
   * Hand a child's unspent turns back to its parent and close its balance.
   * Without this, an under-spending child would strand the difference.
   */
  release(path: string): void {
    const node = this.nodes.get(path);
    if (!node || node.remaining === null || node.parent === null) return;
    const source = this.holder(node.parent);
    if (source) source.remaining += node.remaining;
    node.remaining = null;
  }

  /**
   * Spend one turn against whichever node holds this path's balance. Returns
   * false when that pool is dry; the caller decides whether to raise or to ask
   * for an extension.
   */
  tryConsume(path: string): boolean {
    const holder = this.holder(path);
    if (!holder) return true; // Nothing governs this path.
    if (holder.remaining <= 0) return false;
    holder.remaining -= 1;
    return true;
  }

  /** Add turns to whichever node holds this path's balance. */
  grant(path: string, turns: number): void {
    const holder = this.holder(path);
    if (holder) holder.remaining += turns;
  }

  /** Turns left in the pool this path draws from. `Infinity` when ungoverned. */
  remaining(path: string): number {
    return this.holder(path)?.remaining ?? Infinity;
  }

  /**
   * Path of the node whose balance this path actually spends. Differs from
   * `path` whenever a run draws from an ancestor, which is what the host needs
   * to know to make sense of an exhaustion.
   */
  holderPath(path: string): string | null {
    return this.holder(path)?.path ?? null;
  }

  private holder(path: string): MutableNode | null {
    let node = this.nodes.get(path);
    while (node && node.remaining === null) {
      node = node.parent === null ? undefined : this.nodes.get(node.parent);
    }
    return (node as MutableNode | undefined) ?? null;
  }
}

interface LedgerNode {
  readonly path: string;
  readonly parent: string | null;
  /** `null` means "no balance of my own, draw from my parent". */
  remaining: number | null;
}

/** A node known to hold a balance. */
type MutableNode = LedgerNode & { remaining: number };
