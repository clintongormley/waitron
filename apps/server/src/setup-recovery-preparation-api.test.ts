import { useSetupArchiveUpload } from "./testing/setup-archive-upload.js";
import { Socket } from "node:net";
import { Hono } from "hono";
import { TLSSocket } from "node:tls";
import { afterEach, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { encodeRecoveryKit } from "@waitron/stream";
import { generateNodeKeyPair } from "@waitron/membership";
import { createSetupRecoveryPreparation } from "./recovery-preparation.js";
import { prepareStreamRestore } from "./restore-stream.js";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { mountSetup, type SetupDeps } from "./setup-api.js";
import type { PrepareRecovery } from "./setup-recovery-preparation-api.js";

vi.mock("./restore-stream.js", { spy: true });

const receiveArchive = useSetupArchiveUpload();
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
function fixture(extra: Partial<SetupDeps> = {}) {
  const app = new Hono();
  const log = vi.fn();
  const coordinator = createFirstSetupCoordinator();
  const execute = vi.fn<PrepareRecovery>(async (_source, _input, hold) =>
    coordinator.held(hold!, async () => ({ id: "module-clock-challenge", expiresInMs: 5000 })),
  );
  mountSetup(
    app,
    {
      environment: "preproduction",
      receiveArchive,
      firstSetup: { coordinator, assertOtherAllowed: async () => {} },
      prepareRecovery: execute,
      recoveryOperationPath: "/run/recovery-operation.json",
      ...extra,
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
  expect(execute).toHaveBeenCalledWith(
    bucket,
    preparation,
    expect.any(Object),
    { onBox: true },
    expect.any(AbortSignal),
  );
  expect(JSON.stringify(log.mock.calls)).not.toContain(preparation.nodeRecoverySecret);
  expect(JSON.stringify(log.mock.calls)).not.toContain(bucket.kit);
});
it("tells the preparation whether the request came from the box itself", async () => {
  const from = (address: string) => {
    const socket = new TLSSocket(new Socket());
    sockets.push(socket);
    Object.defineProperty(socket, "remoteAddress", { value: address });
    return { incoming: { socket } };
  };
  const { app, execute } = fixture();
  expect((await app.request(path, request(), from("127.0.0.1"))).status).toBe(200);
  expect((await app.request(path, request(), from("192.0.2.7"))).status).toBe(200);
  expect(execute.mock.calls.map((call) => call[3])).toEqual([{ onBox: true }, { onBox: false }]);
  const other = fixture({ requestFromBox: () => false });
  expect((await other.app.request(path, request(), from("127.0.0.1"))).status).toBe(200);
  expect(other.execute.mock.calls.map((call) => call[3])).toEqual([{ onBox: false }]);
});
it("forwards a managed Cloud point without accepting client-supplied archive credentials", async () => {
  const { app, execute } = fixture();
  const source = { kind: "cloud", pointId: "d0000000-0000-4000-8000-000000000002" };
  const response = await app.request(path, request(source), tls());
  expect(response.status).toBe(200);
  expect(execute).toHaveBeenCalledWith(
    source,
    preparation,
    expect.any(Object),
    { onBox: true },
    expect.any(AbortSignal),
  );
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
    { onBox: true },
    expect.any(AbortSignal),
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
      receiveArchive,
      prepareRecovery: execute,
      firstSetup: { coordinator, assertOtherAllowed: async () => {} },
    },
    () => {},
    {
      uploadLimit: 8,
      hold: () => undefined,
      busy: () => false,
      setBusy: () => {},
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

const stagedId = "5c1d6c43-4f61-4c4a-9e0b-0a8f2f8d9a11";
function stageFixture() {
  const stageRecovery = vi.fn(async () => ({ stagedId }));
  const discardStagedRecovery = vi.fn(async () => {});
  return {
    ...fixture({ stageRecovery, discardStagedRecovery }),
    stageRecovery,
    discardStagedRecovery,
  };
}
function stageForm(
  request: unknown,
  artifact: Uint8Array<ArrayBuffer> | null = new Uint8Array([7, 2, 9]),
) {
  const form = new FormData();
  form.set("request", JSON.stringify(request));
  if (artifact !== null) form.set("artifact", new Blob([artifact]), "selected.wbk");
  return { method: "POST", body: form };
}
const archiveSource = {
  kind: "archive",
  recoveryKey: "archive password",
  environment: "production",
};
it("stages a checked archive once for its restore event and answers only its id", async () => {
  const { app, stageRecovery, log } = stageFixture();
  const response = await app.request(
    "/setup-api/recovery/stage",
    stageForm({ eventId: "interactive-restore", source: archiveSource }),
    tls(),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ stagedId });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(stageRecovery).toHaveBeenCalledWith("interactive-restore", {
    ...archiveSource,
    kind: "archive-file",
    artifactPath: expect.stringContaining("upload-"),
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("archive password");
});
it.each([
  ["no artifact", { eventId: "e", source: archiveSource }, null, "artifact"],
  ["a bucket source", { eventId: "e", source: bucket }, new Uint8Array([1]), "body"],
  ["no event", { source: archiveSource }, new Uint8Array([1]), "body"],
  ["an empty event", { eventId: "", source: archiveSource }, new Uint8Array([1]), "eventId"],
])("refuses a stage with %s", async (_name, request, artifact, field) => {
  const { app, stageRecovery } = stageFixture();
  const response = await app.request(
    "/setup-api/recovery/stage",
    stageForm(request, artifact),
    tls(),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "setup.request_invalid", params: { field } },
  });
  expect(stageRecovery).not.toHaveBeenCalled();
});
it("refuses a stage over plain transport", async () => {
  const { app, stageRecovery } = stageFixture();
  const response = await app.request(
    "/setup-api/recovery/stage",
    stageForm({ eventId: "e", source: archiveSource }),
  );
  expect(response.status).toBe(403);
  expect(stageRecovery).not.toHaveBeenCalled();
});
it("prepares from a staged copy named in a small JSON body", async () => {
  const { app, execute } = stageFixture();
  const source = { kind: "staged", stagedId };
  const response = await app.request(path, request(source), tls());
  expect(response.status).toBe(200);
  expect(execute).toHaveBeenCalledWith(
    source,
    preparation,
    expect.any(Object),
    { onBox: true },
    expect.any(AbortSignal),
  );
});
it.each(["../../state/secrets", "5C1D6C43-4F61-4C4A-9E0B-0A8F2F8D9A1", "", 7])(
  "refuses a malformed staged id (%j) before it reaches the preparation",
  async (id) => {
    const { app, execute } = stageFixture();
    const response = await app.request(path, request({ kind: "staged", stagedId: id }), tls());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "setup.request_invalid", params: { field: "stagedId" } },
    });
    expect(execute).not.toHaveBeenCalled();
  },
);
it("refuses a staged source sent beside an uploaded artifact", async () => {
  const { app, execute } = stageFixture();
  const form = new FormData();
  form.set("request", JSON.stringify({ source: { kind: "staged", stagedId }, preparation }));
  form.set("artifact", new Blob([new Uint8Array([1])]), "selected.wbk");
  const response = await app.request(path, { method: "POST", body: form }, tls());
  expect(response.status).toBe(400);
  expect(execute).not.toHaveBeenCalled();
});
it("discards a staged copy by its id", async () => {
  const { app, discardStagedRecovery } = stageFixture();
  const response = await app.request(
    "/setup-api/recovery/stage/discard",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stagedId }),
    },
    tls(),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ discarded: true });
  expect(discardStagedRecovery).toHaveBeenCalledWith(stagedId);
  const bad = await app.request(
    "/setup-api/recovery/stage/discard",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stagedId: "x" }),
    },
    tls(),
  );
  expect(bad.status).toBe(400);
  expect(discardStagedRecovery).toHaveBeenCalledTimes(1);
});
it("discards the staged copy once the restore is staged, and keeps it when the restore is refused", async () => {
  const clearStagedRecovery = vi.fn(async () => {});
  const stageRestore = vi.fn<NonNullable<SetupDeps["stageRestore"]>>(async () => {});
  const { app } = fixture({ clearStagedRecovery, stageRestore, requestRestart: () => {} });
  const restore = () =>
    app.request("/setup-api/restore", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-waitron-recovery-key": "archive password",
        "x-waitron-restore-environment": "preproduction",
      },
      body: new Uint8Array([7, 2, 9]),
    });
  stageRestore.mockRejectedValueOnce(new Error("refused"));
  expect((await restore()).status).toBe(500);
  expect(clearStagedRecovery).not.toHaveBeenCalled();
  expect((await restore()).status).toBe(202);
  expect(clearStagedRecovery).toHaveBeenCalledTimes(1);
});
it("accepts a staged restore and restarts even when the staged copy cannot be deleted", async () => {
  const clearStagedRecovery = vi.fn(async () => {
    throw Object.assign(new Error("permission denied"), { code: "EACCES" });
  });
  const stageRestore = vi.fn<NonNullable<SetupDeps["stageRestore"]>>(async () => {});
  const requestRestart = vi.fn();
  const { app, log } = fixture({ clearStagedRecovery, stageRestore, requestRestart });
  const response = await app.request("/setup-api/restore", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-waitron-recovery-key": "archive password",
      "x-waitron-restore-environment": "preproduction",
    },
    body: new Uint8Array([7, 2, 9]),
  });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ restoreStaged: true, restarting: true });
  await vi.waitFor(() => expect(requestRestart).toHaveBeenCalledTimes(1));
  expect(stageRestore).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith("warn", "setup.staged_recovery_clear_failed", {});
});
it("keeps the stage route unavailable without the first-setup host", async () => {
  const stageRecovery = vi.fn(async () => ({ stagedId }));
  const app = new Hono();
  mountSetup(app, { environment: "preproduction", receiveArchive, stageRecovery }, () => {});
  const response = await app.request(
    "/setup-api/recovery/stage",
    stageForm({ eventId: "e", source: archiveSource }),
    tls(),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: { code: "setup.not_ready", params: {} } });
  expect(stageRecovery).not.toHaveBeenCalled();
});
it("holds the shared upload gate through staging and releases it after refusal", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stageRecovery = vi.fn(async () => {
    await waiting;
    throw new AppError("recovery.passphrase_invalid", {});
  });
  const { app } = fixture({ stageRecovery });
  const send = () =>
    app.request(
      "/setup-api/recovery/stage",
      stageForm({ eventId: "interactive-restore", source: archiveSource }),
      tls(),
    );
  const first = send();
  await vi.waitFor(() => expect(stageRecovery).toHaveBeenCalledOnce());
  let secondStatus: number | undefined;
  const second = Promise.resolve(send()).then((response) => {
    secondStatus = response.status;
  });
  try {
    await expect.poll(() => secondStatus).toBe(409);
  } finally {
    release();
    await first;
    await second;
  }
  expect((await send()).status).toBe(422);
  expect(stageRecovery).toHaveBeenCalledTimes(2);
});
it("releases the upload gate even when removing the received file fails", async () => {
  const upload = {
    artifactPath: "/owned/upload",
    byteLength: 1,
    fields: new Map([
      ["request", JSON.stringify({ eventId: "interactive-restore", source: archiveSource })],
    ]),
    dispose: async () => {
      throw new Error("cleanup failed");
    },
  };
  const { app } = fixture({
    stageRecovery: async () => ({ stagedId }),
    receiveArchive: async () => upload,
  });
  const send = () =>
    app.request(
      "/setup-api/recovery/stage",
      stageForm({ eventId: "interactive-restore", source: archiveSource }),
      tls(),
    );
  expect((await send()).status).toBe(500);
  expect((await send()).status).toBe(500);
});
it("refuses an upload before the setup queue while configuration staging is busy", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stageConfiguration = vi.fn(async () => {
    await waiting;
    return { venue: {} as never, modules: [], reconnectModules: [] };
  });
  const { app } = fixture({ stageConfiguration, stageRecovery: async () => ({ stagedId }) });
  const first = app.request("/setup-api/configuration", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-waitron-export-passphrase": "export-key",
    },
    body: new Uint8Array([1]),
  });
  await vi.waitFor(() => expect(stageConfiguration).toHaveBeenCalledOnce());
  let status: number | undefined;
  const second = Promise.resolve(
    app.request(
      "/setup-api/recovery/stage",
      stageForm({ eventId: "interactive-restore", source: archiveSource }),
      tls(),
    ),
  ).then((response) => {
    status = response.status;
  });
  try {
    await expect.poll(() => status).toBe(409);
  } finally {
    release();
    await first;
    await second;
  }
});

