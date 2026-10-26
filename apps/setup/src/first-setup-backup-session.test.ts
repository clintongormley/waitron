import { expect, it, vi } from "vitest";
import { SetupApi } from "./api/client.js";
import { FirstSetupBackupSession } from "./first-setup-backup-session.js";
import type { BackupRepairOpenRequest, BackupRepairSession } from "./api/first-setup-types.js";

const binding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "00000000-0000-4000-8000-000000000003",
  sourceId: "archive-digest",
  targetNodeId: "00000000-0000-4000-8000-000000000004",
};
const response: BackupRepairSession = {
  sessionId: "b".repeat(64),
  recoveryId: "00000000-0000-4000-8000-000000000002",
  binding,
  preview: {
    activationSourceId: "archive-digest",
    sourceId: "selected-copy",
    createdAt: "2026-10-24T10:00:00Z",
    environment: "production",
    nodeId: binding.targetNodeId,
    nodeRecoveryKeyName: "Amber Hill",
    taxpayer: { taxId: "B12345674", legalName: "Saved venue" },
    locationName: "Saved location",
    fiscalSelection: {
      module: "fiscal-verifactu",
      country: "ES",
      fiscalTerritory: "common",
      timeZone: "Europe/Madrid",
    },
  },
};
const request: BackupRepairOpenRequest = {
  observation: { inspectionId: "a".repeat(64), revision: null, ownerGeneration: null },
  source: { kind: "bucket", kit: "private-kit", environment: "production" },
  nodeRecoverySecret: "private-node-secret",
  context: { oldBoxGone: true, soleRecovery: true },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(handler?: (action: string, body: unknown) => Response | Promise<Response>) {
  const calls: { action: string; body: unknown }[] = [];
  const api = new SetupApi("", async (url, init) => {
    const action = String(url).split("/").at(-1)!;
    const body =
      init?.body instanceof FormData
        ? JSON.parse(String(init.body.get("request")))
        : JSON.parse(String(init?.body ?? "{}"));
    calls.push({ action, body });
    if (handler) return handler(action, body);
    return Response.json(
      action === "open" || action === "resume"
        ? response
        : action === "prepare"
          ? { status: "selected", binding, input: { picked: "exact" } }
          : action === "commit"
            ? { restarting: true }
            : { closed: true },
    );
  });
  return { session: new FirstSetupBackupSession(api), calls };
}

it("keeps authenticated preview and exact selected input in memory, independent of normal setup ownership", async () => {
  const before = { local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage) };
  const { session, calls } = fixture();
  expect(session.current).toBeUndefined();
  expect(await session.open(request)).toEqual(response);
  const copy = session.current!;
  copy.binding.eventId = "tampered";
  copy.preview.taxpayer.legalName = "tampered";
  expect(session.current).toEqual(response);
  await session.prepare({ action: "select" });
  await session.commit({ picked: "exact" });
  expect(calls.filter((c) => c.action === "commit")).toEqual([
    { action: "commit", body: { sessionId: "b".repeat(64), input: { picked: "exact" } } },
  ]);
  expect(session.current).toBeUndefined();
  await session.dispose();
  expect({ local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage) }).toEqual(
    before,
  );
});

it("requires fresh proof to resume the exact interrupted event and input", async () => {
  const saved = { ...response, input: { picked: "saved" } };
  const { session, calls } = fixture((action) =>
    Response.json(action === "resume" ? saved : { restarting: true }),
  );
  const { source, ...proof } = request;
  void source;
  expect(await session.resume({ ...proof, recoveryId: response.recoveryId })).toEqual(saved);
  await session.commit({ picked: "saved" });
  expect(calls.map((c) => c.action)).toEqual(["resume", "commit"]);
});

it.each(["open", "resume"] as const)(
  "discards a late %s grant after disposal and awaits its cleanup",
  async (action) => {
    const gate = deferred<Response>();
    const { session, calls } = fixture((name) =>
      name === action ? gate.promise : Response.json({ closed: true }),
    );
    const { source, ...proof } = request;
    void source;
    const opening = (
      action === "open"
        ? session.open(request)
        : session.resume({ ...proof, recoveryId: response.recoveryId })
    ).catch((error: unknown) => error);
    const disposal = session.dispose();
    let settled = false;
    void disposal.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    gate.resolve(Response.json(response));
    expect(await opening).toEqual({ code: "setup.owner_required" });
    await disposal;
    expect(session.current).toBeUndefined();
    expect(calls.filter((c) => c.action === "close")).toEqual([
      { action: "close", body: { sessionId: "b".repeat(64) } },
    ]);
    await expect(session.open(request)).rejects.toEqual({ code: "setup.owner_required" });
  },
);

