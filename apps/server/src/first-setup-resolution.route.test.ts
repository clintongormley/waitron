import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Agent } from "undici";
import { afterEach, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { firstFiscalFixture } from "../test/first-fiscal.js";
import { hourFirstFiscalFixture } from "../test/hour-first-fiscal.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { startServerOrFirstSetupResolution } from "./node-entry.js";
import { freePorts } from "./testing/free-ports.js";
import { createFakeTimersHourClock } from "./testing/hour-test-clock.js";

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
afterEach(() => {
  vi.useRealTimers();
});

it.each(["Consumed", "Not consumed", "Unknown"])(
  "trusted HTTPS retires a missing-database attempt after %s",
  async (status) => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime("2026-10-16T11:40:00Z");
    const f = await hourFirstFiscalFixture({
      clock: createFakeTimersHourClock(),
      database: () => suite.db,
    });
    let server: { close(): Promise<void> } | undefined;
    let agent: Agent | undefined;
    try {
      await ensureBoxSecrets({
        stateDir: f.stateDir,
        hostnames: ["localhost", "waitron.local"],
        now: () => new Date(),
        listIpv4: () => ["127.0.0.1"],
      });
      const [port] = await freePorts(1);
      const restart = vi.fn();
      server = await startServerOrFirstSetupResolution(
        {
          WAITRON_STATE_DIR: f.stateDir,
          WAITRON_VENUE_DIR: f.venueDir,
          WAITRON_HTTP_PORT: String(port),
        },
        {},
        { requestRestart: restart },
      );
      agent = new Agent({ connect: { ca: await readFile(join(f.stateDir, "tls/ca.crt")) } });
      const origin = `https://127.0.0.1:${port}`;
      const get = async () =>
        (
          await fetch(`${origin}/setup-api/first-setup/resolution`, {
            dispatcher: agent,
          } as RequestInit)
        ).json();
      const post = (path: string, body: unknown, headers = {}) =>
        fetch(`${origin}/setup-api/first-setup/resolution/${path}`, {
          dispatcher: agent,
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin, ...headers },
          body: JSON.stringify(body),
        } as RequestInit);
      const current = await get();
      const ids = {
        inspectionId: current.inspectionId,
        revision: current.revision,
        ownerGeneration: current.ownerGeneration,
      };
      const register = {
        kind: "current-master",
        status,
        custodian: "Elena",
        reference: "c".repeat(64),
        consultedAt: "2026-10-16T02:00:00.000Z",
      };
      const summary = await post("start-again/summary", ids);
      expect(summary.status, await summary.clone().text()).toBe(200);
      expect(summary.headers.get("Cache-Control")).toBe("no-store");
      const shown = await summary.json();
      expect(shown).toEqual({ reached: "named" });
      const attemptFile = await readFile(join(f.stateDir, "flows/setup/record.json"));
      const unconfirmed = await post("start-again", { ...ids, register });
      expect(unconfirmed.status).toBe(503);
      expect(await unconfirmed.json()).toMatchObject({ error: { code: "setup.not_ready" } });
      expect(await readFile(join(f.stateDir, "flows/setup/record.json"))).toEqual(attemptFile);
      expect(
        await readdir(join(f.stateDir, "first-setup-start-again-confirmations")).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return [];
            throw error;
          },
        ),
      ).toEqual([]);
      const response = await post("start-again", {
        ...ids,
        register,
        confirmMissingDatabase: { nothingFiledOrSold: true, shown },
      });
      expect(response.status).toBe(200);
      const selected = await response.json();
      expect(selected).toEqual({ restarting: true });
      expect(JSON.stringify(selected)).not.toContain(f.root);
      await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
      await expect(stat(join(f.stateDir, "flows/setup/record.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        (await fetch(`${origin}/retry`, { dispatcher: agent, method: "POST" } as RequestInit))
          .status,
      ).toBe(404);
    } finally {
      await server?.close();
      await agent?.close();
      await f.dispose();
    }
  },
);

