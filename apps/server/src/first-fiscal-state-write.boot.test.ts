import * as fs from "node:fs/promises";
import { join } from "node:path";
import { Agent } from "undici";
import { expect, it, vi } from "vitest";
import { createFirstSetupCoordinator, createFirstSetupStore } from "@waitron/provisioning";
import { verifyPassword } from "@waitron/identity";
import { firstFiscalFixture, PASSWORD } from "../test/first-fiscal.js";
import { startServer, type StartedServer } from "./boot.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

it("boots with the retained setup record after abandoning it", async () => {
  const f = await firstFiscalFixture();
  let server: StartedServer | undefined;
  let agent: Agent | undefined;
  try {
    const template = (await f.store.read())!;
    const root = await fs.realpath(f.root);
    const stateDir = join(root, "restart-state");
    const venueDir = join(root, "restart-venue");
    const statePath = join(stateDir, "flows/setup/record.json");
    const store = createFirstSetupStore({
      stateDir,
      venueDir,
      coordinator: createFirstSetupCoordinator(),
    });
    const claimed = await store.claim(
      template.frozen,
      template.ownerVerifier,
      template.capabilityHash,
    );
    await store.update(claimed.frozen.attemptId, claimed.revision, { kind: "abandoned" });
    const stateBefore = await fs.readFile(statePath);
    expect(JSON.parse(stateBefore.toString()).attempt).toMatchObject({
      status: "abandoned",
      consumptionIntent: false,
    });
    const retained = JSON.parse(stateBefore.toString());
    expect(await verifyPassword(PASSWORD, retained.attempt.ownerVerifier)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}-wrong`, retained.attempt.ownerVerifier)).toBe(false);
    const migrations = join(f.root, "migrations");
    await copyMigrationsRoot(migrations);
    const [port] = await freePorts(1);
    const boot = startServer({
      WAITRON_ENV: "production",
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: venueDir,
      WAITRON_MIGRATIONS_DIR: migrations,
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_MANAGEMENT_RP_ID: "localhost",
      WAITRON_MANAGEMENT_ORIGIN: "https://localhost",
    }).then((started) => (server = started));
    await boot;
    agent = new Agent({ connect: { ca: await fs.readFile(join(stateDir, "tls/ca.crt")) } });
    const response = await fetch(`https://127.0.0.1:${port}/setup-api/first-setup/status`, {
      dispatcher: agent,
    } as RequestInit);
    expect(response.status).toBe(200);
    expect(await fs.readFile(statePath)).toEqual(stateBefore);
  } finally {
    vi.mocked(fs.rename).mockImplementation(
      (await vi.importActual<typeof fs>("node:fs/promises")).rename,
    );
    await server?.close();
    await agent?.close();
    await f.dispose();
  }
});
