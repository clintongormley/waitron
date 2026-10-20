import { Socket } from "node:net";
import { Hono } from "hono";
import { TLSSocket } from "node:tls";
import { afterEach, expect, it, vi } from "vitest";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { mountSetup, type SetupDeps } from "./setup-api.js";

const sockets: TLSSocket[] = [];
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
});
const preparation = {
  binding: {
    module: "test-regime",
    action: "restore",
    eventId: "interactive-restore",
    sourceId: "selected-copy",
    targetNodeId: "d0000000-0000-4000-8000-000000000001",
  },
  context: { selectedSourceId: "selected-copy", oldBoxGone: true, soleRecovery: true },
  nodeRecoverySecret: "matching named key",
  proposal: { action: "clock-challenge" },
};
const bucket = { kind: "bucket", kit: "private bucket kit", environment: "preproduction" };
function fixture() {
  const app = new Hono();
  const log = vi.fn();
  const coordinator = createFirstSetupCoordinator();
  const execute = vi.fn(async (_source, _input, hold) =>
    coordinator.held(hold, async () => ({ id: "module-clock-challenge", expiresInMs: 5000 })),
  );
  mountSetup(
    app,
    {
      environment: "preproduction",
      firstSetup: { coordinator, assertOtherAllowed: async () => {} },
      prepareRecovery: execute,
    } as SetupDeps,
    log,
  );
  return { app, execute, log };
}
function tls() {
  const socket = new TLSSocket(new Socket());
  sockets.push(socket);
  return { incoming: { socket } };
}
function request(source: unknown = bucket, input: unknown = preparation, headers = {}) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ source, preparation: input }),
  };
}
const path = "/setup-api/recovery/preparation";
it("prepares a bucket recovery within the existing setup hold without reflecting secrets", async () => {
  const { app, execute, log } = fixture();
  const response = await app.request(path, request(), tls());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: "module-clock-challenge", expiresInMs: 5000 });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(execute).toHaveBeenCalledWith(bucket, preparation, expect.any(Object));
  expect(JSON.stringify(log.mock.calls)).not.toContain(preparation.nodeRecoverySecret);
  expect(JSON.stringify(log.mock.calls)).not.toContain(bucket.kit);
});
it("forwards a managed Cloud point without accepting client-supplied archive credentials", async () => {
  const { app, execute } = fixture();
  const source = { kind: "cloud", pointId: "d0000000-0000-4000-8000-000000000002" };
  const response = await app.request(path, request(source), tls());
  expect(response.status).toBe(200);
  expect(execute).toHaveBeenCalledWith(source, preparation, expect.any(Object));
});
it("reads archive bytes and the separate backup password from multipart input", async () => {
  const { app, execute } = fixture();
  const source = { kind: "archive", recoveryKey: "archive password", environment: "production" };
  const form = new FormData();
  form.set("request", JSON.stringify({ source, preparation }));
  form.set("artifact", new Blob([new Uint8Array([7, 2, 9])]), "selected.wbk");
  const response = await app.request(path, { method: "POST", body: form }, tls());
  expect(response.status).toBe(200);
  expect(execute).toHaveBeenCalledWith(
    { ...source, artifact: new Uint8Array([7, 2, 9]) },
    preparation,
    expect.any(Object),
  );
});
it.each(["plain", "forwarded", "origin", "site"])(
  "refuses %s transport before consuming recovery secrets",
  async (fault) => {
    const { app, execute } = fixture();
    const headers =
      fault === "forwarded"
        ? { "x-forwarded-proto": "https" }
        : fault === "origin"
          ? { origin: "https://attacker.test" }
          : fault === "site"
            ? { "sec-fetch-site": "cross-site" }
            : {};
    const response = await app.request(
      path,
      request(bucket, preparation, headers),
      fault === "plain" || fault === "forwarded" ? undefined : tls(),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "setup.owner_required", params: {} } });
    expect(execute).not.toHaveBeenCalled();
  },
);
it.each([
  [{ ...preparation, nodeRecoverySecret: "" }, "nodeRecoverySecret"],
  [{ ...preparation, nodeRecoverySecret: "x".repeat(4097) }, "nodeRecoverySecret"],
  [{ ...preparation, context: { ...preparation.context, soleRecovery: null } }, "recoveryContext"],
  [{ ...preparation, binding: { ...preparation.binding, action: "promote" } }, "recoveryOperation"],
  [{ ...preparation, authority: "untrusted" }, "body"],
])("refuses malformed preparation without dispatch (%j)", async (input, field) => {
  const { app, execute } = fixture();
  const response = await app.request(path, request(bucket, input), tls());
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "setup.request_invalid", params: { field } },
  });
  expect(execute).not.toHaveBeenCalled();
});
it("keeps the endpoint unavailable when the owned recovery host is absent", async () => {
  const app = new Hono();
  mountSetup(app, { environment: "preproduction" }, () => {});
  const response = await app.request(path, request(), tls());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
});

it("refuses malformed multipart input as a request error without dispatching", async () => {
  const { app, execute } = fixture();
  const response = await app.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=missing" },
      body: "not a multipart body",
    },
    tls(),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "setup.request_invalid", params: { field: "body" } },
  });
  expect(execute).not.toHaveBeenCalled();
});

it("stops reading an oversized streamed archive even without Content-Length", async () => {
  const { mountRecoveryPreparationApi } = await import("./setup-recovery-preparation-api.js");
  const { createErrorBoundary } = await import("@waitron/server-kit");
  const execute = vi.fn(async () => ({}));
  const app = new Hono();
  const coordinator = createFirstSetupCoordinator();
  mountRecoveryPreparationApi(
    app,
    {
      environment: "preproduction",
      prepareRecovery: execute,
      firstSetup: { coordinator, assertOtherAllowed: async () => {} },
    },
    () => {},
    {
      uploadLimit: 8,
      hold: () => undefined,
      busy: () => false,
      run: createErrorBoundary({ "setup.request_invalid": 400 }, "setup.restore_failed"),
    },
  );
  let consumed = 0;
  let cancelled = false;
  const encoder = new TextEncoder();
  const source = { kind: "archive", recoveryKey: "archive password", environment: "production" };
  const prefix = encoder.encode(
    `--bounded\r\nContent-Disposition: form-data; name="request"\r\n\r\n${JSON.stringify({ source, preparation })}\r\n--bounded\r\nContent-Disposition: form-data; name="artifact"; filename="copy.wbk"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      consumed++;
      if (consumed === 1) controller.enqueue(prefix);
      else if (consumed <= 9) controller.enqueue(new Uint8Array(65536).fill(65));
      else {
        controller.enqueue(encoder.encode("\r\n--bounded--\r\n"));
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request(`https://box.test${path}`, {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=bounded" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  const response = await app.request(request, undefined, tls());
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "setup.request_invalid", params: { field: "artifact" } },
  });
  expect(cancelled).toBe(true);
  expect(consumed).toBeLessThan(9);
  expect(execute).not.toHaveBeenCalled();
});