it("HTTPS rejects foreign origins, stale snapshots and malformed resolution requests without changing the attempt", async () => {
  const f = await firstFiscalFixture();
  let server: { close(): Promise<void> } | undefined;
  let agent: Agent | undefined;
  try {
    await ensureBoxSecrets({
      stateDir: f.stateDir,
      hostnames: ["localhost", "waitron.local"],
      now: () => new Date(),
      listIpv4: () => ["127.0.0.1"],
    });
    const [port] = await freePorts(1);
    server = await startServerOrFirstSetupResolution({
      WAITRON_STATE_DIR: f.stateDir,
      WAITRON_VENUE_DIR: f.venueDir,
      WAITRON_HTTP_PORT: String(port),
    });
    agent = new Agent({ connect: { ca: await readFile(join(f.stateDir, "tls/ca.crt")) } });
    const origin = `https://127.0.0.1:${port}`;
    const inspection = await (
      await fetch(`${origin}/setup-api/first-setup/resolution`, {
        dispatcher: agent,
      } as RequestInit)
    ).json();
    expect(JSON.stringify(inspection)).not.toContain(f.stateDir);
    expect(JSON.stringify(inspection)).not.toContain("scrypt$");
    const before = await readFile(join(f.stateDir, "flows/setup/record.json"));
    const base = {
      inspectionId: inspection.inspectionId,
      revision: inspection.revision,
      ownerGeneration: inspection.ownerGeneration,
    };
    const start = { ...base, register: { kind: "no-current-master", confirmed: true } };
    const cases = [
      {
        action: "start-again",
        body: start,
        headers: { Origin: "https://foreign.example" },
        status: 403,
        code: "setup.owner_required",
      },
      {
        action: "start-again",
        body: start,
        headers: { "Sec-Fetch-Site": "cross-site" },
        status: 403,
        code: "setup.owner_required",
      },
      {
        action: "start-again",
        body: { ...start, inspectionId: "c".repeat(64) },
        status: 409,
        code: "setup.attempt_conflict",
      },
      {
        action: "start-again",
        body: { ...start, revision: null },
        status: 400,
        code: "setup.request_invalid",
      },
      {
        action: "start-again",
        body: { ...start, path: f.root },
        status: 400,
        code: "setup.request_invalid",
      },
      {
        action: "start-again",
        body: { ...start, register: null },
        status: 400,
        code: "setup.request_invalid",
      },
      {
        action: "start-again",
        body: { ...start, register: { kind: "no-current-master", confirmed: 1 } },
        status: 400,
        code: "setup.request_invalid",
      },
      {
        action: "start-again",
        body: {
          ...start,
          register: {
            kind: "current-master",
            status: ["Unknown"],
            custodian: "Elena",
            reference: "c".repeat(64),
            consultedAt: "2026-10-16T02:00:00.000Z",
          },
        },
        status: 400,
        code: "setup.request_invalid",
      },
      { action: "start-again", body: start, status: 503, code: "setup.not_ready" },
    ];
    for (const test of cases) {
      const response = await fetch(`${origin}/setup-api/first-setup/resolution/${test.action}`, {
        dispatcher: agent,
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin, ...test.headers },
        body: JSON.stringify(test.body),
      } as RequestInit);
      expect(response.status, JSON.stringify(test)).toBe(test.status);
      expect(await response.json()).toMatchObject({ error: { code: test.code } });
      expect(await readFile(join(f.stateDir, "flows/setup/record.json"))).toEqual(before);
    }
  } finally {
    await server?.close();
    await agent?.close();
    await f.dispose();
  }
});

it("a shown summary carrying held counts is refused setup.request_invalid", async () => {
  const f = await firstFiscalFixture();
  let server: { close(): Promise<void> } | undefined;
  let agent: Agent | undefined;
  try {
    await ensureBoxSecrets({
      stateDir: f.stateDir,
      hostnames: ["localhost", "waitron.local"],
      now: () => new Date(),
      listIpv4: () => ["127.0.0.1"],
    });
    const [port] = await freePorts(1);
    server = await startServerOrFirstSetupResolution({
      WAITRON_STATE_DIR: f.stateDir,
      WAITRON_VENUE_DIR: f.venueDir,
      WAITRON_HTTP_PORT: String(port),
    });
    agent = new Agent({ connect: { ca: await readFile(join(f.stateDir, "tls/ca.crt")) } });
    const origin = `https://127.0.0.1:${port}`;
    const inspection = await (
      await fetch(`${origin}/setup-api/first-setup/resolution`, {
        dispatcher: agent,
      } as RequestInit)
    ).json();
    const before = await readFile(join(f.stateDir, "flows/setup/record.json"));
    const send = (held: unknown) =>
      fetch(`${origin}/setup-api/first-setup/resolution/start-again`, {
        dispatcher: agent,
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({
          inspectionId: inspection.inspectionId,
          revision: inspection.revision,
          ownerGeneration: inspection.ownerGeneration,
          register: { kind: "no-current-master", confirmed: true },
          confirmMissingDatabase: { nothingFiledOrSold: true, shown: { reached: "named", held } },
        }),
      } as RequestInit);
    const held = { rows: 20, kept: 3, records: 2, accepted: 1 };
    for (const value of [held, { ...held, extra: 1 }, { ...held, kept: -1 }, null]) {
      const response = await send(value);
      expect(response.status, JSON.stringify(value)).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "setup.request_invalid", params: { field: "body" } },
      });
    }
    expect(await readFile(join(f.stateDir, "flows/setup/record.json"))).toEqual(before);
  } finally {
    await server?.close();
    await agent?.close();
    await f.dispose();
  }
});