it("keeps the request cancellation through the bucket preparation service", async () => {
  const reason = new Error("request closed");
  const signal = AbortSignal.abort(reason);
  const download = vi.mocked(prepareStreamRestore).mockImplementation(async (deps) => {
    deps.signal?.throwIfAborted();
    throw new Error("download was not cancelled");
  });
  const service = createSetupRecoveryPreparation({
    stateDir: "/unused/state",
    venueDir: "/unused/venue",
    stagingDir: "/unused/staging",
    modules: [],
    migrationsRoot: null,
    coordinator: createFirstSetupCoordinator(),
    bucket: { litestreamBin: "/unused", now: () => new Date(), log: () => {} },
  });
  const kit = encodeRecoveryKit({
    version: 2,
    streamId: "d0000000-0000-4000-8000-000000000002",
    recoveryKey: "synthetic-recovery-key",
    pointerSignerPublicKey: generateNodeKeyPair().publicKey,
    bucket: {
      region: "local",
      bucket: "copy",
      prefix: "",
      accessKeyId: "unused",
      secretAccessKey: "unused",
    },
  });
  try {
    await expect(
      service(
        { kind: "bucket", kit, environment: "preproduction" },
        preparation,
        undefined,
        { onBox: true },
        signal,
      ),
    ).rejects.toBe(reason);
  } finally {
    download.mockRestore();
  }
});