it("does not reuse a selected input delivered after disconnect", async () => {
  const gate = deferred<Response>();
  const { session, calls } = fixture((action) =>
    action === "open"
      ? Response.json(response)
      : action === "prepare"
        ? gate.promise
        : Response.json({ closed: true }),
  );
  await session.open(request);
  const preparing = session.prepare({ action: "select" }).catch((error: unknown) => error);
  const disposal = session.dispose();
  expect(session.current).toBeUndefined();
  expect(calls.some((c) => c.action === "close")).toBe(false);
  gate.resolve(Response.json({ status: "selected", binding, input: { picked: "late" } }));
  expect(await preparing).toEqual({ code: "setup.owner_required" });
  await disposal;
  await expect(session.commit({ picked: "late" })).rejects.toEqual({
    code: "setup.owner_required",
  });
  expect(calls.map((c) => c.action)).toEqual(["open", "prepare", "close"]);
});

it.each([
  { ...response, sessionId: "" },
  { ...response, recoveryId: "bad-id" },
  { ...response, binding: { ...binding, action: "provision" } },
  { ...response, binding: { ...binding, targetNodeId: "00000000-0000-4000-8000-000000000008" } },
  { ...response, binding: { ...binding, sourceId: "another-copy" } },
  { ...response, binding: { ...binding, module: "another-module" } },
  { ...response, preview: { ...response.preview, taxpayer: { taxId: "B12345674" } } },
  { ...response, preview: { ...response.preview, environment: "development" } },
  { ...response, preview: { ...response.preview, createdAt: "yesterday" } },
  { ...response, preview: { ...response.preview, nodeRecoveryKeyName: null } },
  { ...response, preview: { ...response.preview, fiscalSelection: undefined } },
])(
  "rejects malformed or mismatched authenticated replies without exposing a preview %#",
  async (value) => {
    const { session } = fixture(() => Response.json(value));
    await expect(session.open(request)).rejects.toEqual({ code: "setup.attempt_invalid" });
    expect(session.current).toBeUndefined();
    await expect(session.prepare({})).rejects.toEqual({ code: "setup.owner_required" });
    await session.dispose();
  },
);

it("rejects a resume response that changes the retained recovery id or omits the committed input", async () => {
  for (const value of [
    response,
    { ...response, input: {}, recoveryId: "00000000-0000-4000-8000-000000000009" },
  ]) {
    const { session } = fixture(() => Response.json(value));
    const { source, ...proof } = request;
    void source;
    await expect(session.resume({ ...proof, recoveryId: response.recoveryId })).rejects.toEqual({
      code: "setup.attempt_invalid",
    });
    expect(session.current).toBeUndefined();
    await session.dispose();
  }
});

it("leaves module history refusals retryable but sends no completion before a checked selection", async () => {
  let attempts = 0;
  const { session, calls } = fixture((action) =>
    action === "open"
      ? Response.json(response)
      : action === "prepare" && attempts++ === 0
        ? Response.json({ error: { code: "clock.behind_chain", params: {} } }, { status: 409 })
        : Response.json(
            action === "prepare"
              ? { status: "selected", binding, input: { picked: "exact" } }
              : { restarting: true },
          ),
  );
  await session.open(request);
  await expect(session.commit({ picked: "invented" })).rejects.toEqual({
    code: "setup.attempt_conflict",
  });
  await expect(session.prepare({ action: "select" })).rejects.toMatchObject({
    code: "clock.behind_chain",
  });
  expect(session.current).toEqual(response);
  await session.prepare({ action: "select" });
  await expect(session.commit({ picked: "changed" })).rejects.toEqual({
    code: "setup.attempt_conflict",
  });
  await session.commit({ picked: "exact" });
  expect(calls.filter((c) => c.action === "commit")).toHaveLength(1);
});

