import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
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
