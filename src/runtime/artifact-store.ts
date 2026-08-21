/**
 * Results produced by contracted children, held for the run.
 *
 * This is how work moves sideways in a tree that has no sideways edges. A
 * coordinator cannot let two children talk to each other without losing the
 * ability to say who caused what, so instead an accepted result is stored under
 * the run that produced it, and a later contract names the key it may read.
 * The reference travels; the payload does not have to.
 *
 * Only the framework writes, and only on acceptance, so every entry has exactly
 * one author and nothing can be overwritten by a child that ran later.
 */
export class ArtifactStore {
  private readonly items = new Map<string, Artifact>();

  /** Record an accepted result. Ignores a key that already exists. */
  put(artifact: Artifact): void {
    if (this.items.has(artifact.key)) return;
    this.items.set(artifact.key, artifact);
  }

  get(key: string): Artifact | undefined {
    return this.items.get(key);
  }

  has(key: string): boolean {
    return this.items.has(key);
  }

  /** What exists, without the payloads. */
  index(): readonly ArtifactSummary[] {
    return [...this.items.values()].map(({ key, childAgent, objective }) => ({
      key,
      childAgent,
      objective,
    }));
  }
}

/** One stored result, keyed by the run path that produced it. */
export interface Artifact {
  /** The producing run's path, e.g. `root.2`. */
  readonly key: string;
  readonly childAgent: string;
  /** What that child was contracted to achieve. */
  readonly objective: string;
  readonly value: unknown;
}

/** An entry without its payload, for listing what a run has produced. */
export interface ArtifactSummary {
  readonly key: string;
  readonly childAgent: string;
  readonly objective: string;
}
