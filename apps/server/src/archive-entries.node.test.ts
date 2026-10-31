import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { migrationOptionsFor } from "@waitron/migrations";
import { openBackupQuery } from "@waitron/store";
import {
  assembleArchiveEntries,
  collectStateParts,
  snapshotNodeDatabase,
} from "./archive-entries.js";
import type { BackupManifest } from "./backup-manifest.js";
import { ALL_MODULES } from "./modules.js";
import { RECOVERY_FILES } from "./state-secrets.js";

const NODE_SET = ALL_MODULES.find((module) => module.name === "node")!.migrations;
const suite = useVenueDb({
  migrations: migrationOptionsFor([{ ...NODE_SET, appendOnlyTables: [] }], null),
});

const MANIFEST: BackupManifest = {
  manifestVersion: 1,
  createdAt: "2026-10-31T00:00:00.000Z",
  environment: "preproduction",
  modules: { node: 1 },
};

let stateDir: string;
beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "archive-entries-node-"));
  for (const rel of RECOVERY_FILES) {
    await mkdir(join(stateDir, dirname(rel)), { recursive: true });
    await writeFile(join(stateDir, rel), `${rel}-contents`);
  }
});
afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

it("an archive carries node.db's rows as node.dump", async () => {
  suite.node.run(
    sql`insert into node_mode (node_id, mode, singleton_role, updated_at) values ('node-a', 'mirror', 'secondary', 0)`,
  );
  const scratch = join(stateDir, "scratch");
  const parts = await collectStateParts({
    stateDir,
    modules: ALL_MODULES,
    resolvers: {},
    snapshotNode: snapshotNodeDatabase(suite.node, scratch),
  });
  const entries = assembleArchiveEntries(MANIFEST, Buffer.from("dump"), parts);
  expect(entries.map((entry) => entry.name).slice(0, 3)).toEqual([
    "manifest.json",
    "db.dump",
    "node.dump",
  ]);
  expect(await readdir(scratch)).toEqual([]);

  const copy = join(stateDir, "node.copy");
  await writeFile(copy, entries.find((entry) => entry.name === "node.dump")!.bytes);
  const opened = await openBackupQuery(copy);
  try {
    const rows = [];
    for await (const row of opened.query.rows(
      "select node_id, mode, singleton_role from node_mode",
    ))
      rows.push({ ...row });
    expect(rows).toEqual([{ node_id: "node-a", mode: "mirror", singleton_role: "secondary" }]);
  } finally {
    await opened.close();
  }
});
