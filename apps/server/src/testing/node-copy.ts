import type { NodeDatabase } from "@waitron/db";
import { writeFile } from "node:fs/promises";
import { snapshotNodeDatabase } from "../archive-entries.js";
import type { ArchiveEntry } from "../backup-archive.js";

/** A node handle whose copy is a few marker bytes, for code that carries `node.dump` unread. */
export const STUB_NODE: NodeDatabase = {
  archiveTo: (path: string) => writeFile(path, "NODE"),
} as unknown as NodeDatabase;

/** The marker copy `STUB_NODE` writes, for a `snapshotNode` dependency. */
export const stubNodeSnapshot = async (): Promise<Uint8Array> => Buffer.from("NODE");

/** A test archive's `node.dump` entry: a whole copy of `node`, taken through a scratch folder under `parent`. */
export async function nodeDumpEntry(
  node: { archiveTo(path: string): Promise<void> },
  parent: string,
): Promise<ArchiveEntry> {
  return { name: "node.dump", bytes: await snapshotNodeDatabase(node, parent)() };
}
