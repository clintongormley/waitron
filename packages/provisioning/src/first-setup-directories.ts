import { AppError } from "@waitron/shared";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import "./errors.js";

export type RegisterAnswer =
  | {
      kind: "current-master";
      status: "Consumed" | "Not consumed" | "Unknown";
      custodian: string;
      reference: string;
      consultedAt: string;
    }
  | { kind: "no-current-master"; confirmed: true };
export interface FirstSetupOriginal {
  name: string;
  bytes: Uint8Array | null;
}
function invalid(): never {
  throw new AppError("setup.attempt_invalid", {});
}
export async function canonicalFirstSetupDirectory(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    const info = await lstat(absolute);
    if (!info.isDirectory() || info.isSymbolicLink()) invalid();
    return await realpath(absolute);
  } catch (error) {
    if (!(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ))
      throw error;
    return join(await canonicalFirstSetupDirectory(dirname(absolute)), basename(absolute));
  }
}
export async function canonicalFirstSetupRoots(roots: {
  stateDir: string;
  venueDir: string;
}): Promise<{ stateDir: string; venueDir: string }> {
  return {
    stateDir: await canonicalFirstSetupDirectory(roots.stateDir),
    venueDir: await canonicalFirstSetupDirectory(roots.venueDir),
  };
}
