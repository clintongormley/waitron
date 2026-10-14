import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, locations, nodes, stampDeployment, tenants } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { encodeRecoveryKit } from "@waitron/stream";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";
import { recoveryArchiveSourceId, recoveryStreamSourceId } from "./recovery-source.js";
import { startServer, type StartedServer } from "./boot.js";
import { awaitListening, copyMigrationsRoot, httpsVia } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";

const download = vi.hoisted(() => vi.fn());
vi.mock("./restore-stream.js", async (original) => ({
  ...(await original<typeof import("./restore-stream.js")>()),
  prepareStreamRestore: download,
}));
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const NODE = "d0000000-0000-4000-8000-000000000001";
const LOCATION = "d0000000-0000-4000-8000-000000000002";
let scratch: string;
beforeEach(async () => {
  await stampDeployment(suite.db, "preproduction");
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Old venue" });
  await suite.db.insert(locations).values({
    id: LOCATION,
    name: "Old location",
    invoiceLocales: ["es-ES"],
    operationDescription: "Restaurant",
  });
  await suite.db.insert(nodes).values({ id: NODE, locationId: LOCATION, name: "Old node" });
  scratch = await mkdtemp(join(tmpdir(), "w41s6-public-boot-"));
});
afterEach(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

it.each(["archive", "bucket"])(
  "the real setup listener stages %s credentials outside its public marker and logs",
  async (kind) => {
    const stateDir = join(scratch, "replacement");
    const database = join(scratch, "selected.db");
    await suite.db.archiveTo(database);
    const entries = [
      {
        name: "manifest.json",
        bytes: Buffer.from(
          JSON.stringify({
            manifestVersion: 1,
            createdAt: "2026-10-01T08:00:00.000Z",
            environment: "preproduction",
            modules: { core: 0 },
          }),
        ),
      },
      {
        name: "secrets/trading.env",
        bytes: Buffer.from(`WAITRON_TILL_NODE_ID=${NODE}\nWAITRON_TILL_LOCATION_ID=${LOCATION}\n`),
      },
      { name: "secrets/node-key.enc", bytes: Buffer.from("sealed") },
      { name: "secrets/cluster-id", bytes: Buffer.from("cluster") },
      {
        name: "secrets/credentials.key",
        bytes: Buffer.from(Buffer.alloc(32, 7).toString("base64")),
      },
    ];
    const artifact = encryptArtifact(
      packArchive([...entries, { name: "db.dump", bytes: await readFile(database) }]),
      "archive-key",
    );
    download.mockResolvedValue({
      databasePath: database,
      entries,
      nodeId: NODE,
      generation: "generation",
      venue: { legalName: "Old venue", taxId: "89890001K", locationName: "Old location" },
      discard: async () => {},
    });
    const operation = {
      binding: {
        module: "test-regime",
        action: "restore",
        eventId: "paper-42",
        targetNodeId: NODE,
        sourceId:
          kind === "archive"
            ? recoveryArchiveSourceId(artifact)
            : await recoveryStreamSourceId(database, entries),
      },
      input: { publicEnvelope: "signed-outside" },
    };
    await copyMigrationsRoot(join(scratch, "migrations"));
    const [port] = await freePorts(1);
    let server: StartedServer | undefined;
    let closeClient: (() => Promise<void>) | undefined;
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    try {
      server = await startServer({
        WAITRON_STATE_DIR: stateDir,
        WAITRON_VENUE_DIR: join(scratch, "empty"),
        WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
        WAITRON_LOG_DIR: join(scratch, "logs"),
        WAITRON_HTTP_PORT: String(port),
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_ENV: "dev",
      });
      await awaitListening(port!);
      const client = httpsVia(await readFile(join(stateDir, "tls/ca.crt")));
      closeClient = client.close;
      const form = new FormData();
      form.set("artifact", new Blob([new Uint8Array(artifact)]), "copy.waitron");
      form.set("recoveryKey", "archive-key");
      form.set("environment", "preproduction");
      form.set("oldBoxGone", "1");
      form.set("recoveryOperation", JSON.stringify(operation));
      form.set("nodeRecoverySecret", "paper-node-key");
      const kit = encodeRecoveryKit({
        version: 1,
        venueId: LOCATION,
        recoveryKey: "archive-key",
        pointerSignerPublicKey: "MCowBQYDK2VwAyEA0000000000000000000000000000000000000000000=",
        bucket: {
          region: "local",
          bucket: "copy",
          prefix: "",
          accessKeyId: "unused",
          secretAccessKey: "unused",
        },
      });
      const response = await fetch(
        `https://127.0.0.1:${port}/setup-api/${kind === "archive" ? "restore" : "restore-bucket"}`,
        {
          ...client.via,
          method: "POST",
          ...(kind === "bucket" ? { headers: { "content-type": "application/json" } } : {}),
          body:
            kind === "archive"
              ? form
              : JSON.stringify({
                  kit,
                  environment: "preproduction",
                  oldBoxGone: true,
                  venueConfirmed: "89890001K",
                  recoveryOperation: operation,
                  nodeRecoverySecret: "paper-node-key",
                }),
        },
      );
      expect(response.status, await response.text()).toBe(202);
      await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM"));
      const marker = await readFile(join(stateDir, "restore-request.json"), "utf8");
      expect(JSON.parse(marker)).toMatchObject({
        recoveryOperation: operation,
        nodeRecoveryKey: true,
      });
      expect(marker).not.toContain("paper-node-key");
      expect(await readFile(join(stateDir, "restore-request.node-key"), "utf8")).toBe(
        "paper-node-key",
      );
      const logs = await readFile(join(scratch, "logs/waitron.log"), "utf8");
      expect(logs).not.toContain("paper-node-key");
      expect(logs).not.toContain("archive-key");
      await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM"));
    } finally {
      await closeClient?.();
      await server?.close();
      kill.mockRestore();
    }
  },
  60_000,
);