it("does not accept another event's selected input", async () => {
  const { session, calls } = fixture((action) =>
    Response.json(
      action === "open"
        ? response
        : {
            status: "selected",
            binding: { ...binding, eventId: "other-event" },
            input: { picked: "wrong" },
          },
    ),
  );
  await session.open(request);
  await expect(session.prepare({ action: "select" })).rejects.toEqual({
    code: "setup.attempt_invalid",
  });
  await expect(session.commit({ picked: "wrong" })).rejects.toEqual({
    code: "setup.attempt_conflict",
  });
  expect(calls.some((c) => c.action === "commit")).toBe(false);
  await session.dispose();
});

it("serializes actions while a proof request is pending", async () => {
  const gate = deferred<Response>();
  const { session, calls } = fixture((action) =>
    action === "open" ? gate.promise : Response.json({ closed: true }),
  );
  const opening = session.open(request);
  await expect(session.open(request)).rejects.toEqual({ code: "setup.attempt_conflict" });
  gate.resolve(Response.json(response));
  await opening;
  await expect(session.open(request)).rejects.toEqual({ code: "setup.attempt_conflict" });
  await session.dispose();
  expect(calls.map((c) => c.action)).toEqual(["open", "close"]);
});

it("clears local authority even when disposal is refused and does not send duplicate close requests", async () => {
  const { session, calls } = fixture((action) =>
    action === "open"
      ? Response.json(response)
      : Response.json({ error: { code: "setup.owner_required", params: {} } }, { status: 403 }),
  );
  await session.open(request);
  const first = session.dispose();
  expect(session.current).toBeUndefined();
  expect(session.dispose()).toBe(first);
  await expect(first).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(calls.filter((c) => c.action === "close")).toHaveLength(1);
});

it("compares saved selections by values, including arrays and object key order", async () => {
  const { session, calls } = fixture((action) =>
    Response.json(
      action === "resume"
        ? { ...response, input: { a: [1, { left: true, right: false }], b: 2 } }
        : { restarting: true },
    ),
  );
  const { source, ...proof } = request;
  void source;
  await session.resume({ ...proof, recoveryId: response.recoveryId });
  await expect(session.commit({ b: 2, a: [1, { right: true, left: false }] })).rejects.toEqual({
    code: "setup.attempt_conflict",
  });
  await expect(session.commit({ b: 2, a: [1] })).rejects.toEqual({
    code: "setup.attempt_conflict",
  });
  await session.commit({ b: 2, a: [1, { right: false, left: true }] });
  expect(calls.filter((call) => call.action === "commit")).toHaveLength(1);
});

it("rejects a resumed proof while its previous grant is still active", async () => {
  const { session, calls } = fixture();
  await session.open(request);
  const { source, ...proof } = request;
  void source;
  await expect(session.resume({ ...proof, recoveryId: response.recoveryId })).rejects.toEqual({
    code: "setup.attempt_conflict",
  });
  expect(calls.map((call) => call.action)).toEqual(["open"]);
  await session.dispose();
});

it("requires proof before committing and rejects a malformed completion acknowledgement", async () => {
  const { session } = fixture((action) =>
    Response.json(
      action === "open"
        ? response
        : action === "prepare"
          ? { status: "selected", binding, input: { exact: "input" } }
          : { restarting: false },
    ),
  );
  await expect(session.commit({})).rejects.toEqual({ code: "setup.owner_required" });
  await session.open(request);
  await session.prepare({ action: "select" });
  await expect(session.commit({ exact: "input" })).rejects.toEqual({
    code: "setup.attempt_invalid",
  });
  expect(session.current).toEqual(response);
  await session.dispose();
});

it("does not accept a successful completion delivered after disposal", async () => {
  const gate = deferred<Response>();
  const { session, calls } = fixture((action) =>
    action === "open"
      ? Response.json(response)
      : action === "prepare"
        ? Response.json({ status: "selected", binding, input: { exact: "input" } })
        : action === "commit"
          ? gate.promise
          : Response.json({ closed: true }),
  );
  await session.open(request);
  await session.prepare({ action: "select" });
  const committing = session.commit({ exact: "input" }).catch((error: unknown) => error);
  const disposal = session.dispose();
  gate.resolve(Response.json({ restarting: true }));
  expect(await committing).toEqual({ code: "setup.owner_required" });
  await disposal;
  expect(session.current).toBeUndefined();
  expect(calls.map((call) => call.action)).toEqual(["open", "prepare", "commit", "close"]);
});

