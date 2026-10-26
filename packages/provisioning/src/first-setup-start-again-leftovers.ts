import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { canonicalFirstSetupRoots } from "./first-setup-resolution.js";
import {
  collectStartAgainFindings,
  type StartAgainFinding,
} from "./first-setup-start-again-deletion.js";
import { parseState } from "./first-setup-state.js";
import "./errors.js";

export interface StartAgainEntry {
  /** Relative to the unit's root folder, "/"-separated. */
  readonly path: string;
  readonly type: "file" | "folder";
  readonly ino: string;
  readonly size: string | null;
  /** Files only: a folder is bound by its inode and the entries under it. */
  readonly mtimeNs: string | null;
}
export interface StartAgainUnit {
  readonly root: "venue" | "state";
  readonly path: string;
  readonly why: "not-created" | "changed";
  /** Top-level paths renamed one by one, in move order: a database's main file goes last. */
  readonly pieces: readonly string[];
  /** Every piece and everything under it, sorted by path. */
  readonly entries: readonly StartAgainEntry[];
}
export type StartAgainSurvey =
  | {
      readonly kind: "choice";
      readonly attemptId: string;
      readonly frozenDigest: string;
      readonly markerSha256: string;
      readonly units: readonly StartAgainUnit[];
      readonly digest: string;
      readonly noteFloorMs: number | null;
    }
  | { readonly kind: "explain"; readonly reason: string };
type Choice = Extract<StartAgainSurvey, { kind: "choice" }>;

export const START_AGAIN_ENTRY_LIMIT = 20_000;
/** A1099's approved margin, 2½ minutes. */
export const START_AGAIN_FLOOR_MARGIN_MS = 150_000;

type Root = "venue" | "state";
type Roots = { stateDir: string; venueDir: string };

const RECORDS = "first-setup-resolutions";
const SETUP_RECORD = "first-setup.json";
const DATABASES = ["venue.db", "node.db"] as const;
const SIDE_PIECES = ["-wal", "-shm", "-journal"] as const;
const LOCKS = new Set([
  "venue.lock",
  "venue.lock-journal",
  "venue.holder.json",
  "migrations.lock",
  "recovery.lock",
]);
const STEP = /^step-\d{6}$/;
const MINUTE_NS = 60_000_000_000n;

class Explain extends Error {}

const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const rootDir = (roots: Roots, root: Root) => (root === "venue" ? roots.venueDir : roots.stateDir);
const field = (error: unknown, name: "code" | "path") =>
  error !== null && typeof error === "object"
    ? (error as Record<string, unknown>)[name]
    : undefined;
const missing = (error: unknown) => field(error, "code") === "ENOENT";
/** Paths and keys are unique within each sort, so no two compare equal. */
const byText = (a: string, b: string) => (a < b ? -1 : 1);

async function lstatOrNull(path: string) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

export function startAgainSetAsideFloorMs(units: readonly StartAgainUnit[]): number | null {
  let newest: bigint | null = null;
  for (const unit of units)
    for (const entry of unit.entries)
      if (entry.mtimeNs !== null && (newest === null || BigInt(entry.mtimeNs) > newest))
        newest = BigInt(entry.mtimeNs);
  if (newest === null) return null;
  const floor = newest + BigInt(START_AGAIN_FLOOR_MARGIN_MS) * 1_000_000n;
  const minutes = (floor + MINUTE_NS - 1n) / MINUTE_NS;
  return Number(minutes * 60_000n);
}

type Draft = { root: Root; path: string; why: StartAgainUnit["why"]; database: boolean };

/** The folder a record file's unit is: the record folder, or its step folder, when the marker names nothing in it. */
function recordUnitPath(name: string, markedState: readonly string[]): string {
  const parts = name.split("/");
  if (parts[0] !== RECORDS || parts.length < 3) return name;
  const record = `${RECORDS}/${parts[1]}`;
  if (!markedState.some((marked) => marked.startsWith(`${record}/`))) return record;
  if (parts.length === 4 && STEP.test(parts[2]!)) {
    const step = `${record}/${parts[2]}`;
    if (!markedState.some((marked) => marked.startsWith(`${step}/`))) return step;
  }
  return name;
}

function draftsOf(
  findings: readonly StartAgainFinding[],
  marked: ReadonlySet<string>,
  markedState: readonly string[],
): Draft[] {
  const drafts = new Map<string, Draft>();
  const add = (draft: Draft) => {
    const key = `${draft.root}:${draft.path}`;
    if (!drafts.has(key)) drafts.set(key, draft);
  };
  for (const finding of findings) {
    if (finding.kind === "wal") {
      const database = finding.name.slice(0, -"-wal".length);
      add({
        root: "venue",
        path: database,
        why: marked.has(`venue:${database}`) ? "changed" : "not-created",
        database: true,
      });
      continue;
    }
    if (finding.root === "state" && finding.name === SETUP_RECORD)
      throw new Explain("setup record changed");
    const database =
      finding.root === "venue" && (DATABASES as readonly string[]).includes(finding.name);
    const why = finding.kind === "changed" ? "changed" : "not-created";
    const path =
      finding.kind === "unlisted" && finding.root === "state"
        ? recordUnitPath(finding.name, markedState)
        : finding.name;
    add({ root: finding.root, path, why, database });
  }
  return [...drafts.values()];
}

