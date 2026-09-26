import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { redactSecrets } from "./redact-secrets.js";

export interface RotatingFileSinkOptions {
  dir: string;
  fileName?: string;
  maxBytes: number;
  maxFiles: number;
}

/**
 * Best-effort synchronous file sink. The box process is the single sequential writer, so rotation
 * needs no cross-process locking. On ANY IO failure it reports once (via `onError`) and becomes a
 * no-op: logging never throws into a request path.
 *
 * Every line goes through `redactSecrets` FIRST, because the unauthenticated recovery page serves this
 * file's tail (`recovery-surface.ts` → `readLog`) and any module may log a caught error's own words.
 * The mask belongs to the FILE, not to the call sites, so a new module is covered without knowing the
 * page exists.
 */
export function createRotatingFileSink(
  opts: RotatingFileSinkOptions,
  onError: (e: unknown) => void = () => {},
): (line: string) => void {
  const fileName = opts.fileName ?? "waitron.log";
  const current = join(opts.dir, fileName);
  let degraded = false;
  let dirEnsured = false;
  // Tracked in memory so the write path costs no `statSync` per line. `-1` means "not yet seeded".
  let currentSize = -1;
  const sizeOf = (p: string): number => {
    try {
      return statSync(p).size;
    } catch {
      return 0;
    }
  };
  const rotate = () => {
    // waitron.log.(N-1) → .N, dropping the oldest beyond maxFiles, then waitron.log → .1
    rmSync(join(opts.dir, `${fileName}.${opts.maxFiles}`), { force: true });
    for (let i = opts.maxFiles - 1; i >= 1; i--) {
      try {
        renameSync(join(opts.dir, `${fileName}.${i}`), join(opts.dir, `${fileName}.${i + 1}`));
      } catch {
        /* gap ok */
      }
    }
    renameSync(current, join(opts.dir, `${fileName}.1`));
  };
  return (rawLine) => {
    if (degraded) return;
    const line = redactSecrets(rawLine);
    try {
      if (!dirEnsured) {
        mkdirSync(opts.dir, { recursive: true });
        dirEnsured = true;
      }
      if (currentSize < 0) currentSize = sizeOf(current);
      // Measured on the REDACTED line, which is what is appended.
      const bytes = Buffer.byteLength(line);
      if (currentSize > 0 && currentSize + bytes > opts.maxBytes) {
        rotate();
        currentSize = 0;
      }
      appendFileSync(current, line);
      currentSize += bytes;
    } catch (e) {
      degraded = true;
      try {
        onError(e);
      } catch {
        /* nothing else to do — logging must never throw into a request path */
      }
    }
  };
}

export function tee(...sinks: Array<(line: string) => void>): (line: string) => void {
  return (line) => {
    for (const s of sinks) s(line);
  };
}

export type LogEvent = {
  at: string;
  level: string;
  event: string;
  requestId?: string;
} & Record<string, unknown>;

export interface LogReader {
  recent(opts?: { limit?: number }): LogEvent[];
  byRequestIds(ids: Iterable<string>): LogEvent[];
}

/**
 * Reads back what {@link createRotatingFileSink} wrote, in chronological order. Never throws: a missing
 * file is skipped and a torn/garbage line is dropped.
 */
export function createLogReader(opts: {
  dir: string;
  fileName?: string;
  maxFiles: number;
}): LogReader {
  const fileName = opts.fileName ?? "waitron.log";
  // Oldest rotated file first, current file last → chronological order overall.
  const orderedPaths = (): string[] => {
    const paths: string[] = [];
    for (let i = opts.maxFiles; i >= 1; i--) paths.push(join(opts.dir, `${fileName}.${i}`));
    paths.push(join(opts.dir, fileName));
    return paths;
  };
  const readAll = (): LogEvent[] => {
    const out: LogEvent[] = [];
    for (const p of orderedPaths()) {
      let text: string;
      try {
        text = readFileSync(p, "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n")) {
        if (line === "") continue;
        try {
          out.push(JSON.parse(line) as LogEvent);
        } catch {
          /* skip a torn/garbage line */
        }
      }
    }
    return out;
  };
  return {
    // Walks files newest-first and parses only from the end of each until `limit` events are gathered.
    recent(o) {
      const limit = o?.limit ?? 500;
      const collected: LogEvent[] = []; // newest-first while gathering
      const paths = orderedPaths(); // oldest → newest
      for (let pi = paths.length - 1; pi >= 0 && collected.length < limit; pi--) {
        let text: string;
        try {
          text = readFileSync(paths[pi]!, "utf8");
        } catch {
          continue;
        }
        const lines = text.split("\n");
        for (let i = lines.length - 1; i >= 0 && collected.length < limit; i--) {
          const line = lines[i]!;
          if (line === "") continue;
          try {
            collected.push(JSON.parse(line) as LogEvent);
          } catch {
            /* skip a torn/garbage line */
          }
        }
      }
      return collected.reverse();
    },
    byRequestIds(ids) {
      const set = new Set(ids);
      return readAll().filter((e) => e.requestId !== undefined && set.has(e.requestId));
    },
  };
}