it("never installs malformed authority even when closing its supplied grant is refused", async () => {
  const { session, calls } = fixture((action) =>
    action === "open"
      ? Response.json({ ...response, binding: null })
      : Response.json({ error: { code: "setup.owner_required", params: {} } }, { status: 403 }),
  );
  await expect(session.open(request)).rejects.toEqual({ code: "setup.attempt_invalid" });
  expect(session.current).toBeUndefined();
  await session.dispose();
  expect(calls.map((call) => call.action)).toEqual(["open", "close"]);
});

function leaseFixture(renew: (body: unknown) => Response | Promise<Response>) {
  const calls: { action: string; body: unknown }[] = [];
  const api = new SetupApi("", async (url, init) => {
    const action = String(url).split("/").at(-1)!;
    const body: unknown =
      init?.body instanceof FormData ? undefined : JSON.parse(String(init?.body ?? "{}"));
    calls.push({ action, body });
    if (action === "renew") return renew(body);
    if (action === "open") return Response.json(response);
    if (action === "commit") return Response.json({ restarting: true });
    if (action === "prepare") return Response.json({ status: "selected", binding, input: {} });
    return Response.json({ closed: true });
  });
  const refusals: unknown[] = [];
  const session = new FirstSetupBackupSession(api, {
    onRenewalRefused: (cause) => refusals.push(cause),
  });
  const renewals = () => calls.filter((call) => call.action === "renew");
  return { session, calls, refusals, renewals };
}
function visibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

it("renews its session every 30 s while it holds one, and stops after dispose", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const { session, renewals } = leaseFixture(() => Response.json({ renewed: true }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(renewals()).toHaveLength(0);
    await session.open(request);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(renewals()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(renewals().map((call) => call.body)).toEqual([{ sessionId: response.sessionId }]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(renewals()).toHaveLength(2);
    await session.dispose();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(renewals()).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});

it("stops renewing once its recovery is committed", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const { session, renewals } = leaseFixture(() => Response.json({ renewed: true }));
    await session.open(request);
    await session.prepare({ action: "select" });
    await session.commit({});
    await vi.advanceTimersByTimeAsync(120_000);
    expect(renewals()).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

it("renews when the page becomes visible, and not when it is hidden or after dispose", async () => {
  try {
    const { session, renewals } = leaseFixture(() => Response.json({ renewed: true }));
    visibility("visible");
    expect(renewals()).toHaveLength(0);
    await session.open(request);
    visibility("hidden");
    expect(renewals()).toHaveLength(0);
    visibility("visible");
    await expect.poll(() => renewals()).toHaveLength(1);
    await session.dispose();
    visibility("visible");
    await new Promise((done) => setTimeout(done, 50));
    expect(renewals()).toHaveLength(1);
  } finally {
    delete (document as { visibilityState?: unknown }).visibilityState;
  }
});

it("stops renewing at the first refusal and reports it", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const { session, renewals, refusals } = leaseFixture(() =>
      Response.json(
        { error: { code: "setup.recovery_discarded", params: { discardedAt: "x" } } },
        { status: 409 },
      ),
    );
    await session.open(request);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect.poll(() => refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      code: "setup.recovery_discarded",
      params: { discardedAt: "x" },
      status: 409,
    });
    await vi.advanceTimersByTimeAsync(120_000);
    visibility("visible");
    expect(renewals()).toHaveLength(1);
    await session.dispose();
  } finally {
    vi.useRealTimers();
    delete (document as { visibilityState?: unknown }).visibilityState;
  }
});

it("keeps renewing when a renewal could not reach the box", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const { session, renewals, refusals } = leaseFixture(() => {
      throw new TypeError("Failed to fetch");
    });
    await session.open(request);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(renewals()).toHaveLength(2);
    expect(refusals).toEqual([]);
    await session.dispose();
  } finally {
    vi.useRealTimers();
  }
});