async function walk(
  roots: Roots,
  root: Root,
  path: string,
  into: StartAgainEntry[],
  budget: { left: number },
  top = true,
): Promise<boolean> {
  const full = join(rootDir(roots, root), path);
  const info = await lstatOrNull(full);
  if (info === null) {
    // A child readdir named but lstat cannot find would otherwise move with its folder, unlisted.
    if (!top) throw new Explain(`unit entry not found: ${root}/${path}`);
    return false;
  }
  if (--budget.left < 0) throw new Explain("too many entries");
  const name = path.split("/").at(-1)!;
  if (LOCKS.has(name)) throw new Explain(`unit holds a lock file: ${root}/${path}`);
  if (info.isSymbolicLink() || !(info.isFile() || info.isDirectory()))
    throw new Explain(`unit holds a link or special file: ${root}/${path}`);
  if (info.isFile()) {
    into.push({
      path,
      type: "file",
      ino: info.ino.toString(),
      size: info.size.toString(),
      mtimeNs: info.mtimeNs.toString(),
    });
    return true;
  }
  into.push({ path, type: "folder", ino: info.ino.toString(), size: null, mtimeNs: null });
  for (const child of (await readdir(full)).sort())
    await walk(roots, root, `${path}/${child}`, into, budget, false);
  return true;
}

async function unitOf(
  roots: Roots,
  draft: Draft,
  budget: { left: number },
): Promise<StartAgainUnit> {
  const candidates = draft.database
    ? [...SIDE_PIECES.map((suffix) => `${draft.path}${suffix}`), draft.path]
    : [draft.path];
  const pieces: string[] = [];
  const entries: StartAgainEntry[] = [];
  for (const piece of candidates)
    if (await walk(roots, draft.root, piece, entries, budget)) pieces.push(piece);
  entries.sort((a, b) => byText(a.path, b.path));
  return { root: draft.root, path: draft.path, why: draft.why, pieces, entries };
}

async function setupRecordParses(roots: Roots, attemptId: string, frozenDigest: string) {
  const bytes = await readFile(join(roots.stateDir, SETUP_RECORD)).catch((error: unknown) => {
    throw missing(error) ? new Explain("setup record gone") : error;
  });
  try {
    const state = parseState(JSON.parse(bytes.toString("utf8")), roots.venueDir, roots.stateDir);
    if (state.frozen.attemptId !== attemptId || state.frozenDigest !== frozenDigest)
      throw new Explain("setup record names another attempt");
  } catch (error) {
    if (error instanceof Explain) throw error;
    throw new Explain("setup record unparseable");
  }
}

/**
 * What a Move would set aside after a cut-off Start again, or why the page can only explain.
 * Binds the found files by their metadata only: a change that keeps a file's inode, size and time
 * is not seen.
 */
export async function surveyStartAgainLeftovers(roots: Roots): Promise<StartAgainSurvey | null> {
  try {
    const canonical = await canonicalFirstSetupRoots(roots);
    const collected = await collectStartAgainFindings(canonical);
    if (collected === null) return null;
    const { marker, markerSha256, findings, blocker } = collected;
    if (blocker !== null) throw new Explain(blocker.reason ?? blocker.code);
    const marked = new Set(marker.files.map((file) => `${file.root}:${file.name}`));
    if (!marked.has(`state:${SETUP_RECORD}`)) throw new Explain("setup record not marked");
    const markedState = marker.files.filter((file) => file.root === "state").map((f) => f.name);
    const drafts = draftsOf(findings, marked, markedState);
    await setupRecordParses(canonical, marker.attemptId, marker.frozenDigest);
    if (drafts.length === 0) throw new Explain("nothing found");
    const budget = { left: START_AGAIN_ENTRY_LIMIT };
    const units: StartAgainUnit[] = [];
    for (const draft of drafts) units.push(await unitOf(canonical, draft, budget));
    units.sort((a, b) => byText(`${a.root}\0${a.path}`, `${b.root}\0${b.path}`));
    return {
      kind: "choice",
      attemptId: marker.attemptId,
      frozenDigest: marker.frozenDigest,
      markerSha256,
      units,
      digest: sha256(JSON.stringify([marker.attemptId, marker.frozenDigest, markerSha256, units])),
      noteFloorMs: startAgainSetAsideFloorMs(units),
    };
  } catch (error) {
    if (error instanceof Explain) return { kind: "explain", reason: error.message };
    if (error instanceof AppError) return { kind: "explain", reason: error.reason ?? error.code };
    return {
      kind: "explain",
      reason: `check failed: ${String(field(error, "code") ?? "unknown")} ${String(field(error, "path") ?? "")}`,
    };
  }
}

/**
 * The finisher's `setup.start_again_incomplete` becomes `setup.start_again_files_found` when the
 * page can offer the choice; any other error, or a box that can only be explained, comes back
 * unchanged.
 */
export async function classifyStartAgainRefusal(
  roots: Roots,
  error: AppError,
): Promise<{ error: AppError; survey?: Choice }> {
  if (error.code !== "setup.start_again_incomplete") return { error };
  const survey = await surveyStartAgainLeftovers(roots);
  if (survey === null || survey.kind !== "choice") return { error };
  return {
    error: new AppError(
      "setup.start_again_files_found",
      {},
      error.reason === undefined ? {} : { reason: error.reason },
    ),
    survey,
  };
}
