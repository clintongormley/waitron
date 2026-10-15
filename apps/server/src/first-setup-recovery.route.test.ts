import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Agent } from "undici";
import { expect, it } from "vitest";
import { firstFiscalFixture, PASSWORD } from "../test/first-fiscal.js";
import { startServer, type StartedServer } from "./boot.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { mountSetup } from "./setup-api.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";

it("recovers the same consumed attempt over the real trusted HTTPS listener from a fresh browser", async () => {
  const f = await firstFiscalFixture();
  let server: StartedServer | undefined;
  let agent: Agent | undefined;
  try {
    const migrations = join(f.root, "migrations");
    await copyMigrationsRoot(migrations);
    const [port] = await freePorts(1);
    const before = (await f.store.read())!;
    server = await startServer({
      WAITRON_ENV: "production",
      WAITRON_STATE_DIR: f.stateDir,
      WAITRON_VENUE_DIR: f.venueDir,
      WAITRON_MIGRATIONS_DIR: migrations,
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_MANAGEMENT_RP_ID: "localhost",
      WAITRON_MANAGEMENT_ORIGIN: "https://localhost",
    });
    agent = new Agent({ connect: { ca: await readFile(join(f.stateDir, "tls/ca.crt")) } });
    const nonce = randomBytes(32).toString("base64url");
    const response = await fetch(`https://127.0.0.1:${port}/setup-api/first-setup/recover`, {
      dispatcher: agent,
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: `https://127.0.0.1:${port}` },
      body: JSON.stringify({ clientClaimNonce: nonce, password: PASSWORD }),
    } as RequestInit);
    expect(response.status).toBe(200);
    const recovered = await response.json();
    expect(recovered.state).toMatchObject({
      attemptId: before.frozen.attemptId,
      nodeId: before.frozen.nodeId,
      administratorId: before.frozen.administratorId,
      status: "consumption-intent",
      consumptionIntent: true,
      ownerGeneration: 2,
      revision: before.revision + 1,
    });
    const after = (await f.store.read())!;
    expect(after.frozen).toEqual(before.frozen);
    expect(after.inputs).toEqual(before.inputs);
    expect(after.history.slice(0, before.history.length)).toEqual(before.history);
    await expect(f.owner.status(f.ownerAttempt)).rejects.toMatchObject({
      code: "setup.owner_required",
    });
    const bytes = await readFile(join(f.stateDir, "first-setup.json"), "utf8");
    for (const secret of [nonce, PASSWORD, recovered.capability])
      expect(bytes).not.toContain(secret);
  } finally {
    await server?.close();
    await agent?.close();
    await f.dispose();
  }
});

it("rejects recovery on an actual HTTP socket despite a forwarded HTTPS header", async () => {
  const f = await firstFiscalFixture();
  let server: ReturnType<typeof serve> | undefined;
  try {
    const host = createFirstSetupModuleHost({
      stateDir: f.stateDir,
      venueDir: f.venueDir,
      environment: {},
      modules: f.modules,
    });
    const app = new Hono();
    mountSetup(app, { environment: "production", firstFiscal: host }, () => {});
    const [port] = await freePorts(1);
    server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
    if (!server.listening) await once(server, "listening");
    const before = await readFile(join(f.stateDir, "first-setup.json"));
    const response = await fetch(`http://127.0.0.1:${port}/setup-api/first-setup/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
      body: JSON.stringify({
        clientClaimNonce: randomBytes(32).toString("base64url"),
        password: PASSWORD,
      }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "setup.owner_required", params: {} } });
    expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
  } finally {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    await f.dispose();
  }
});
