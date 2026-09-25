import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { KeyRing } from "@waitron/credentials";
import { persistNodeMembershipIfNewer, readNodeMembership, type Database } from "@waitron/db";
import { reissueBoxLeaf } from "./box-secrets.js";
import type { Logger } from "./logger.js";
import { mintNextMembershipDocument } from "./membership-mint.js";

/** Left in the state folder by `writeValidated` (restore.ts) whenever a restore takes on the
 * archive's identity; holds `{ version: 1, source }`. */
export const REBUILD_MARKER = "rebuild-first-start.json";

/** Which restore wrote the marker. Both get the same first start (plan Reconciliation O4). */
export type RebuildSource = "archive" | "stream";

export interface RebuildDeps {
  stateDir: string;
  db: Database;
  ring: KeyRing;
  nodeId: string;
  /** This machine's `advertisedOrigin`, what tills route on. */
  contactUrl: string;
  hostnames: string[];
  listIpv4: () => string[];
  now: () => Date;
  log: Logger;
}

/**
 * A restored box's first trading start: a certificate naming this machine's addresses, then the
 * membership document one term higher naming this machine's contact address. Does nothing, and
 * returns false, when no restore left its marker.
 *
 * The marker is removed last, so a failure or a crash part-way re-runs every step at the next
 * start; each step only moves forward (a new leaf, a higher term), so running it twice is safe.
 */
export async function completeRebuild(deps: RebuildDeps): Promise<boolean> {
  const marker = join(deps.stateDir, REBUILD_MARKER);
  let body: string;
  try {
    body = await readFile(marker, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  await reissueBoxLeaf({
    stateDir: deps.stateDir,
    hostnames: deps.hostnames,
    now: deps.now,
    listIpv4: deps.listIpv4,
  });
  const held = await readNodeMembership(deps.db);
  const nodes =
    held === null
      ? [{ nodeId: deps.nodeId, contactUrl: deps.contactUrl, standing: "serving-primary" as const }]
      : held.body.nodes.map((n) =>
          n.nodeId === deps.nodeId ? { ...n, contactUrl: deps.contactUrl } : n,
        );
  const next = await mintNextMembershipDocument(
    { db: deps.db, ring: deps.ring },
    { heldDocument: held, nodes, signerNodeId: deps.nodeId },
  );
  await persistNodeMembershipIfNewer(deps.db, next);
  deps.log("info", "restore.first_start_done", { term: next.body.term, source: sourceOf(body) });
  await rm(marker, { force: true });
  return true;
}

/** Only a restore writes the marker, so a body that cannot be read still means one happened. */
function sourceOf(body: string): RebuildSource | "unknown" {
  try {
    const source = (JSON.parse(body) as { source?: unknown }).source;
    return source === "archive" || source === "stream" ? source : "unknown";
  } catch {
    return "unknown";
  }
}
