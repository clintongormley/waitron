import { CORE_MIGRATIONS, tenants, openVenueDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { startServer } from "./boot.js";
import { writeValidated, validateDatabaseEntries } from "./restore.js";
import { runStagedRestore } from "./restore-request.js";
import { runStagedReset } from "./reset-request.js";
import { freePorts } from "./testing/free-ports.js";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const dirs: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "first-entry-"));
  dirs.push(root);
  const venueDir = join(root, "venue");
  const stateDir = join(root, "state");
  await mkdir(venueDir);
  await mkdir(stateDir);
  await writeFile(
    join(venueDir, "first-setup-claim.json"),
    JSON.stringify({
      version: 1,
      attemptId: "11111111-1111-4111-8111-111111111111",
      venueDir,
      stateDir,
      status: "claiming",
    }),
  );
  return { root, venueDir, stateDir };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it.each(["same", "different", "omitted"])(
  "the real boot refuses an unresolved fixed marker with %s state root",
  async (root) => {
    const f = await fixture();
    const [port] = await freePorts(1);
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      await expect(
        (async () => {
          server = await startServer({
            WAITRON_VENUE_DIR: f.venueDir,
            WAITRON_STATE_DIR:
              root === "omitted" ? undefined : root === "same" ? f.stateDir : join(f.root, "wrong"),
            WAITRON_HTTP_HOST: "127.0.0.1",
            WAITRON_HTTP_PORT: String(port),
          });
        })(),
      ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    } finally {
      await server?.close();
    }
  },
);
it("checks before archive/bucket placement changes either database or host state", async () => {
  const f = await fixture();
  const path = join(f.venueDir, "venue.db");
  await writeFile(path, "OLD");
  const source = join(f.root, "source");
  await writeFile(source, "NEW");
  await expect(
    writeValidated(
      {
        databasePath: source,
        manifest: {
          manifestVersion: 1,
          createdAt: "2026-10-15T00:00:00.000Z",
          environment: "preproduction",
          modules: {},
        },
        secretEntries: [],
        discard: async () => {},
      },
      {
        venueDir: f.venueDir,
        stateDir: f.stateDir,
        stagingDir: join(f.root, "staging"),
        migrationsRoot: null,
        environment: "preproduction",
        modules: [],
        log: () => {},
      },
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  expect(await readFile(path, "utf8")).toBe("OLD");
  expect(await readFile(source, "utf8")).toBe("NEW");
  await expect(readFile(join(f.stateDir, "rebuild-first-start.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it.each(["restore", "reset"])(
  "staged %s cannot remove credentials or place files across an unresolved claim",
  async (kind) => {
    const f = await fixture();
    await writeFile(join(f.stateDir, `${kind}-request.json`), "{}");
    await writeFile(join(f.stateDir, "restore-request.node-key"), "RECOVERY-SENTINEL");
    let placements = 0;
    const deps = {
      stateDir: f.stateDir,
      venueDir: f.venueDir,
      migrationsRoot: null,
      log: () => {},
    };
    await expect(
      kind === "restore"
        ? runStagedRestore(deps, async () => {
            placements++;
          })
        : runStagedReset(deps),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(placements).toBe(0);
    expect(await readFile(join(f.stateDir, "restore-request.node-key"), "utf8")).toBe(
      "RECOVERY-SENTINEL",
    );
  },
);
it.each(["first-setup.json", "first-setup-claim.json", "module-operation-public.json"])(
  "does not accept %s from an authenticated restore source",
  async (name) => {
    const f = await fixture();
    const entries = [
      {
        name: "manifest.json",
        bytes: Buffer.from(
          JSON.stringify({
            manifestVersion: 1,
            createdAt: "2026-10-15T00:00:00.000Z",
            environment: "preproduction",
            modules: {},
          }),
        ),
      },
      { name: `secrets/${name}`, bytes: Buffer.from("{}") },
    ];
    await expect(
      validateDatabaseEntries(entries, join(f.root, "source.db"), {
        stateDir: f.stateDir,
        stagingDir: join(f.root, "staging"),
        migrationsRoot: null,
        environment: "preproduction",
        modules: [],
      }),
    ).rejects.toMatchObject({ code: "restore.unexpected_entry" });
  },
);

it("does not import host claim or enrolment files through the generic recovery bundle writer", async () => {
  const f = await fixture();
  const { unpackBundleToDir } = await import("./state-secrets.js");
  for (const name of [
    "first-setup.json",
    "first-setup-claim.json",
    "module-operation-public.json",
  ]) {
    await expect(
      unpackBundleToDir({ "trading.env": "SHOULD-NOT-WRITE", [name]: "{}" }, f.stateDir),
    ).rejects.toMatchObject({ code: "recovery.bundle_invalid", params: { reason: "unsafe_path" } });
    await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }
});
it("the restore command refuses a fixed claim before invoking archive recovery", async () => {
  const f = await fixture();
  const { runRestore } = await import("./restore-command.js");
  const source = join(f.root, "archive");
  await writeFile(source, "unopened-archive");
  let calls = 0;
  const out: string[] = [];
  expect(
    await runRestore({
      argv: ["restore", source],
      env: {
        WAITRON_VENUE_DIR: f.venueDir,
        WAITRON_STATE_DIR: f.stateDir,
        WAITRON_BACKUP_RECOVERY_KEY: "SYNTHETIC-SECRET",
      },
      out: (line) => out.push(line),
      restore: async () => {
        calls++;
      },
    }),
  ).toBe(1);
  expect(calls).toBe(0);
  expect(out.join("\n")).toContain("setup.attempt_invalid");
  expect(out.join("\n")).not.toContain("SYNTHETIC-SECRET");
});

async function abandonedConsumedClaim(kind = "consumed-abandoned") {
  const { randomUUID, createHash } = await import("node:crypto");
  const { createFirstSetupStore, createFirstSetupCoordinator } =
    await import("@waitron/provisioning");
  const { hashPassword, hashPin } = await import("@waitron/identity");
  const f = await fixture();
  await rm(join(f.venueDir, "first-setup-claim.json"));
  const coordinator = createFirstSetupCoordinator();
  const store = createFirstSetupStore({ ...f, coordinator });
  const attemptId = randomUUID();
  const verifier = hashPassword("synthetic-password");
  const state = await store.claim(
    {
      attemptId,
      nodeId: randomUUID(),
      administratorId: randomUUID(),
      sourceId: `first-setup:${attemptId}`,
      environment: "preproduction",
      modules: [],
      request: {
        country: "ES",
        taxId: "B12345678",
        legalName: "Olivo",
        location: {
          name: "Olivo",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES"],
          operationDescription: "Restaurante",
          addressLine1: "Mayor 1",
          addressLine2: null,
          postalCode: "28001",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "06:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          email: "elena@example.test",
          displayName: "Elena",
          passwordHash: verifier,
          pinHash: hashPin("4826"),
        },
      },
    },
    verifier,
    createHash("sha256").update("capability").digest("hex"),
    createHash("sha256").update("nonce").digest("hex"),
  );
  if (kind === "pre-consumption-abandoned")
    await store.update(attemptId, state.revision, { kind: "abandoned" });
  else {
    let current = await store.update(attemptId, state.revision, { kind: "consumption-intent" });
    if (kind === "complete") {
      for (const change of [
        { kind: "activation-started" },
        { kind: "committed", result: {} },
        { kind: "publication" },
        { kind: "complete" },
      ] as const)
        current = await store.update(attemptId, current.revision, change);
    } else await store.update(attemptId, 2, { kind: "abandoned" });
  }
  return { ...f, store, attemptId };
}
it("does not treat a consumed abandoned marker as permission to trade", async () => {
  const f = await abandonedConsumedClaim();
  const [port] = await freePorts(1);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await expect(
      (async () => {
        server = await startServer({
          WAITRON_VENUE_DIR: f.venueDir,
          WAITRON_STATE_DIR: f.stateDir,
          WAITRON_HTTP_HOST: "127.0.0.1",
          WAITRON_HTTP_PORT: String(port),
          WAITRON_TILL_NODE_ID: "11111111-1111-4111-8111-111111111111",
          WAITRON_TILL_LOCATION_ID: "22222222-2222-4222-8222-222222222222",
        });
      })(),
    ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  } finally {
    await server?.close();
  }
});

it.each(["pre-consumption-abandoned", "complete"])(
  "can place an authenticated archive after a %s claim without importing claim authority",
  async (kind) => {
    const f = await abandonedConsumedClaim(kind);
    await suite.db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "B12345678", legalName: "Restored Olivo" });
    const source = join(f.root, "archive-source.db");
    await suite.db.archiveTo(source);
    const artifact = encryptArtifact(
      packArchive([
        {
          name: "manifest.json",
          bytes: Buffer.from(
            JSON.stringify({
              manifestVersion: 1,
              createdAt: "2026-10-15T00:00:00.000Z",
              environment: "preproduction",
              modules: {},
            }),
          ),
        },
        { name: "db.dump", bytes: await readFile(source) },
      ]),
      "synthetic-archive-key",
    );
    const { restoreFromArtifact } = await import("./restore.js");
    await restoreFromArtifact({
      artifact,
      recoveryKey: "synthetic-archive-key",
      venueDir: f.venueDir,
      stateDir: f.stateDir,
      stagingDir: join(f.root, "staging"),
      migrationsRoot: null,
      modules: [],
      environment: "preproduction",
      skipSecrets: true,
      log: () => {},
    });
    const opened = await openVenueDatabase(f.venueDir);
    try {
      expect(await opened.venue.select({ name: tenants.legalName }).from(tenants)).toEqual([
        { name: "Restored Olivo" },
      ]);
    } finally {
      await opened.close();
    }
    expect((await f.store.read())?.frozen.attemptId).toBe(f.attemptId);
    expect((await f.store.read())?.status).toBe(kind === "complete" ? "complete" : "abandoned");
  },
);

it.each([
  "first-setup-node-key.json",
  "first-fiscal-documents/manifest.json",
  "first-fiscal-documents/0-0.json",
  "first-setup-resolutions/id/000001.json",
  "first-setup-workspaces/id/state/first-setup.json",
  "first-setup-selection.json",
  "first-setup-retirement.json",
  "first-setup-workspace.json",
])("cannot import retirement or current setup authority through %s", async (name) => {
  const f = await fixture();
  const { unpackBundleToDir } = await import("./state-secrets.js");
  await expect(
    unpackBundleToDir({ "trading.env": "SHOULD-NOT-WRITE", [name]: "{}" }, f.stateDir),
  ).rejects.toMatchObject({ code: "recovery.bundle_invalid", params: { reason: "unsafe_path" } });
  await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    validateDatabaseEntries(
      [
        {
          name: "manifest.json",
          bytes: Buffer.from(
            JSON.stringify({
              manifestVersion: 1,
              createdAt: "2026-10-15T00:00:00.000Z",
              environment: "preproduction",
              modules: {},
            }),
          ),
        },
        { name: `secrets/${name}`, bytes: Buffer.from("{}") },
      ],
      join(f.root, "source.db"),
      {
        stateDir: f.stateDir,
        stagingDir: join(f.root, "staging"),
        migrationsRoot: null,
        environment: "preproduction",
        modules: [],
      },
    ),
  ).rejects.toMatchObject({ code: "restore.unexpected_entry" });
});
