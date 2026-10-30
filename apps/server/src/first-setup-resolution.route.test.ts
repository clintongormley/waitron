import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { randomBytes } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Agent } from "undici";
import { afterEach, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { firstFiscalFixture, PASSWORD } from "../test/first-fiscal.js";
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
  "trusted HTTPS recovers a missing-database attempt and retires it after %s",
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
      const before = (await f.store.read())!;
      const inspected = await get();
      const recoveredResponse = await post("recover", {
        inspectionId: inspected.inspectionId,
        revision: inspected.revision,
        ownerGeneration: inspected.ownerGeneration,
        clientClaimNonce: randomBytes(32).toString("base64url"),
        password: PASSWORD,
      });
      expect(recoveredResponse.status).toBe(200);
      expect(recoveredResponse.headers.get("Cache-Control")).toBe("no-store");
      const recovered = await recoveredResponse.json();
      expect(recovered.state).toMatchObject({
        attemptId: before.frozen.attemptId,
        status: "consumption-intent",
        consumptionIntent: true,
        ownerGeneration: 2,
      });
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
      const ownerHeaders = {
        "X-Waitron-Setup-Owner": recovered.capability,
        "X-Waitron-Setup-Attempt": recovered.state.attemptId,
        "X-Waitron-Setup-Revision": String(recovered.state.revision),
        "X-Waitron-Setup-Generation": String(recovered.state.ownerGeneration),
      };
      const summary = await post("start-again/summary", ids, ownerHeaders);
      expect(summary.status, await summary.clone().text()).toBe(200);
      const shown = await summary.json();
      expect(shown).toEqual({ reached: "named" });
      const attemptFile = await readFile(join(f.stateDir, "first-setup.json"));
      const unconfirmed = await post("start-again", { ...ids, register }, ownerHeaders);
      expect(unconfirmed.status).toBe(503);
      expect(await unconfirmed.json()).toMatchObject({ error: { code: "setup.not_ready" } });
      expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(attemptFile);
      expect(
        await readdir(join(f.stateDir, "first-setup-start-again-confirmations")).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return [];
            throw error;
          },
        ),
      ).toEqual([]);
      const at = new Date().toISOString();
      const response = await post(
        "start-again",
        { ...ids, register, confirmMissingDatabase: { nothingFiledOrSold: true, shown } },
        ownerHeaders,
      );
      expect(response.status).toBe(200);
      const confirmations = join(f.stateDir, "first-setup-start-again-confirmations");
      const written = await readdir(confirmations);
      expect(written).toEqual([`${Date.parse(at)}-${before.frozen.attemptId}.json`]);
      expect(JSON.parse(await readFile(join(confirmations, written[0]!), "utf8"))).toEqual({
        version: 1,
        at,
        attemptId: before.frozen.attemptId,
        database: "missing",
        administrator: {
          displayName: before.frozen.request.admin.displayName,
          email: before.frozen.request.admin.email,
        },
        ownerGeneration: recovered.state.ownerGeneration,
        shown,
      });
      const selected = await response.json();
      expect(selected).toEqual({ restarting: true });
      expect(JSON.stringify(selected)).not.toContain(f.root);
      await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
      await expect(stat(join(f.stateDir, "first-setup.json"))).rejects.toMatchObject({
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
    const before = await readFile(join(f.stateDir, "first-setup.json"));
    const base = {
      inspectionId: inspection.inspectionId,
      revision: inspection.revision,
      ownerGeneration: inspection.ownerGeneration,
    };
    const recover = {
      ...base,
      password: PASSWORD,
      clientClaimNonce: randomBytes(32).toString("base64url"),
    };
    const start = { ...base, register: { kind: "no-current-master", confirmed: true } };
    const cases = [
      {
        action: "recover",
        body: recover,
        headers: { Origin: "https://foreign.example" },
        status: 403,
        code: "setup.owner_required",
      },
      {
        action: "recover",
        body: recover,
        headers: { "Sec-Fetch-Site": "cross-site" },
        status: 403,
        code: "setup.owner_required",
      },
      {
        action: "recover",
        body: { ...recover, inspectionId: "c".repeat(64) },
        status: 403,
        code: "setup.owner_required",
      },
      {
        action: "recover",
        body: { ...recover, revision: null },
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
      expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
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
    const before = await readFile(join(f.stateDir, "first-setup.json"));
    const recovery = {
      startedAt: "2026-10-24T13:50:12.000Z",
      lastActiveAt: "2026-10-24T13:51:12.000Z",
      lastActiveSource: "memory",
      failed: false,
      cloud: false,
    };
    const send = (confirm: "confirmMissingDatabase" | "confirmRecoveryDiscard", held: unknown) =>
      fetch(`${origin}/setup-api/first-setup/resolution/start-again`, {
        dispatcher: agent,
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({
          inspectionId: inspection.inspectionId,
          revision: inspection.revision,
          ownerGeneration: inspection.ownerGeneration,
          register: { kind: "no-current-master", confirmed: true },
          [confirm]:
            confirm === "confirmMissingDatabase"
              ? { nothingFiledOrSold: true, shown: { reached: "named", held } }
              : { shown: { reached: "named", recovery, held } },
        }),
      } as RequestInit);
    const held = { rows: 20, kept: 3, records: 2, accepted: 1 };
    for (const confirm of ["confirmMissingDatabase", "confirmRecoveryDiscard"] as const)
      for (const value of [held, { ...held, extra: 1 }, { ...held, kept: -1 }, null]) {
        const response = await send(confirm, value);
        expect(response.status, `${confirm} ${JSON.stringify(value)}`).toBe(400);
        expect(await response.json()).toMatchObject({
          error: { code: "setup.request_invalid", params: { field: "body" } },
        });
      }
    expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
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

it.each(["recover", "start-again"])(
  "HTTP refuses %s before reading secrets even with forwarded HTTPS",
  async (path) => {
    const f = await firstFiscalFixture();
    let server: { close(): Promise<void> } | undefined;
    try {
      const [port] = await freePorts(1);
      server = await startServerOrFirstSetupResolution({
        WAITRON_STATE_DIR: f.stateDir,
        WAITRON_VENUE_DIR: f.venueDir,
        WAITRON_HTTP_PORT: String(port),
      });
      const before = await readFile(join(f.stateDir, "first-setup.json"));
      const response = await fetch(
        `http://127.0.0.1:${port}/setup-api/first-setup/resolution/${path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
          body: "not even JSON",
        },
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("404 Not Found");
      expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
      if (path === "recover") {
        expect(
          (await fetch(`http://127.0.0.1:${port}/setup-api/first-setup/resolution`)).status,
        ).toBe(404);
        const admission = await resolveFirstSetupEntry(
          { stateDir: f.stateDir, venueDir: f.venueDir },
          {},
        );
        expect(admission.kind).toBe("resolution");
        if (admission.kind !== "resolution") throw new Error("Expected retained setup resolution");
        const inspection = await (
          await admission.app.request("https://localhost/setup-api/first-setup/resolution")
        ).json();
        const valid = await fetch(
          `http://127.0.0.1:${port}/setup-api/first-setup/resolution/recover`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" },
            body: JSON.stringify({
              inspectionId: inspection.inspectionId,
              revision: inspection.revision,
              ownerGeneration: inspection.ownerGeneration,
              clientClaimNonce: randomBytes(32).toString("base64url"),
              password: PASSWORD,
            }),
          },
        );
        expect(valid.status).toBe(404);
        expect(await valid.text()).toBe("404 Not Found");
        expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
      }
    } finally {
      await server?.close();
      await f.dispose();
    }
  },
);
