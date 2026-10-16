import { randomUUID, randomBytes } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { Agent } from "undici";
import { afterEach, expect, it, vi } from "vitest";
import {
  createFirstSetupCoordinator,
  createFirstSetupResolutionStore,
  resolveFirstSetupWorkspace,
  selectFirstSetupWorkspace,
} from "@waitron/provisioning";
import * as filesystem from "node:fs/promises";
import { firstFiscalFixture, PASSWORD } from "../test/first-fiscal.js";
import { startServerOrFirstSetupResolution } from "./node-entry.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { freePorts } from "./testing/free-ports.js";
vi.mock("node:fs/promises", { spy: true });
afterEach(() => vi.restoreAllMocks());

async function fixture(point = "first-setup-workspace.json", tls = true) {
  const f = await firstFiscalFixture();
  let server: { close(): Promise<void> } | undefined;
  let agent: Agent | undefined;
  try {
    const anchor = { stateDir: await realpath(f.stateDir), venueDir: await realpath(f.venueDir) };
    if (tls)
      await ensureBoxSecrets({
        stateDir: anchor.stateDir,
        hostnames: ["localhost"],
        now: () => new Date(),
        listIpv4: () => ["127.0.0.1"],
      });
    const resolutionId = randomUUID(),
      workspaceId = randomUUID();
    const base = join(anchor.stateDir, "first-setup-workspaces", workspaceId);
    const binding = {
      anchorStateDir: anchor.stateDir,
      anchorVenueDir: anchor.venueDir,
      stateDir: join(base, "state"),
      venueDir: join(base, "venue"),
      resolutionId,
      workspaceId,
      selectionGeneration: 1,
    };
    const records = createFirstSetupResolutionStore({
      ...anchor,
      coordinator: createFirstSetupCoordinator(),
    });
    const before = await readFile(join(anchor.stateDir, "first-setup.json"));
    const prepared = await records.prepare(
      {
        resolutionId,
        attemptId: f.ownerAttempt.attemptId,
        observedRevision: f.ownerAttempt.revision,
        observedOwnerGeneration: 1,
        database: "missing",
        authority: "original-password",
        register: {
          kind: "current-master",
          status: "Unknown",
          custodian: "Elena",
          reference: "c".repeat(64),
          consultedAt: "2026-10-16T02:00:00.000Z",
        },
        action: "retire",
        nextWorkspace: binding,
      },
      [
        { name: "state/first-setup.json", bytes: before },
        {
          name: "venue/first-setup-claim.json",
          bytes: await readFile(join(anchor.venueDir, "first-setup-claim.json")),
        },
        { name: "venue/venue.db", bytes: null },
      ],
    );
    const retired = await records.apply(prepared);
    const actual = (await vi.importActual<typeof filesystem>("node:fs/promises")).rename;
    let injected = false;
    vi.spyOn(filesystem, "rename").mockImplementation(async (from, to) => {
      if (String(to).endsWith(point) && !injected) {
        injected = true;
        throw new Error("selection interruption");
      }
      await actual(from, to);
    });
    await expect(selectFirstSetupWorkspace(anchor, retired)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    expect(injected).toBe(true);
    vi.mocked(filesystem.rename).mockRestore();
    const [port] = await freePorts(1);
    const restart = vi.fn();
    server = await startServerOrFirstSetupResolution(
      {
        WAITRON_STATE_DIR: anchor.stateDir,
        WAITRON_VENUE_DIR: anchor.venueDir,
        WAITRON_HTTP_PORT: String(port),
        WAITRON_HTTP_HOST: "127.0.0.1",
      },
      {},
      { requestRestart: restart },
    );
    agent = tls
      ? new Agent({ connect: { ca: await readFile(join(anchor.stateDir, "tls/ca.crt")) } })
      : new Agent();
    const origin = `${tls ? "https" : "http"}://127.0.0.1:${port}`;
    const get = async () =>
      fetch(`${origin}/setup-api/first-setup/resolution/selection`, {
        dispatcher: agent,
      } as RequestInit);
    const post = (body: unknown, headers = {}) =>
      fetch(`${origin}/setup-api/first-setup/resolution/resume-selection`, {
        dispatcher: agent,
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin, ...headers },
        body: JSON.stringify(body),
      } as RequestInit);
    return {
      ...f,
      anchor,
      binding,
      records,
      before,
      restart,
      get,
      post,
      origin,
      agent,
      dispose: async () => {
        await server?.close();
        await agent?.close();
        await f.dispose();
      },
    };
  } catch (error) {
    await server?.close();
    await agent?.close();
    await f.dispose();
    throw error;
  }
}