it("confirmUnreadableDatabase is parsed only with a shown summary that said the database cannot be read", async () => {
  const f = await firstFiscalFixture();
  let server: { close(): Promise<void> } | undefined;
  let agent: Agent | undefined;
  try {
    await ensureBoxSecrets({
      stateDir: f.stateDir,
      hostnames: ["localhost", "waitron.local"],
      now: () => new Date(),
      listIpv4: () => ["127.0.0.1"],
    });
    const [port] = await freePorts(1);
    server = await startServerOrFirstSetupResolution({
      WAITRON_STATE_DIR: f.stateDir,
      WAITRON_VENUE_DIR: f.venueDir,
      WAITRON_HTTP_PORT: String(port),
    });
    agent = new Agent({ connect: { ca: await readFile(join(f.stateDir, "tls/ca.crt")) } });
    const origin = `https://127.0.0.1:${port}`;
    const inspection = await (
      await fetch(`${origin}/setup-api/first-setup/resolution`, {
        dispatcher: agent,
      } as RequestInit)
    ).json();
    const before = await readFile(join(f.stateDir, "flows/setup/record.json"));
    const send = (confirmUnreadableDatabase: unknown) =>
      fetch(`${origin}/setup-api/first-setup/resolution/start-again`, {
        dispatcher: agent,
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({
          inspectionId: inspection.inspectionId,
          revision: inspection.revision,
          ownerGeneration: inspection.ownerGeneration,
          confirmUnreadableDatabase,
        }),
      } as RequestInit);
    for (const value of [
      { shown: { reached: "named" } },
      { shown: { reached: "named", databaseUnreadable: false } },
      { shown: { reached: "named", databaseUnreadable: "yes" } },
      { shown: { reached: "named", databaseUnreadable: true }, extra: 1 },
      null,
    ]) {
      const response = await send(value);
      expect(response.status, JSON.stringify(value)).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "setup.request_invalid", params: { field: "body" } },
      });
    }
    // Past the parser, the action answers for this fixture with its own refusal.
    const accepted = await send({ shown: { reached: "named", databaseUnreadable: true } });
    expect(await accepted.json()).toMatchObject({ error: { code: "setup.not_ready" } });
    expect(accepted.status).toBe(503);
    expect(await readFile(join(f.stateDir, "flows/setup/record.json"))).toEqual(before);
  } finally {
    await server?.close();
    await agent?.close();
    await f.dispose();
  }
});

it("the loopback resolution listener keeps certificate guidance on the local address", async () => {
  const f = await firstFiscalFixture();
  let server: { close(): Promise<void> } | undefined;
  try {
    const [port] = await freePorts(1);
    server = await startServerOrFirstSetupResolution({
      WAITRON_STATE_DIR: f.stateDir,
      WAITRON_VENUE_DIR: f.venueDir,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_HOST: "127.0.0.1",
    });
    const response = await fetch(`http://127.0.0.1:${port}/setup/trust`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toContain("waitron.local");
    expect(html).toContain(`127.0.0.1:${port}`);
  } finally {
    await server?.close();
    await f.dispose();
  }
});

it("HTTP refuses start-again before reading secrets even with forwarded HTTPS", async () => {
  const f = await firstFiscalFixture();
  let server: { close(): Promise<void> } | undefined;
  try {
    const [port] = await freePorts(1);
    server = await startServerOrFirstSetupResolution({
      WAITRON_STATE_DIR: f.stateDir,
      WAITRON_VENUE_DIR: f.venueDir,
      WAITRON_HTTP_PORT: String(port),
    });
    const before = await readFile(join(f.stateDir, "flows/setup/record.json"));
    const route = `http://127.0.0.1:${port}/setup-api/first-setup/resolution/start-again`;
    const headers = { "Content-Type": "application/json", "X-Forwarded-Proto": "https" };
    const response = await fetch(route, { method: "POST", headers, body: "not even JSON" });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("404 Not Found");
    expect(await readFile(join(f.stateDir, "flows/setup/record.json"))).toEqual(before);
    expect((await fetch(`http://127.0.0.1:${port}/setup-api/first-setup/resolution`)).status).toBe(
      404,
    );
    const admission = await resolveFirstSetupEntry(
      { stateDir: f.stateDir, venueDir: f.venueDir },
      {},
    );
    expect(admission.kind).toBe("resolution");
    if (admission.kind !== "resolution") throw new Error("Expected retained setup resolution");
    const inspection = await (
      await admission.app.request("https://localhost/setup-api/first-setup/resolution")
    ).json();
    const valid = await fetch(route, {
      method: "POST",
      headers,
      body: JSON.stringify({
        inspectionId: inspection.inspectionId,
        revision: inspection.revision,
        ownerGeneration: inspection.ownerGeneration,
        register: { kind: "no-current-master", confirmed: true },
      }),
    });
    expect(valid.status).toBe(404);
    expect(await valid.text()).toBe("404 Not Found");
    expect(await readFile(join(f.stateDir, "flows/setup/record.json"))).toEqual(before);
  } finally {
    await server?.close();
    await f.dispose();
  }
});
