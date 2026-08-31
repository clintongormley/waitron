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
      const size = sizeOf(current);
      if (size > 0 && size + Buffer.byteLength(line) > opts.maxBytes) rotate();
      appendFileSync(current, line);
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
    recent(o) {
      const all = readAll();
      const limit = o?.limit ?? 500;
      return all.slice(Math.max(0, all.length - limit));
    },
    byRequestIds(ids) {
      const set = new Set(ids);
      return readAll().filter((e) => e.requestId !== undefined && set.has(e.requestId));
    },
  };
}
