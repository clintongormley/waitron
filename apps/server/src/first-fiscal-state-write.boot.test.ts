import * as fs from "node:fs/promises";
import { join } from "node:path";
import { Agent } from "undici";
import { expect, it, vi } from "vitest";
import { createFirstSetupCoordinator, createFirstSetupStore } from "@waitron/provisioning";
import { firstFiscalFixture } from "../test/first-fiscal.js";
import { startServer, type StartedServer } from "./boot.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

it.each(["claim", "abandon", "completed-abandon"] as const)(
  "boots with the actual retained pair after %s persistence",
  async (phase) => {
    const f = await firstFiscalFixture();
    let server: StartedServer | undefined;
    let agent: Agent | undefined;
    try {
      const template = (await f.store.read())!;
      const root = await fs.realpath(f.root);
      const stateDir = join(root, "restart-state");
      const venueDir = join(root, "restart-venue");
      const markerPath = join(venueDir, "first-setup-claim.json");
      const statePath = join(stateDir, "first-setup.json");
      const store = createFirstSetupStore({
        stateDir,
        venueDir,
        coordinator: createFirstSetupCoordinator(),
      });
      const rename = vi.mocked(fs.rename);
      const actualRename = (await vi.importActual<typeof fs>("node:fs/promises")).rename;
      const interrupt = (status: string) => {
        rename.mockImplementation(async (from, to) => {
          if (to === markerPath && JSON.parse(await fs.readFile(from, "utf8")).status === status)
            throw new Error("synthetic interruption before marker replacement");
          await actualRename(from, to);
        });
      };
      const claim = () =>
        store.claim(
          template.frozen,
          template.ownerVerifier,
          template.capabilityHash,
          template.claimNonceHash,
        );
      if (phase === "claim") {
        interrupt("active");
        await expect(claim()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
      } else {
        const claimed = await claim();
        if (phase === "abandon") interrupt("abandoned");
        const abandoning = store.update(claimed.frozen.attemptId, claimed.revision, {
          kind: "abandoned",
        });
        if (phase === "abandon")
          await expect(abandoning).rejects.toMatchObject({ code: "setup.attempt_invalid" });
        else await abandoning;
      }
      rename.mockImplementation(actualRename);
      const stateBefore = await fs.readFile(statePath);
      const markerBefore = await fs.readFile(markerPath);
      expect(JSON.parse(stateBefore.toString())).toMatchObject({
        status: phase === "claim" ? "claimed" : "abandoned",
        consumptionIntent: false,
      });
      expect(JSON.parse(markerBefore.toString()).status).toBe(
        phase === "claim" ? "claiming" : phase === "abandon" ? "active" : "abandoned",
      );
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
      if (phase !== "completed-abandon")
        await expect(boot).rejects.toMatchObject({ code: "setup.attempt_invalid" });
      else {
        await boot;
        agent = new Agent({ connect: { ca: await fs.readFile(join(stateDir, "tls/ca.crt")) } });
        const response = await fetch(`https://127.0.0.1:${port}/setup-api/first-setup/status`, {
          dispatcher: agent,
        } as RequestInit);
        expect(response.status).toBe(200);
      }
      expect(await fs.readFile(statePath)).toEqual(stateBefore);
      expect(await fs.readFile(markerPath)).toEqual(markerBefore);
    } finally {
      vi.mocked(fs.rename).mockImplementation(
        (await vi.importActual<typeof fs>("node:fs/promises")).rename,
      );
      await server?.close();
      await agent?.close();
      await f.dispose();
    }
  },
);
