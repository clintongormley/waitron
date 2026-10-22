import {
  suite,
  root,
  key,
  node,
  archiveHost,
  agreeInternet,
  clock,
} from "../test/hour-recovery-host.js";
import { selectPastWaits } from "./testing/hour-test-clock.js";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { invoiceSeries } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import * as restore from "./restore.js";
import { createSetupRecoveryPreparation } from "./recovery-preparation.js";
import { mountSetup } from "./setup-api.js";
import { buildManifest } from "./backup-manifest.js";
import { packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { recoveryArchiveSourceId } from "./recovery-source.js";

const preview = vi.hoisted(() => ({ seen: [] as string[], fail: false }));
vi.mock("./recovery-backup-preview.js", async (original) => {
  const actual = await original<typeof import("./recovery-backup-preview.js")>();
  const path = await import("node:path");
  return {
    ...actual,
    readRecoveryCopyPreview: async (...args: Parameters<typeof actual.readRecoveryCopyPreview>) => {
      preview.seen.push(path.basename(path.dirname(args[0].databasePath)));
      if (preview.fail) throw new Error("thrown partway through a staged request");
      return actual.readRecoveryCopyPreview(...args);
    },
  };
});
vi.mock("./restore.js", async (original) => {
  const actual = await original<typeof import("./restore.js")>();
  return { ...actual, validateArtifact: vi.fn(actual.validateArtifact) };
});

/** A backup taken by the release before fiscal-verifactu's last migration (two added columns). */
async function olderBackup() {
  const manifest = await buildManifest({
    db: suite.db,
    modules: ALL_MODULES,
    environment: "preproduction",
    now: new Date(),
  });
  const database = join(root, "older-backup.db");
  await suite.db.archiveTo(database);
  const raw = new DatabaseSync(database);
  raw.exec("ALTER TABLE envio_flujo DROP COLUMN technical_incident_token");
  raw.exec("ALTER TABLE envios DROP COLUMN technical_incidence");
  raw.exec(
    "DELETE FROM __drizzle_migrations_fiscal WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations_fiscal)",
  );
  raw.close();
  manifest.modules["fiscal-verifactu"] = manifest.modules["fiscal-verifactu"]! - 1;
  const dump = await readFile(database);
  const artifact = encryptArtifact(
    packArchive([
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: "db.dump", bytes: dump },
      {
        name: "secrets/trading.env",
        bytes: Buffer.from(
          `WAITRON_TILL_NODE_ID=${node.nodeId}\nWAITRON_TILL_LOCATION_ID=${node.locationId}\n`,
        ),
      },
      { name: "secrets/node-key.enc", bytes: Buffer.from("synthetic sealed node key") },
      { name: "secrets/cluster-id", bytes: Buffer.from("cluster") },
      {
        name: "secrets/credentials.key",
        bytes: Buffer.from(Buffer.alloc(32, 7).toString("base64")),
      },
      {
        name: "secrets/modules.json",
        bytes: Buffer.from(
          JSON.stringify({ modules: { "fiscal-verifactu": true, "fiscal-none": false } }),
        ),
      },
    ]),
    "archive password",
  );
  return { artifact, dumpSha: createHash("sha256").update(dump).digest("hex") };
}

