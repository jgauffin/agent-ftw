/**
 * Writes each run's trace stream to disk as NDJSON.
 *
 * The framework's bus is fire-and-forget: an event nobody subscribed to is
 * gone. A design loop needs to compare the run before a change with the run
 * after it, so the studio keeps every run rather than only the live one.
 *
 * One JSON object per line, appended, so a run that crashes half way still
 * leaves everything up to the crash readable.
 */

import { createWriteStream, type WriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { TraceEnvelope } from "../protocol.js";

export class RunStore {
  private stream: WriteStream | null = null;
  private currentPath: string | null = null;

  constructor(private readonly directory: string) {}

  /** Directory sessions are persisted under, which is what makes pinning possible. */
  get sessionDirectory(): string {
    return path.join(this.directory, "sessions");
  }

  get runsDirectory(): string {
    return path.join(this.directory, "runs");
  }

  async begin(agentName: string, startedAt: number): Promise<string> {
    await this.end();
    await fs.mkdir(this.runsDirectory, { recursive: true });
    const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
    this.currentPath = path.join(this.runsDirectory, `${sanitize(agentName)}-${stamp}.ndjson`);
    this.stream = createWriteStream(this.currentPath, { flags: "a" });
    return this.currentPath;
  }

  append(event: TraceEnvelope): void {
    this.stream?.write(`${JSON.stringify(event)}\n`);
  }

  async end(): Promise<void> {
    const stream = this.stream;
    this.stream = null;
    if (!stream) return;
    await new Promise<void>((resolve) => stream.end(resolve));
  }

  /** Read a stored run back, for reopening it in the panel. */
  static async read(file: string): Promise<TraceEnvelope[]> {
    const raw = await fs.readFile(file, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as TraceEnvelope);
  }

  /** Stored runs, newest first. */
  async list(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.runsDirectory);
      return entries
        .filter((e) => e.endsWith(".ndjson"))
        .sort()
        .reverse()
        .map((e) => path.join(this.runsDirectory, e));
    } catch {
      return [];
    }
  }
}

/** Same conservative rule the library uses for session paths. */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}
