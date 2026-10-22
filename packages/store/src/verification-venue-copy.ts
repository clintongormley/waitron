import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";

interface VerificationScope {
  directory: string;
  active: boolean;
}
const copies = new AsyncLocalStorage<VerificationScope>();

export class VerificationVenueCopyCleanupError extends Error {
  constructor(cause: unknown) {
    super("The verification copy could not be removed", { cause });
    this.name = "VerificationVenueCopyCleanupError";
  }
}

async function removeCopy(directory: string): Promise<void> {
  try {
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    throw new VerificationVenueCopyCleanupError(error);
  }
}

export function isVerificationVenueCopy(directory: string): boolean {
  const scope = copies.getStore();
  return scope !== undefined && scope.active && scope.directory === directory;
}

/**
 * The callback owns only a fresh scratch copy and must close all its handles before returning.
 * Its caller supplies an independent process deadline: no watchdog interrupts synchronous work here.
 */
export async function withVerificationVenueCopy<T>(
  scratchRoot: string,
  body: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(scratchRoot, "verification-venue-"));
  let scope: VerificationScope | undefined;
  try {
    scope = { directory: await realpath(directory), active: true };
    return await copies.run(scope, () => body(directory));
  } finally {
    if (scope !== undefined) scope.active = false;
    await removeCopy(directory);
  }
}
