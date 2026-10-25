import { archiveHost, key, root } from "../test/hour-recovery-host.js";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Agent } from "undici";
import { HonoRequest } from "hono/request";
import { expect, it, vi } from "vitest";
import * as database from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { ALL_MODULES } from "@waitron/composition";
import { freePorts } from "./testing/free-ports.js";
import { startServer } from "./boot.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { createFirstSetupBackupWorkspace } from "@waitron/provisioning";

const prefix = "/setup-api/first-setup/resolution/backup";
it("a refused key keeps repair retryable and ordinary setup resumes after restart", async () => {
  const f = await archiveHost();
  await writeFile(
    join(f.roots.stateDir, "modules.json"),
    JSON.stringify({ modules: { "fiscal-none": false } }),
  );
  const migrationsRoot = join(root, "migrations");
  await mkdir(migrationsRoot);
  const sets = manifestSets();
  const options = migrationOptionsFor(sets, null);
  for (const [index, set] of sets.entries())
    await cp(options[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  const [port] = await freePorts(1);
  const origin = `https://127.0.0.1:${port}`;
  const agent = new Agent({ connect: { rejectUnauthorized: false } });
  const environment = {
    WAITRON_ENV: "dev",
    WAITRON_STATE_DIR: f.roots.stateDir,
    WAITRON_VENUE_DIR: f.roots.venueDir,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_HTTP_HOST: "127.0.0.1",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_HTTP_LANDING_PORT: "0",
  };
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const send = (path: string, init: RequestInit = {}) =>
    fetch(origin + path, { ...init, dispatcher: agent } as RequestInit);
  try {
    server = await startServer(environment);
    expect((await send("/setup-api/venue-defaults")).status).toBe(200);
    let inspected = await (await send("/setup-api/first-setup/resolution")).json();
    const upload = (secret: string) => {
      const form = new FormData();
      form.set(
        "request",
        JSON.stringify({
          observation: {
            inspectionId: inspected.inspectionId,
            revision: inspected.revision,
            ownerGeneration: inspected.ownerGeneration,
          },
          source: {
            kind: "archive",
            recoveryKey: f.restore.recoveryKey,
            environment: "preproduction",
          },
          nodeRecoverySecret: secret,
          context: { oldBoxGone: true, soleRecovery: true },
        }),
      );
      form.set("artifact", new Blob([Uint8Array.from(f.restore.artifact)]), "backup.wbk");
      return form;
    };
    const denied = await send(prefix + "/open", {
      method: "POST",
      body: upload("wrong node key"),
    });
    expect(denied.status).toBe(422);
    expect(await denied.json()).toEqual({
      error: { code: "promotion.break_glass_invalid", params: {} },
    });
    expect(await (await send(prefix + "/status")).json()).toEqual({
      phase: "unstarted",
      proofRequired: true,
    });
    expect(await createFirstSetupBackupWorkspace(f.roots).read()).toEqual([]);
    const paused = await send("/setup-api/venue-defaults");
    expect(paused.status).toBe(503);
    expect(await paused.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
    inspected = await (await send("/setup-api/first-setup/resolution")).json();
    const retried = await send(prefix + "/open", { method: "POST", body: upload(key.secret) });
    expect(retried.status, await retried.clone().text()).toBe(200);
    const session = await retried.json();
    expect(session.preview.taxpayer).toEqual({ legalName: "Waitron SL", taxId: "89890001K" });
    expect(
      (
        await send(prefix + "/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.sessionId }),
        })
      ).status,
    ).toBe(200);
    expect((await send("/setup-api/venue-defaults")).status).toBe(503);
    await server.close();
    server = undefined;
    server = await startServer(environment);
    await vi.waitFor(async () => {
      expect((await send("/setup-api/venue-defaults")).status).toBe(200);
    });
  } finally {
    await server?.close();
    await agent.close();
  }
});
it.each(["configuration", "offerings"] as const)(
  "backup proof drains an admitted %s upload and fences later ordinary actions",
  async (kind) => {
    const f = await archiveHost();
    await writeFile(
      join(f.roots.stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    const migrationsRoot = join(root, "migrations");
    await mkdir(migrationsRoot);
    const sets = manifestSets();
    const options = migrationOptionsFor(sets, null);
    for (const [index, set] of sets.entries())
      await cp(options[index]!.migrationsFolder, join(migrationsRoot, set.name), {
        recursive: true,
      });
    const [port] = await freePorts(1);
    const origin = `https://127.0.0.1:${port}`;
    const agent = new Agent({ connect: { rejectUnauthorized: false } });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let enter!: () => void;
    const entered = new Promise<void>((done) => {
      enter = done;
    });
    const header = HonoRequest.prototype.header;
    const normalPath =
      kind === "configuration" ? "/setup-api/configuration" : "/setup-api/first-setup/offerings";
    const bodyRead = vi.spyOn(HonoRequest.prototype, "header").mockImplementation(function (
      this: HonoRequest,
      name?: string,
    ) {
      if (this.path === normalPath) enter();
      return name === undefined ? header.call(this) : Reflect.apply(header, this, [name]);
    } as HonoRequest["header"]);
    let released = false;
    let poolClosedBeforeRelease = false;
    const open = database.openVenueDatabase;
    const openDatabase = vi
      .spyOn(database, "openVenueDatabase")
      .mockImplementation(async (...args) => {
        const pool = await open(...args);
        const close = pool.close.bind(pool);
        pool.close = async () => {
          if (args[0] === f.roots.venueDir && upload !== undefined && !released)
            poolClosedBeforeRelease = true;
          await close();
        };
        return pool;
      });
    let upload: Promise<Response> | undefined;
    let opening: Promise<Response> | undefined;
    try {
      server = await startServer({
        WAITRON_ENV: "dev",
        WAITRON_STATE_DIR: f.roots.stateDir,
        WAITRON_VENUE_DIR: f.roots.venueDir,
        WAITRON_MIGRATIONS_DIR: migrationsRoot,
        WAITRON_HTTP_HOST: "127.0.0.1",
        WAITRON_HTTP_PORT: String(port),
        WAITRON_HTTP_LANDING_PORT: "0",
      });
      const send = (path: string, init: RequestInit = {}) =>
        fetch(origin + path, { ...init, dispatcher: agent } as RequestInit);
      await vi.waitFor(async () => {
        expect((await send(prefix + "/status")).status).toBe(200);
      });
      const host = createFirstSetupModuleHost({
        ...f.roots,
        modules: ALL_MODULES,
        environment: { WAITRON_ENV: "dev" },
      });
      const inspected = await host.resolution.inspectFirstSetupResolution();
      const artifact = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              kind === "configuration" ? "incomplete configuration" : '{"fiscalTerritory":',
            ),
          );
          await gate;
          if (kind === "offerings") controller.enqueue(new TextEncoder().encode('"ES-common"}'));
          controller.close();
        },
      });
      upload = send(normalPath, {
        method: "POST",
        headers: {
          "Content-Type":
            kind === "configuration" ? "application/octet-stream" : "application/json",
          "X-Waitron-Export-Passphrase": "test export password",
        },
        body: artifact,
        duplex: "half",
      } as RequestInit);
      await Promise.race([
        entered,
        upload.then(() => {
          throw new Error("upload ended before body-read barrier");
        }),
      ]);
      const form = new FormData();
      form.set(
        "request",
        JSON.stringify({
          observation: {
            inspectionId: inspected.inspectionId,
            revision: inspected.revision,
            ownerGeneration: inspected.ownerGeneration,
          },
          source: {
            kind: "archive",
            recoveryKey: f.restore.recoveryKey,
            environment: "preproduction",
          },
          nodeRecoverySecret: key.secret,
          context: { oldBoxGone: true, soleRecovery: true },
        }),
      );
      form.set("artifact", new Blob([Uint8Array.from(f.restore.artifact)]), "backup.wbk");
      let proofReturned = false;
      let lastStatus = "unseen";
      opening = send(prefix + "/open", { method: "POST", body: form }).then((response) => {
        proofReturned = true;
        return response;
      });
      await vi
        .waitFor(
          async () => {
            const later = await send("/setup-api/venue-defaults");
            lastStatus = JSON.stringify([later.status, await later.clone().json()]);
            expect(later.status, lastStatus).toBe(503);
            expect(await later.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
          },
          { timeout: 10_000 },
        )
        .catch((error: unknown) => {
          throw new Error("Handoff " + lastStatus + "; returned=" + proofReturned, {
            cause: error,
          });
        });
      if (kind === "offerings") expect((await send(prefix + "/status")).status).toBe(200);
      expect(proofReturned).toBe(false);
      expect(poolClosedBeforeRelease).toBe(false);
      released = true;
      release();
      const rejectedUpload = await upload;
      if (kind === "configuration") {
        expect(rejectedUpload.status).toBe(422);
        expect(await rejectedUpload.json()).toMatchObject({
          error: { code: "backup.artifact_invalid" },
        });
      } else {
        expect(rejectedUpload.status).toBe(200);
        expect(await rejectedUpload.json()).toMatchObject({ modules: expect.any(Array) });
      }
      const opened = await opening;
      expect(opened.status, await opened.clone().text()).toBe(200);
      const session = await opened.json();
      expect(session.preview.taxpayer).toEqual({ legalName: "Waitron SL", taxId: "89890001K" });
      for (const path of [
        "/restore",
        "/restore-bucket",
        "/adopt",
        "/provision",
        "/cloud-recovery/start",
        "/first-setup/claim",
        "/first-setup/resolution/start-again",
        "/first-setup/resolution/start-again/summary",
        "/first-setup/resolution/recover",
        "/first-setup/resolution/resume-selection",
      ]) {
        const refused = await send("/setup-api" + path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        expect(refused.status, path).toBe(503);
        expect(await refused.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
      }
      for (const path of [
        "/setup-api/status",
        "/setup-api/discovery",
        "/setup-api/first-setup/status",
        "/setup-api/first-setup/resolution",
      ])
        expect((await send(path)).status, path).toBe(200);
      expect(
        (
          await send(prefix + "/prepare", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: session.sessionId,
              proposal: { action: "clock-challenge" },
            }),
          })
        ).status,
      ).toBe(200);
      const workspace = createFirstSetupBackupWorkspace(f.roots);
      const record = (await workspace.read()).at(-1)!;
      expect(record.phase).toBe("prepared");
      const original = await readFile(join(f.roots.stateDir, "modules.json"));
      await server.close();
      server = undefined;
      expect(await readFile(join(f.roots.stateDir, "modules.json"))).toEqual(original);
      expect((await workspace.read()).at(-1)).toEqual(record);
    } finally {
      release();
      await Promise.allSettled([upload, opening]);
      bodyRead.mockRestore();
      openDatabase.mockRestore();
      await server?.close();
      await agent.close();
    }
  },
);
