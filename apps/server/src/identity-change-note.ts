import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { IdentityChangeNote } from "@waitron/fiscal";
import { IDENTITY_CHANGE_FILE } from "@waitron/store";

const KEYS = ["fromProducerTaxId", "producerTaxId", "release", "version"].join();

const notePath = (stateDir: string) => join(stateDir, IDENTITY_CHANGE_FILE);

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

function parseNote(text: string): IdentityChangeNote | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  if (Object.keys(value).sort().join() !== KEYS) return null;
  const { version, release, producerTaxId, fromProducerTaxId } = value as Record<string, unknown>;
  if (version !== 1) return null;
  if (!isText(release) || !isText(producerTaxId) || !isText(fromProducerTaxId)) return null;
  return { release, producerTaxId, fromProducerTaxId };
}

/**
 * The note an upgrade left naming a change of producer. A file that is missing, that cannot be read
 * or that is not exactly a note counts as none.
 */
export async function readIdentityChangeNote(stateDir: string): Promise<IdentityChangeNote | null> {
  let text: string;
  try {
    text = await readFile(notePath(stateDir), "utf8");
  } catch {
    return null;
  }
  return parseNote(text);
}

export async function deleteIdentityChangeNote(stateDir: string): Promise<void> {
  await rm(notePath(stateDir), { force: true });
}
