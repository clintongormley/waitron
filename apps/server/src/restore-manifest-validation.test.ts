import { expect, it } from "vitest";
import { validateDatabaseEntries } from "./restore.js";

const valid = {
  manifestVersion: 1,
  createdAt: "2026-11-16T08:00:00.000Z",
  environment: "preproduction",
  modules: {},
};
const deps = {
  stateDir: "/unused-state",
  stagingDir: "/unused-staging",
  migrationsRoot: "/unused-migrations",
  modules: [],
  environment: "preproduction" as const,
};

it.each([
  ["not JSON", "invalid"],
  [JSON.stringify({ ...valid, environment: undefined }), "invalid"],
  [JSON.stringify({ ...valid, modules: undefined }), "invalid"],
  [JSON.stringify({ ...valid, modules: [] }), "invalid"],
  [JSON.stringify({ ...valid, manifestVersion: 2 }), "unsupported"],
])("refuses an invalid manifest before a missing node copy: %s", async (raw, reason) => {
  await expect(
    validateDatabaseEntries(
      [{ name: "manifest.json", bytes: Buffer.from(raw) }],
      "/unused-database",
      deps,
    ),
  ).rejects.toMatchObject({ code: "restore.manifest_invalid", params: { reason } });
});

it("admits a well-shaped manifest with an unknown module before checking the node copy", async () => {
  await expect(
    validateDatabaseEntries(
      [
        {
          name: "manifest.json",
          bytes: Buffer.from(JSON.stringify({ ...valid, modules: { future: 1 } })),
        },
      ],
      "/unused-database",
      deps,
    ),
  ).rejects.toMatchObject({ code: "restore.archive_incomplete", params: { missing: "node.dump" } });
});
