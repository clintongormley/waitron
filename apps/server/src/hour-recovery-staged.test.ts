import { suite, root, key, archiveHost, agreeInternet, clock } from "../test/hour-recovery-host.js";
import { selectPastWaits } from "./testing/hour-test-clock.js";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { invoiceSeries } from "@waitron/db";
import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import * as restore from "./restore.js";
import { createSetupRecoveryPreparation } from "./recovery-preparation.js";
import { mountSetup } from "./setup-api.js";

vi.mock("./restore.js", async (original) => {
  const actual = await original<typeof import("./restore.js")>();
  return { ...actual, validateArtifact: vi.fn(actual.validateArtifact) };
});

async function stagedHost() {
  const f = await archiveHost();
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
    binding: { ...f.options.binding, eventId },
    context: {
      selectedSourceId: f.options.selected.sourceId,
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
    form.set("artifact", new Blob([Uint8Array.from(f.restore.artifact)]), "selected.wbk");
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
  return { f, recovery, stagingDir, stage, send, ok, bodies, stagedDatabase };
}

const sha = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const refusal = { error: { code: "setup.request_invalid", params: { field: "stagedId" } } };

describe("a staged backup for the restore's clock requests", () => {
  it("checks the file once and takes the name through small JSON requests", async () => {
    const h = await stagedHost();
    vi.mocked(restore.validateArtifact).mockClear();
    const { stagedId } = await h.ok(h.stage());
    expect(stagedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const database = await h.stagedDatabase();
    expect((await stat(join(h.stagingDir, "staged-recovery"))).mode & 0o777).toBe(0o700);
    expect((await stat(database)).mode & 0o777).toBe(0o600);
    const before = await sha(database);
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
    expect(selected).toMatchObject({ status: "selected", identity: "0CNSP" });
    expect(restore.validateArtifact).toHaveBeenCalledTimes(1);
    expect(await sha(database)).toBe(before);
    expect(await suite.db.select().from(invoiceSeries)).toEqual(rows);
    expect(h.bodies.length).toBeGreaterThanOrEqual(3);
    for (const body of h.bodies) expect(Buffer.byteLength(body)).toBeLessThan(2048);
  });

  it("refuses a staged id from another restore event, after a discard, and after an hour unused", async () => {
    const h = await stagedHost();
    const { stagedId } = await h.ok(h.stage());
    expect(await h.send(stagedId, { action: "clock-challenge" }, "another-page")).toEqual({
      status: 400,
      body: refusal,
    });
    expect(
      await h.send("5c1d6c43-4f61-4c4a-9e0b-0a8f2f8d9a11", { action: "clock-challenge" }),
    ).toEqual({ status: 400, body: refusal });
    await h.ok(h.send(stagedId, { action: "clock-challenge" }));
    vi.setSystemTime(Date.now() + 60 * 60_000);
    await h.ok(h.send(stagedId, { action: "clock-challenge" }));
    vi.setSystemTime(Date.now() + 60 * 60_000 + 1);
    expect(await h.send(stagedId, { action: "clock-challenge" })).toEqual({
      status: 400,
      body: refusal,
    });
    expect(await readdir(join(h.stagingDir, "staged-recovery"))).toEqual([]);

    const again = await h.ok(h.stage());
    await h.recovery.discard(again.stagedId as string);
    expect(await h.send(again.stagedId, { action: "clock-challenge" })).toEqual({
      status: 400,
      body: refusal,
    });
    expect(await readdir(join(h.stagingDir, "staged-recovery"))).toEqual([]);
  });

  it("keeps one copy per restore event and keeps it when a replacement fails its check", async () => {
    const h = await stagedHost();
    const first = await h.ok(h.stage());
    const refused = await h.stage("browser-http", "wrong password");
    expect(refused.status).not.toBe(200);
    await h.ok(h.send(first.stagedId, { action: "clock-challenge" }));
    const other = await h.stage("another-page");
    expect(other).toEqual({
      status: 409,
      body: { error: { code: "setup.already_provisioning", params: {} } },
    });
    await h.ok(h.send(first.stagedId, { action: "clock-challenge" }));
    const second = await h.ok(h.stage());
    expect(second.stagedId).not.toBe(first.stagedId);
    expect(await h.send(first.stagedId, { action: "clock-challenge" })).toEqual({
      status: 400,
      body: refusal,
    });
    await h.ok(h.send(second.stagedId, { action: "clock-challenge" }));
    expect(await readdir(join(h.stagingDir, "staged-recovery"))).toHaveLength(1);
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
