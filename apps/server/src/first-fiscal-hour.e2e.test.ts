import { randomBytes } from "node:crypto";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Agent } from "undici";
import { PASSWORD } from "../test/first-fiscal.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hourFirstFiscalFixture } from "../test/hour-first-fiscal.js";
import { createFakeTimersHourClock } from "./testing/hour-test-clock.js";
import {
  childProcess,
  entryWorkspaces,
  expectRestartExit,
  ready,
} from "../test/first-fiscal-hour-entry.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 500,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));

const fixture = entryWorkspaces();

it.each(["src/bin.ts", "src/node-entry.ts"])(
  "%s refuses Start again while a restore or reset request waits, then deletes the attempt in place and starts fresh in the same folders",
  async (script) => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime("2026-10-16T11:40:00Z");
    try {
      await hourFirstFiscalFixture({
        clock: createFakeTimersHourClock(),
        database: () => suite.db,
        workspace: f,
      });
    } finally {
      vi.useRealTimers();
    }
    await ensureBoxSecrets({
      stateDir: f.stateDir,
      hostnames: ["localhost", "waitron.local"],
      now: () => new Date(),
      listIpv4: () => ["127.0.0.1"],
    });
    const ca = await readFile(join(f.stateDir, "tls", "ca.crt"));
    let agent = new Agent({ connect: { ca } });
    let agentClosed = false;
    const closeAgent = async () => {
      if (agentClosed) return;
      agentClosed = true;
      await agent.close();
    };
    let child = await childProcess(script, f.env);
    let origin = `https://127.0.0.1:${child.port}`;
    try {
      expect(await ready(child, origin, agent)).toEqual({ claimed: true, resolution: true });
      const get = (path: string) => fetch(`${origin}${path}`, { dispatcher: agent } as RequestInit);
      const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
        fetch(`${origin}${path}`, {
          dispatcher: agent,
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin, ...headers },
          body: JSON.stringify(body),
        } as RequestInit);
      const snapshot = await (await get("/setup-api/first-setup/resolution")).json();
      const recovered = await post("/setup-api/first-setup/resolution/recover", {
        inspectionId: snapshot.inspectionId,
        revision: snapshot.revision,
        ownerGeneration: snapshot.ownerGeneration,
        clientClaimNonce: randomBytes(32).toString("base64url"),
        password: PASSWORD,
      });
      expect(recovered.status).toBe(200);
      await writeFile(join(f.stateDir, "restore-request.json"), "retired restore must not run");
      await writeFile(join(f.stateDir, "reset-request.json"), "retired reset must not run");
      const fresh = await (await get("/setup-api/first-setup/resolution")).json();
      const ids = {
        inspectionId: fresh.inspectionId,
        revision: fresh.revision,
        ownerGeneration: fresh.ownerGeneration,
      };
      const unconfirmed = await post("/setup-api/first-setup/resolution/start-again", ids);
      expect(unconfirmed.status).toBe(503);
      expect(await unconfirmed.json()).toMatchObject({ error: { code: "setup.not_ready" } });
      const summary = await post("/setup-api/first-setup/resolution/start-again/summary", ids);
      expect(summary.status).toBe(503);
      expect(await summary.json()).toMatchObject({ error: { code: "setup.not_ready" } });
      const waiting = await post("/setup-api/first-setup/resolution/start-again", {
        ...ids,
        confirmMissingDatabase: { nothingFiledOrSold: true, shown: { reached: "named" } },
      });
      expect(waiting.status).toBe(503);
      expect(await waiting.json()).toMatchObject({ error: { code: "setup.not_ready" } });
      expect(await readFile(join(f.stateDir, "restore-request.json"), "utf8")).toBe(
        "retired restore must not run",
      );
      expect(await readFile(join(f.stateDir, "reset-request.json"), "utf8")).toBe(
        "retired reset must not run",
      );
      await rm(join(f.stateDir, "restore-request.json"));
      await rm(join(f.stateDir, "reset-request.json"));
      // Removing the waiting requests changes the state a Start again must match, so read it again.
      const cleared = await (await get("/setup-api/first-setup/resolution")).json();
      const clearedIds = {
        inspectionId: cleared.inspectionId,
        revision: cleared.revision,
        ownerGeneration: cleared.ownerGeneration,
      };
      const clearedSummary = await post(
        "/setup-api/first-setup/resolution/start-again/summary",
        clearedIds,
      );
      expect(clearedSummary.status, await clearedSummary.clone().text()).toBe(200);
      const shown = await clearedSummary.json();
      const selected = await post("/setup-api/first-setup/resolution/start-again", {
        ...clearedIds,
        confirmMissingDatabase: { nothingFiledOrSold: true, shown },
      });
      expect(selected.status, await selected.clone().text()).toBe(200);
      expect(await selected.json()).toEqual({ restarting: true });
      await closeAgent();
      await expectRestartExit(child);
      child = await childProcess(script, f.env);
      origin = `https://127.0.0.1:${child.port}`;
      agent = new Agent({ connect: { ca } });
      agentClosed = false;
      expect(await ready(child, origin, agent)).toEqual({ claimed: false });
      expect((await stat(join(f.venueDir, "venue.db"))).size).toBeGreaterThan(0);
      await child.stop();
      child = await childProcess(script, f.env);
      origin = `https://127.0.0.1:${child.port}`;
      expect(await ready(child, origin, agent)).toEqual({ claimed: false });
      expect(await readFile(join(f.stateDir, "tls", "ca.crt"))).toEqual(ca);
      expect(await readdir(join(f.stateDir, "first-setup-start-again-confirmations"))).toHaveLength(
        1,
      );
      await expect(stat(join(f.stateDir, "first-setup.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(stat(join(f.venueDir, "first-setup-claim.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await child.stop();
      await closeAgent();
    }
  },
  300_000,
);
