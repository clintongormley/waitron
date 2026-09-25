import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { mountSetup } from "./setup-api.js";
import type { CloudRecoveryView } from "./cloud-recovery.js";
import { createSetupOperationStore } from "./setup-operation.js";

const requestId = "3728e560-fbb2-41aa-8c2b-d21f3ce1ce92";
const pointId = "9f41b8b8-b14e-472a-8eb4-f9259b80f0d1";
const view: CloudRecoveryView = {
  requestId,
  code: "12345678",
  openCloudUrl: `https://cloud.example.test/recover#request=${requestId}`,
  expiresAt: "2026-09-24T12:00:00.000Z",
  state: "approved",
  point: {
    id: pointId,
    venueId: "a7f570e8-e510-49eb-b1a7-096ff72171f5",
    capturedAt: "2026-09-24T10:00:00.000Z",
    modules: { core: 1 },
  },
};
function setup() {
  const cloudRecovery = {
    start: vi.fn(async () => view),
    status: vi.fn(async () => view),
    startAgain: vi.fn(async () => view),
    binding: vi.fn(async () => ({ requestId, pointId })),
    restore: vi.fn(
      async (
        _stage: (request: import("./restore-request.js").RestoreRequest) => Promise<void>,
        _pointId: string,
      ) => {
        void _stage;
        void _pointId;
      },
    ),
    markRestored: vi.fn(async () => {}),
    reportRestored: vi.fn(async () => {}),
  };
  const stageRestore = vi.fn(async () => {});
  const requestRestart = vi.fn();
  const app = new Hono();
  mountSetup(
    app,
    { environment: "preproduction", cloudRecovery, stageRestore, requestRestart },
    vi.fn(),
  );
  return { app, cloudRecovery, stageRestore, requestRestart };
}
describe("setup Cloud recovery", () => {
  it("starts and refreshes through a browser-safe view", async () => {
    const { app, cloudRecovery } = setup();
    const started = await app.request("/setup-api/cloud-recovery/start", { method: "POST" });
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual(view);
    const status = await app.request("/setup-api/cloud-recovery/status");
    expect(await status.json()).toEqual(view);
    expect(cloudRecovery.start).toHaveBeenCalledOnce();
    expect(cloudRecovery.status).toHaveBeenCalledOnce();
  });
  it("requires the displayed snapshot binding before local restore", async () => {
    const { app, cloudRecovery, stageRestore, requestRestart } = setup();
    const invalid = await app.request("/setup-api/cloud-recovery/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pointId: "wrong" }),
    });
    expect(invalid.status).toBe(400);
    expect(cloudRecovery.restore).not.toHaveBeenCalled();
    const result = await app.request("/setup-api/cloud-recovery/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pointId }),
    });
    expect(result.status).toBe(202);
    expect(cloudRecovery.restore).toHaveBeenCalledWith(expect.any(Function), pointId);
    const wrappedStage = cloudRecovery.restore.mock.calls[0]![0];
    const candidate = {
      artifact: Uint8Array.from([1]),
      recoveryKey: "key",
      environment: "preproduction" as const,
      managedCloud: { requestId, pointId },
    };
    await wrappedStage(candidate);
    expect(stageRestore).toHaveBeenCalledWith(candidate, { oldBoxGone: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestRestart).toHaveBeenCalledOnce();
  });
  // Slice-2 plan N23: a snapshot whose database holds bucket settings gets the old-box check.
  it.each([
    [new AppError("restore.stream_source_live", { lastChangeAt: "2026-09-24T11:58:00.000Z" })],
    [new AppError("restore.stream_source_unchecked", { reason: "bucket" })],
  ])(
    "answers a refused old-box check (%s) with 409 and stages the retry that says the old server is gone",
    async (error) => {
      for (const keepsProgress of [false, true]) {
        const dir = await mkdtemp(join(tmpdir(), "waitron-cloud-setup-refused-"));
        try {
          const { cloudRecovery, requestRestart } = setup();
          cloudRecovery.restore.mockImplementation(async (stage) => {
            await stage({
              artifact: Uint8Array.from([1]),
              recoveryKey: "key",
              environment: "preproduction",
              managedCloud: { requestId, pointId },
            });
          });
          const stageRestore = vi
            .fn()
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce(undefined);
          const app = new Hono();
          mountSetup(
            app,
            {
              environment: "preproduction",
              cloudRecovery,
              stageRestore,
              requestRestart,
              ...(keepsProgress ? { operations: createSetupOperationStore(dir) } : {}),
            },
            vi.fn(),
          );
          const send = (extra: Record<string, unknown>) =>
            app.request("/setup-api/cloud-recovery/restore", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ pointId, ...extra }),
            });
          const refused = await send({});
          expect([keepsProgress, refused.status]).toEqual([keepsProgress, 409]);
          expect(await refused.json()).toEqual({
            error: { code: error.code, params: error.params },
          });
          expect(stageRestore).toHaveBeenLastCalledWith(expect.anything(), { oldBoxGone: false });
          const retried = await send({ oldBoxGone: true });
          expect([keepsProgress, retried.status]).toEqual([keepsProgress, 202]);
          expect(stageRestore).toHaveBeenCalledTimes(2);
          expect(stageRestore).toHaveBeenLastCalledWith(expect.anything(), { oldBoxGone: true });
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
    },
  );
  it.each([["yes"], [1], [null]])(
    "refuses an old-server answer that is not a boolean (%o) without staging",
    async (oldBoxGone) => {
      const { app, cloudRecovery, stageRestore } = setup();
      const response = await app.request("/setup-api/cloud-recovery/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pointId, oldBoxGone }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "setup.request_invalid", params: { field: "oldBoxGone" } },
      });
      expect(cloudRecovery.restore).not.toHaveBeenCalled();
      expect(stageRestore).not.toHaveBeenCalled();
    },
  );
  it("does not replay an unconfirmed Cloud restore's completion for the confirmed one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waitron-cloud-setup-confirmed-"));
    try {
      const first = setup();
      const operations = createSetupOperationStore(dir);
      const app = new Hono();
      mountSetup(
        app,
        {
          environment: "preproduction",
          cloudRecovery: first.cloudRecovery,
          stageRestore: first.stageRestore,
          requestRestart: first.requestRestart,
          operations,
        },
        vi.fn(),
      );
      const send = (target: Hono, body: Record<string, unknown>) =>
        target.request("/setup-api/cloud-recovery/restore", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      expect((await send(app, { pointId })).status).toBe(202);
      const hash = (await operations.read())?.requestHash;
      const second = setup();
      const restarted = new Hono();
      mountSetup(
        restarted,
        {
          environment: "preproduction",
          cloudRecovery: second.cloudRecovery,
          stageRestore: second.stageRestore,
          requestRestart: second.requestRestart,
          operations: createSetupOperationStore(dir),
        },
        vi.fn(),
      );
      const confirmed = await send(restarted, { pointId, oldBoxGone: true });
      expect(confirmed.status).toBe(409);
      expect((await confirmed.json()).error.code).toBe("setup.operation_conflict");
      expect(second.cloudRecovery.restore).not.toHaveBeenCalled();
      expect((await operations.read())?.requestHash).toBe(hash);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("refuses a different valid snapshot without an operation store", async () => {
    const { app, cloudRecovery, stageRestore, requestRestart } = setup();
    const response = await app.request("/setup-api/cloud-recovery/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pointId: "715955bb-2dbd-4481-9746-f6d3e95a8651" }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("setup.operation_conflict");
    expect(cloudRecovery.restore).not.toHaveBeenCalled();
    expect(stageRestore).not.toHaveBeenCalled();
    expect(requestRestart).not.toHaveBeenCalled();
  });
  it("does not replay a completed restore for a different request to the same snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waitron-cloud-setup-"));
    try {
      const first = setup();
      const app = new Hono();
      mountSetup(
        app,
        {
          environment: "preproduction",
          cloudRecovery: first.cloudRecovery,
          stageRestore: first.stageRestore,
          requestRestart: first.requestRestart,
          operations: createSetupOperationStore(dir),
        },
        vi.fn(),
      );
      const body = JSON.stringify({ pointId });
      expect(
        (
          await app.request("/setup-api/cloud-recovery/restore", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          })
        ).status,
      ).toBe(202);
      const second = setup();
      second.cloudRecovery.binding.mockResolvedValue({
        requestId: "734c805e-70e1-4d0b-b5f2-37a4efc431e8",
        pointId,
      });
      const restarted = new Hono();
      mountSetup(
        restarted,
        {
          environment: "preproduction",
          cloudRecovery: second.cloudRecovery,
          stageRestore: second.stageRestore,
          requestRestart: second.requestRestart,
          operations: createSetupOperationStore(dir),
        },
        vi.fn(),
      );
      expect(
        (
          await restarted.request("/setup-api/cloud-recovery/restore", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          })
        ).status,
      ).toBe(409);
      expect(second.cloudRecovery.restore).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("restarts after a completed restore response is replayed on a fresh setup API", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waitron-cloud-setup-replay-"));
    try {
      const first = setup();
      const app = new Hono();
      mountSetup(
        app,
        {
          environment: "preproduction",
          cloudRecovery: first.cloudRecovery,
          stageRestore: first.stageRestore,
          requestRestart: first.requestRestart,
          operations: createSetupOperationStore(dir),
        },
        vi.fn(),
      );
      const body = JSON.stringify({ pointId });
      const initial = await app.request("/setup-api/cloud-recovery/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(initial.status).toBe(202);
      await vi.waitFor(() => expect(first.requestRestart).toHaveBeenCalledOnce());

      const second = setup();
      const restarted = new Hono();
      mountSetup(
        restarted,
        {
          environment: "preproduction",
          cloudRecovery: second.cloudRecovery,
          stageRestore: second.stageRestore,
          requestRestart: second.requestRestart,
          operations: createSetupOperationStore(dir),
        },
        vi.fn(),
      );
      const replay = await restarted.request("/setup-api/cloud-recovery/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(replay.status).toBe(202);
      expect(second.cloudRecovery.restore).not.toHaveBeenCalled();
      expect(second.stageRestore).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(second.requestRestart).toHaveBeenCalledOnce());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