it.each(["first-setup-workspace.json", "first-setup-selection.json", "000004.json"])(
  "HTTPS resumes only the retained selection after %s with the original password",
  async (point) => {
    const f = await fixture(point);
    try {
      const response = await f.get();
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const inspection = await response.json();
      expect(inspection).toEqual({
        inspectionId: expect.stringMatching(/^[a-f0-9]{64}$/),
        revision: f.ownerAttempt.revision,
        ownerGeneration: 1,
        workspaceId: f.binding.workspaceId,
        selectionGeneration: 1,
      });
      expect(JSON.stringify(inspection)).not.toContain(f.root);
      const wrong = await f.post({ ...inspection, password: "wrong" });
      expect(wrong.status).toBe(403);
      expect(await wrong.json()).toMatchObject({ error: { code: "setup.owner_required" } });
      await expect(resolveFirstSetupWorkspace(f.anchor)).rejects.toMatchObject({
        code: "setup.attempt_uncertain",
      });
      const resumed = await f.post({ ...inspection, password: PASSWORD });
      expect(resumed.status).toBe(200);
      expect(await resumed.json()).toEqual({
        workspaceId: f.binding.workspaceId,
        selectionGeneration: 1,
        restarting: true,
      });
      await vi.waitFor(() => expect(f.restart).toHaveBeenCalledOnce());
      expect((await resolveFirstSetupWorkspace(f.anchor)).binding).toEqual(f.binding);
      expect(await readFile(join(f.anchor.stateDir, "first-setup.json"))).toEqual(f.before);
      await expect(stat(join(f.anchor.venueDir, "venue.db"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(
        (await f.records.read(f.binding.resolutionId)).map(({ action, phase }) => [action, phase]),
      ).toEqual([
        ["retire", "prepared"],
        ["retire", "applied"],
        ["select-workspace", "prepared"],
        ["select-workspace", "applied"],
      ]);
      const replay = await f.post({ ...inspection, password: PASSWORD });
      expect(replay.status).toBe(409);
    } finally {
      await f.dispose();
    }
  },
);

it("HTTP rejects a complete selection password request despite forwarded HTTPS", async () => {
  const f = await fixture("first-setup-selection.json", false);
  try {
    const inspection = await (await f.get()).json();
    const response = await f.post(
      { ...inspection, password: PASSWORD },
      { "X-Forwarded-Proto": "https" },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "setup.owner_required", params: {} } });
    await expect(resolveFirstSetupWorkspace(f.anchor)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    expect(f.restart).not.toHaveBeenCalled();
  } finally {
    await f.dispose();
  }
});

it("rejects foreign origins, altered binding fields and stale retained observations", async () => {
  const f = await fixture();
  try {
    const inspection = await (await f.get()).json();
    for (const [body, headers, status, code] of [
      [
        { ...inspection, password: PASSWORD },
        { Origin: "https://other.example.test" },
        403,
        "setup.owner_required",
      ],
      [
        { ...inspection, workspaceId: randomUUID(), password: PASSWORD },
        {},
        409,
        "setup.attempt_conflict",
      ],
      [
        { ...inspection, selectionGeneration: 2, password: PASSWORD },
        {},
        409,
        "setup.attempt_conflict",
      ],
      [
        { ...inspection, ownerGeneration: 2, password: PASSWORD },
        {},
        409,
        "setup.attempt_conflict",
      ],
      [
        { ...inspection, inspectionId: "a".repeat(64), password: PASSWORD },
        {},
        409,
        "setup.attempt_conflict",
      ],
      [{ ...inspection, venueDir: f.root, password: PASSWORD }, {}, 400, "setup.request_invalid"],
      [{ ...inspection, revision: null, password: PASSWORD }, {}, 400, "setup.request_invalid"],
    ] as const) {
      const response = await f.post(body, headers);
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(f.anchor.stateDir, "first-setup.json"),
      Buffer.concat([f.before, Buffer.from(" ")]),
    );
    const stale = await f.post({ ...inspection, password: PASSWORD });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "setup.attempt_uncertain" } });
    expect(f.restart).not.toHaveBeenCalled();
  } finally {
    await f.dispose();
  }
});

it("serialises competing resumptions and publishes one applied selection", async () => {
  const f = await fixture();
  try {
    const inspection = await (await f.get()).json();
    const responses = await Promise.all([
      f.post({ ...inspection, password: PASSWORD }),
      f.post({ ...inspection, password: PASSWORD }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await f.records.read(f.binding.resolutionId)).map((record) => record.sequence)).toEqual(
      [1, 2, 3, 4],
    );
    await vi.waitFor(() => expect(f.restart).toHaveBeenCalledOnce());
    expect(await readFile(join(f.anchor.stateDir, "first-setup.json"))).toEqual(f.before);
  } finally {
    await f.dispose();
  }
});

it("shares failed-password throttling with unfinished-setup ownership recovery", async () => {
  const f = await fixture();
  try {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const inspection = await (await f.get()).json();
    let throttled = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await f.post({ ...inspection, password: "wrong" });
      if (response.status === 429) {
        expect(await response.json()).toMatchObject({ error: { code: "password.throttled" } });
        throttled = true;
        break;
      }
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "setup.owner_required" } });
    }
    expect(throttled).toBe(true);
    const response = await f.post({ ...inspection, password: PASSWORD });
    expect(response.status).toBe(429);
    const recovery = await fetch(`${f.origin}/setup-api/first-setup/resolution/recover`, {
      method: "POST",
      dispatcher: f.agent,
      headers: { "Content-Type": "application/json", Origin: f.origin },
      body: JSON.stringify({
        inspectionId: inspection.inspectionId,
        revision: inspection.revision,
        ownerGeneration: inspection.ownerGeneration,
        clientClaimNonce: randomBytes(32).toString("base64url"),
        password: PASSWORD,
      }),
    } as RequestInit);
    expect(recovery.status).toBe(429);
    expect(await recovery.json()).toMatchObject({ error: { code: "password.throttled" } });
    expect(f.restart).not.toHaveBeenCalled();
  } finally {
    await f.dispose();
  }
});

it("a no-master declaration cannot resume a retirement that required the original password", async () => {
  const f = await fixture();
  try {
    const inspection = await (await f.get()).json();
    const response = await f.post({
      ...inspection,
      register: { kind: "no-current-master", confirmed: true },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "setup.not_ready" } });
    await expect(resolveFirstSetupWorkspace(f.anchor)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    expect(f.restart).not.toHaveBeenCalled();
  } finally {
    await f.dispose();
  }
});