async function stagedHost(older = false) {
  const f = await archiveHost();
  const backup = older ? await olderBackup() : undefined;
  const artifact = backup?.artifact ?? f.restore.artifact;
  const sourceId = backup ? recoveryArchiveSourceId(artifact) : f.options.selected.sourceId;
  const bindingSourceId = backup ? sourceId : f.options.binding.sourceId;
  vi.setSystemTime(new Date("2026-10-16T13:40:00Z"));
  const stagingDir = join(root, "interactive-validation");
  const coordinator = createFirstSetupCoordinator();
  const recovery = createSetupRecoveryPreparation({
    ...f.roots,
    stagingDir,
    modules: ALL_MODULES,
    migrationsRoot: null,
    coordinator,
    bucket: { litestreamBin: "/unused", now: () => new Date(), log: () => {} },
  });
  const app = new Hono();
  mountSetup(
    app,
    {
      environment: "preproduction",
      firstSetup: { coordinator, assertOtherAllowed: async () => {} },
      prepareRecovery: recovery,
      stageRecovery: recovery.stage,
      discardStagedRecovery: recovery.discard,
    },
    () => {},
  );
  const request = (eventId = "browser-http") => ({
    binding: { ...f.options.binding, sourceId: bindingSourceId, eventId },
    context: {
      selectedSourceId: sourceId,
      oldBoxGone: true,
      soleRecovery: true,
    },
    nodeRecoverySecret: key.secret,
  });
  const call = async (route: string, init: RequestInit) => {
    const socket = new TLSSocket(new Socket());
    try {
      const response = await app.request(`https://box.test${route}`, init, {
        incoming: { socket },
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    } finally {
      socket.destroy();
    }
  };
  const stage = async (eventId = "browser-http", recoveryKey = "archive password") => {
    const form = new FormData();
    form.set(
      "request",
      JSON.stringify({
        eventId,
        source: { kind: "archive", recoveryKey, environment: "preproduction" },
      }),
    );
    form.set("artifact", new Blob([Uint8Array.from(artifact)]), "selected.wbk");
    return call("/setup-api/recovery/stage", { method: "POST", body: form });
  };
  const bodies: string[] = [];
  const send = async (stagedId: unknown, proposal: unknown, eventId = "browser-http") => {
    const body = JSON.stringify({
      source: { kind: "staged", stagedId },
      preparation: { ...request(eventId), proposal },
    });
    bodies.push(body);
    return call("/setup-api/recovery/preparation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  };
  const ok = async (result: Promise<{ status: number; body: Record<string, unknown> }>) => {
    const { status, body } = await result;
    expect(status, JSON.stringify(body)).toBe(200);
    return body;
  };
  const stagedDatabase = async () => {
    const dirs = await readdir(join(stagingDir, "staged-recovery"));
    expect(dirs).toHaveLength(1);
    return join(stagingDir, "staged-recovery", dirs[0]!, "venue.db");
  };
  return { f, recovery, stagingDir, stage, send, ok, bodies, stagedDatabase, backup };
}

const sha = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const refusal = { error: { code: "setup.request_invalid", params: { field: "stagedId" } } };
const missing = {
  status: 409,
  body: { error: { code: "restore.staged_copy_missing", params: {} } },
};

describe("a staged backup for the restore's clock requests", () => {
  it("checks a backup from an older release once and takes the name through small JSON requests", async () => {
    const h = await stagedHost(true);
    vi.mocked(restore.validateArtifact).mockClear();
    const { stagedId } = await h.ok(h.stage());
    expect(stagedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const database = await h.stagedDatabase();
    expect((await stat(join(h.stagingDir, "staged-recovery"))).mode & 0o777).toBe(0o700);
    expect((await stat(database)).mode & 0o777).toBe(0o600);
    const before = await sha(database);
    expect(before).toBe(h.backup!.dumpSha);
    const rows = await suite.db.select().from(invoiceSeries);
    agreeInternet();
    const selected = await selectPastWaits(clock, async () => {
      const challenge = await h.ok(h.send(stagedId, { action: "clock-challenge" }));
      const compared = await h.ok(
        h.send(stagedId, {
          action: "compare-clocks",
          browser: { challengeId: challenge.id, instantMs: Date.now() },
        }),
      );
      return h.ok(h.send(stagedId, { action: "select", comparisonId: compared.id }));
    });
    expect(selected).toMatchObject({ status: "selected" });
    expect(restore.validateArtifact).toHaveBeenCalledTimes(1);
    expect(await sha(database)).toBe(before);
    expect(await readdir(join(h.stagingDir, "staged-recovery"))).toHaveLength(1);
    expect(await suite.db.select().from(invoiceSeries)).toEqual(rows);
    expect(h.bodies.length).toBeGreaterThanOrEqual(3);
    for (const body of h.bodies) expect(Buffer.byteLength(body)).toBeLessThan(2048);
  });

  it("refuses a staged id from another restore event, and answers a copy it no longer holds as missing", async () => {
    const h = await stagedHost();
    const { stagedId } = await h.ok(h.stage());
    expect(await h.send(stagedId, { action: "clock-challenge" }, "another-page")).toEqual({
      status: 400,
      body: refusal,
    });
    // An id this process never staged: what every page's id is after the box restarts.
    expect(
      await h.send("5c1d6c43-4f61-4c4a-9e0b-0a8f2f8d9a11", { action: "clock-challenge" }),
    ).toEqual(missing);
    await h.ok(h.send(stagedId, { action: "clock-challenge" }));
    vi.setSystemTime(Date.now() + 60 * 60_000);
    await h.ok(h.send(stagedId, { action: "clock-challenge" }));
    vi.setSystemTime(Date.now() + 60 * 60_000 + 1);
    expect(await h.send(stagedId, { action: "clock-challenge" })).toEqual(missing);
    expect(await readdir(join(h.stagingDir, "staged-recovery"))).toEqual([]);

    const again = await h.ok(h.stage());
    await h.recovery.discard(again.stagedId as string);
    expect(await h.send(again.stagedId, { action: "clock-challenge" })).toEqual(missing);
    expect(await readdir(join(h.stagingDir, "staged-recovery"))).toEqual([]);

    const resumed = await h.ok(h.stage());
    await h.ok(h.send(resumed.stagedId, { action: "clock-challenge" }));
  });

  it("lets the newest restore event's checked upload replace the copy, and keeps it when an upload fails its check", async () => {
    const h = await stagedHost();
    const first = await h.ok(h.stage("event-a"));
    const refused = await h.stage("event-b", "wrong password");
    expect(refused.status).not.toBe(200);
    await h.ok(h.send(first.stagedId, { action: "clock-challenge" }, "event-a"));
    const second = await h.ok(h.stage("event-b"));
    expect(second.stagedId).not.toBe(first.stagedId);
    expect(await h.send(first.stagedId, { action: "clock-challenge" }, "event-a")).toEqual({
      status: 400,
      body: refusal,
    });
    await h.ok(h.send(second.stagedId, { action: "clock-challenge" }, "event-b"));
    const third = await h.ok(h.stage("event-b"));
    expect(await h.send(second.stagedId, { action: "clock-challenge" }, "event-b")).toEqual({
      status: 400,
      body: refusal,
    });
    await h.ok(h.send(third.stagedId, { action: "clock-challenge" }, "event-b"));
    expect(await readdir(join(h.stagingDir, "staged-recovery"))).toHaveLength(1);
  });

  it("leaves no rejection unhandled when the unused-hour timer cannot delete the copy", async () => {
    const h = await stagedHost();
    const actual = await vi.importActual<typeof import("./restore.js")>("./restore.js");
    vi.mocked(restore.validateArtifact).mockImplementationOnce(async (deps) => ({
      ...(await actual.validateArtifact(deps)),
      discard: async () => {
        throw new Error("disk went away");
      },
    }));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
    try {
      await h.ok(h.stage());
      vi.advanceTimersByTime(60 * 60_000 + 2);
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      vi.useFakeTimers({ toFake: ["Date", "performance"] });
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it("removes a request's throwaway copy when the request throws partway", async () => {
    const h = await stagedHost();
    const { stagedId } = await h.ok(h.stage());
    const staged = await readdir(join(h.stagingDir, "staged-recovery"));
    preview.seen.length = 0;
    preview.fail = true;
    try {
      expect((await h.send(stagedId, { action: "clock-challenge" })).status).toBe(500);
    } finally {
      preview.fail = false;
    }
    expect(preview.seen).toEqual([expect.stringMatching(/^request-/)]);
    expect(await readdir(join(h.stagingDir, "staged-recovery"))).toEqual(staged);
    await h.ok(h.send(stagedId, { action: "clock-challenge" }));
  });

  it("clears a leftover staging folder when the box starts", async () => {
    const h = await stagedHost();
    const leftover = join(h.stagingDir, "staged-recovery", "archive-validate-left");
    await mkdir(leftover, { recursive: true });
    await writeFile(join(leftover, "venue.db"), "decrypted venue");
    await h.recovery.clearStaged();
    await expect(readdir(join(h.stagingDir, "staged-recovery"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
