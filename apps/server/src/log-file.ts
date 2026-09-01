import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export interface RotatingFileSinkOptions {
  dir: string;
  fileName?: string;
  maxBytes: number;
  maxFiles: number;
}

/**
 * Best-effort synchronous file sink. The box process is the single sequential writer, so rotation
 * needs no cross-process locking. On ANY IO failure it reports once (via `onError`) and becomes a
 * no-op — the sale-safety invariant: logging never throws into a request path. The paired `tee`
 * still writes stdout, so a degraded file sink loses the file, not the line.
 */
export function createRotatingFileSink(
  opts: RotatingFileSinkOptions,
  onError: (e: unknown) => void = () => {},
): (line: string) => void {
  const fileName = opts.fileName ?? "waitron.log";
  const current = join(opts.dir, fileName);
  let degraded = false;
  let dirEnsured = false;
  // The live byte size of the current file, tracked in memory so the hot write path costs no
  // `statSync` per line. Seeded lazily from disk on the first write (a file may survive a restart),
  // grown by each append, and reset by `rotate`. `-1` means "not yet seeded".
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
  return (line) => {
    if (degraded) return;
    try {
      if (!dirEnsured) {
        mkdirSync(opts.dir, { recursive: true });
        dirEnsured = true;
      }
      if (currentSize < 0) currentSize = sizeOf(current);
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
 * Reads back what {@link createRotatingFileSink} wrote. Mirrors the sink's rotation naming — `.N` is
 * the oldest rotated file, `.1` the most recent, and the bare fileName the current one — so reading
 * `.maxFiles → … → .1 → current` yields events in chronological order. Never throws: a missing file
 * is skipped and a torn/garbage line is dropped, so a diagnostics read can never take down a caller.
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
    // Tail-bounded: walks files newest-first and parses only from the end of each until `limit`
    // events are gathered, so a poll returns the last N lines without reading or JSON-parsing every
    // rotated file (the common case touches only the current file). Result is chronological.
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
