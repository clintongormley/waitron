import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

/** A state folder for setup routes whose suite never reads it; removed after the file. */
export function useSetupStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "setup-state-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
