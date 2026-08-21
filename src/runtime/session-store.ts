import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { Turn } from "../adapters/types.js";

/**
 * Mutable persistence record for a single session. Written to
 * `{sessionDirectory}/{agentName}/{sessionId}/meta.json` after each phase
 * boundary. Hosts usually don't construct this directly — use
 * {@link Session.listSessions} to enumerate persisted sessions.
 */
export interface SessionMeta {
  readonly sessionId: string;
  readonly agentName: string;
  readonly createdAt: number;
  updatedAt: number;
  status: "running" | "complete" | "aborted" | "error";
  /** Phase names whose deliverables are stored in deliverables.json. */
  completedPhases: string[];
  /** Phase currently in progress, if any. */
  currentPhase: string | null;
  /** Per-adapter scratchpad (e.g. Claude SDK session ids keyed by phase). */
  adapterMeta: Record<string, unknown>;
}

/**
 * Read-only snapshot returned by {@link Session.listSessions}. Carries the
 * fields a host UI typically renders (creation/update timestamps, current
 * phase, completion progress) without exposing adapter-internal metadata.
 */
export interface SessionInfo {
  readonly sessionId: string;
  readonly agentName: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly status: SessionMeta["status"];
  readonly currentPhase: string | null;
  readonly completedPhases: readonly string[];
}

interface DeliverablesFile {
  readonly deliverables: Record<string, unknown>;
}

interface PhaseFile {
  readonly conversation: readonly Turn[];
}

const META_FILE = "meta.json";
const DELIVERABLES_FILE = "deliverables.json";
const PHASES_DIR = "phases";
const JOURNAL_FILE = "journal.ndjson";

/**
 * One delegated piece of work and how it ended, recorded as it happens.
 *
 * Enough to reconstruct who was asked to do what, with which authority and
 * budget, and why the parent accepted or refused it.
 */
export interface JournalEntry {
  readonly at: number;
  /** Run path of the child, e.g. `root.2`. */
  readonly runPath: string;
  readonly parentRunPath: string;
  readonly childAgent: string;
  readonly objective: string;
  readonly turns: number;
  readonly writeSet: readonly string[];
  readonly outcome: "accepted" | "rejected" | "abandoned" | "blocked" | "error";
  /** Why it was refused, or what blocked it. */
  readonly reason?: string;
}

export class SessionStore {
  readonly root: string;

  constructor(
    readonly directory: string,
    readonly agentName: string,
    readonly sessionId: string
  ) {
    this.root = path.join(directory, sanitize(agentName), sanitize(sessionId));
  }

  private get metaPath(): string {
    return path.join(this.root, META_FILE);
  }

  private get deliverablesPath(): string {
    return path.join(this.root, DELIVERABLES_FILE);
  }

  private phasePath(name: string): string {
    return path.join(this.root, PHASES_DIR, `${sanitize(name)}.json`);
  }

  private get journalPath(): string {
    return path.join(this.root, JOURNAL_FILE);
  }

  /**
   * Append one delegation record. Sub-agent runs are not otherwise persisted,
   * so without this a finished tree leaves no trace of who was asked to do
   * what, which is exactly what a post-mortem needs.
   *
   * Newline-delimited JSON, appended, so a crash mid-run still leaves every
   * completed record readable.
   */
  async appendJournal(entry: JournalEntry): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    await fs.appendFile(this.journalPath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  /** Every delegation record for this session, oldest first. */
  async loadJournal(): Promise<readonly JournalEntry[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.journalPath, "utf8");
    } catch {
      return [];
    }
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as JournalEntry);
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.metaPath);
      return true;
    } catch {
      return false;
    }
  }

  async loadMeta(): Promise<SessionMeta | null> {
    return await readJson<SessionMeta>(this.metaPath);
  }

  async loadDeliverables(): Promise<Record<string, unknown>> {
    const f = await readJson<DeliverablesFile>(this.deliverablesPath);
    return f?.deliverables ?? {};
  }

  async loadPhaseConversation(name: string): Promise<readonly Turn[] | null> {
    const f = await readJson<PhaseFile>(this.phasePath(name));
    return f ? f.conversation : null;
  }

  async initIfMissing(): Promise<SessionMeta> {
    const existing = await this.loadMeta();
    if (existing) return existing;
    const now = Date.now();
    const meta: SessionMeta = {
      sessionId: this.sessionId,
      agentName: this.agentName,
      createdAt: now,
      updatedAt: now,
      status: "running",
      completedPhases: [],
      currentPhase: null,
      adapterMeta: {},
    };
    await fs.mkdir(path.join(this.root, PHASES_DIR), { recursive: true });
    await writeJson(this.metaPath, meta);
    await writeJson(this.deliverablesPath, { deliverables: {} } satisfies DeliverablesFile);
    return meta;
  }

  async saveMeta(meta: SessionMeta): Promise<void> {
    meta.updatedAt = Date.now();
    await writeJson(this.metaPath, meta);
  }

  async savePhaseConversation(name: string, conversation: readonly Turn[]): Promise<void> {
    await fs.mkdir(path.join(this.root, PHASES_DIR), { recursive: true });
    await writeJson(this.phasePath(name), { conversation } satisfies PhaseFile);
  }

  async saveDeliverable(phaseName: string, payload: unknown): Promise<void> {
    const current = await this.loadDeliverables();
    current[phaseName] = payload;
    await writeJson(this.deliverablesPath, { deliverables: current } satisfies DeliverablesFile);
  }

  async deletePhaseConversation(name: string): Promise<void> {
    try {
      await fs.unlink(this.phasePath(name));
    } catch {
      // ignore — file may not exist
    }
  }

  static async list(directory: string, agentName?: string): Promise<SessionInfo[]> {
    const out: SessionInfo[] = [];
    const agentDirs = agentName
      ? [sanitize(agentName)]
      : await safeReaddir(directory);
    for (const a of agentDirs) {
      const agentRoot = path.join(directory, a);
      const sessionDirs = await safeReaddir(agentRoot);
      for (const s of sessionDirs) {
        const metaPath = path.join(agentRoot, s, META_FILE);
        const meta = await readJson<SessionMeta>(metaPath);
        if (!meta) continue;
        if (agentName && meta.agentName !== agentName) continue;
        out.push({
          sessionId: meta.sessionId,
          agentName: meta.agentName,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          status: meta.status,
          currentPhase: meta.currentPhase,
          completedPhases: meta.completedPhases,
        });
      }
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  }
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function writeJson(p: string, value: unknown): Promise<void> {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  // Atomic write: write to .tmp, rename. Avoids half-written files on crash.
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, p);
}

async function safeReaddir(p: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(p, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

/** Conservative sanitization to prevent path traversal via agent/session names. */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}
