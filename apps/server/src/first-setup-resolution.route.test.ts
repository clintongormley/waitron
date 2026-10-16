import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Agent } from "undici";
import { expect, it, vi } from "vitest";
import { firstFiscalFixture, PASSWORD } from "../test/first-fiscal.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { startServerOrFirstSetupResolution } from "./node-entry.js";
import { freePorts } from "./testing/free-ports.js";

it.each(["Consumed", "Not consumed", "Unknown"])(
  "trusted HTTPS recovers a missing-database attempt and retires it after %s",
  async (status) => {
    const f = await firstFiscalFixture();
    let server: { close(): Promise<void> } | undefined;
    let agent: Agent | undefined;
    try {
      await ensureBoxSecrets({
        stateDir: f.stateDir,
        hostnames: ["localhost"],
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
      const response = await post(
        "start-again",
        {
          inspectionId: current.inspectionId,
          revision: current.revision,
          ownerGeneration: current.ownerGeneration,
          register: {
            kind: "current-master",
            status,
            custodian: "Elena",
            reference: "c".repeat(64),
            consultedAt: "2026-10-16T02:00:00.000Z",
          },
        },
        {
          "X-Waitron-Setup-Owner": recovered.capability,
          "X-Waitron-Setup-Attempt": recovered.state.attemptId,
          "X-Waitron-Setup-Revision": String(recovered.state.revision),
          "X-Waitron-Setup-Generation": String(recovered.state.ownerGeneration),
        },
      );
      expect(response.status).toBe(200);
      const selected = await response.json();
      expect(selected).toEqual({
        workspaceId: expect.any(String),
        selectionGeneration: 1,
        restarting: true,
      });
      expect(JSON.stringify(selected)).not.toContain(f.root);
      await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
      const retained = JSON.parse(await readFile(join(f.stateDir, "first-setup.json"), "utf8"));
      expect(retained.consumptionIntent).toBe(true);
      expect(retained.frozen).toEqual(before.frozen);
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
      hostnames: ["localhost"],
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
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: { code: "setup.owner_required", params: {} },
      });
      expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
      if (path === "recover") {
        const inspection = await (
          await fetch(`http://127.0.0.1:${port}/setup-api/first-setup/resolution`)
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
        expect(valid.status).toBe(403);
        expect(await readFile(join(f.stateDir, "first-setup.json"))).toEqual(before);
      }
    } finally {
      await server?.close();
      await f.dispose();
    }
  },
);
