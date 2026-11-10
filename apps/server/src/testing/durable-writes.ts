import type { FileHandle } from "node:fs/promises";
import { vi, type MockInstance } from "vitest";

/** The `node:fs/promises` functions a suite has wrapped, with `vi.fn` or a spying `vi.mock`, each
 * forwarding to the real one by default. */
export interface FsMocks {
  mkdir: MockInstance;
  open: MockInstance;
  rename: MockInstance;
}

/** Each sync of an opened file or folder, each rename and each `mkdir` that created a folder, in
 * order, while `run` runs. */
export async function syncsAndRenames(
  mocks: FsMocks,
  run: () => Promise<unknown>,
): Promise<string[]> {
  const events: string[] = [];
  // A spying `vi.mock` forwards with no implementation set, so the real one stands in.
  const real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const mkdirThrough = mocks.mkdir.getMockImplementation() ?? real.mkdir;
  mocks.mkdir.mockImplementation(async (p: unknown, ...rest: unknown[]) => {
    const created = await (mkdirThrough as (...a: unknown[]) => Promise<unknown>)(p, ...rest);
    if (created !== undefined) events.push(`mkdir ${String(p)}`);
    return created;
  });
  const openThrough = mocks.open.getMockImplementation() ?? real.open;
  const renameThrough = mocks.rename.getMockImplementation() ?? real.rename;
  mocks.open.mockImplementation(async (p: unknown, ...rest: unknown[]) => {
    const handle = (await (openThrough as (...a: unknown[]) => unknown)(p, ...rest)) as FileHandle;
    const realSync = handle.sync.bind(handle);
    handle.sync = async () => {
      events.push(`sync ${String(p)}`);
      return realSync();
    };
    return handle;
  });
  mocks.rename.mockImplementation(async (from: string, to: string) => {
    events.push(`rename ${from} ${to}`);
    return (renameThrough as (from: string, to: string) => Promise<void>)(from, to);
  });
  try {
    await run();
  } finally {
    mocks.mkdir.mockImplementation(mkdirThrough);
    mocks.open.mockImplementation(openThrough);
    mocks.rename.mockImplementation(renameThrough);
  }
  return events;
}

/** Whether `file`'s working copy was synced before it was renamed into place, and its folder after. */
export function writtenDurably(events: string[], file: string, folder: string): boolean {
  const synced = events.indexOf(`sync ${file}.tmp`);
  const renamed = events.indexOf(`rename ${file}.tmp ${file}`);
  return synced !== -1 && renamed > synced && events.indexOf(`sync ${folder}`, renamed) > renamed;
}
