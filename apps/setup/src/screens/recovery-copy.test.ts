import { afterEach, expect, it, vi } from "vitest";
import { SetupApi, type RecoveryPreparationRequest } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetupRecoveryCopy } from "./recovery-copy.js";
import type { SetupRecoveryAllocation } from "./recovery-allocation.js";

afterEach(() => cleanupWidgets());

const copy = {
  sourceId: "selected-copy",
  createdAt: "2026-10-01T08:00:00.000Z",
  environment: "preproduction",
  nodeId: "saved-node",
  nodeRecoveryKeyName: "Amber Hill",
  taxpayer: { legalName: "Saved venue", taxId: "89890001K" },
  locationName: "Saved location",
};
const stagedIds = [
  "5c1d6c43-4f61-4c4a-9e0b-0a8f2f8d9a11",
  "6d2e7d54-5a72-4d5b-8f1c-1b9a3a9eab22",
  "7e3f8e65-6b83-4e6c-9a2d-2cab4b0fbc33",
];
const request = (eventId = "event-1"): RecoveryPreparationRequest => ({
  binding: {
    module: "fiscal-verifactu",
    action: "restore",
    eventId,
    sourceId: "selected-copy",
    targetNodeId: "saved-node",
  },
  context: { selectedSourceId: "selected-copy", oldBoxGone: true, soleRecovery: true },
  nodeRecoverySecret: "named key",
  proposal: { action: "clock-challenge" },
});

async function mounted(
  stage: (call: number) => Response | Promise<Response> | undefined = () => undefined,
  preparation: (stagedId: string) => Response | Promise<Response> | undefined = () => undefined,
  discard: () => Response | undefined = () => undefined,
) {
  const calls: { path: string; init: RequestInit }[] = [];
  let stages = 0;
  let attempts = 0;
  const api = new SetupApi("", async (input, init = {}) => {
    const path = String(input);
    calls.push({ path, init });
    if (path === "/setup-api/restore/preview") return new Response(JSON.stringify(copy));
    if (path === "/setup-api/recovery/stage")
      return (
        stage(attempts++) ??
        new Response(JSON.stringify({ stagedId: stagedIds[stages++] }), { status: 200 })
      );
    if (path === "/setup-api/recovery/stage/discard")
      return discard() ?? new Response(JSON.stringify({ discarded: true }));
    return (
      preparation(JSON.parse(init.body as string).source.stagedId) ??
      new Response(JSON.stringify({ id: "challenge" }))
    );
  });
  const { el } = await mountWidget<SetupRecoveryCopy>("setup-recovery-copy", { api });
  el.artifact = new File(["encrypted-copy"], "copy.backup");
  el.recoveryKey = "archive-key";
  el.environment = "preproduction";
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("setup-recovery-allocation")).not.toBeNull(),
  );
  const prepare = () =>
    el.shadowRoot!.querySelector<SetupRecoveryAllocation>("setup-recovery-allocation")!.prepare!;
  return { el, calls, prepare };
}
const at = (calls: { path: string; init: RequestInit }[], path: string) =>
  calls.filter((call) => call.path === path);

it("uploads the backup once and sends every clock and selection request as small JSON", async () => {
  const { calls, prepare } = await mounted();
  await prepare()(request());
  await prepare()({ ...request(), proposal: { action: "compare-clocks", browser: {} } });
  await prepare()({ ...request(), proposal: { action: "select", comparisonId: "c" } });
  const staged = at(calls, "/setup-api/recovery/stage");
  expect(staged).toHaveLength(1);
  const form = staged[0]!.init.body as FormData;
  expect(JSON.parse(form.get("request") as string)).toEqual({
    eventId: "event-1",
    source: { kind: "archive", recoveryKey: "archive-key", environment: "preproduction" },
  });
  expect(await (form.get("artifact") as Blob).text()).toBe("encrypted-copy");
  const preparations = at(calls, "/setup-api/recovery/preparation");
  expect(preparations).toHaveLength(3);
  for (const { init } of preparations) {
    expect(typeof init.body).toBe("string");
    expect(new Blob([init.body as string]).size).toBeLessThan(2048);
    expect(JSON.parse(init.body as string).source).toEqual({
      kind: "staged",
      stagedId: stagedIds[0],
    });
  }
});

it("discards the staged copy when the chosen file changes, and stages the new one", async () => {
  const { el, calls, prepare } = await mounted();
  await prepare()(request());
  el.artifact = new File(["another-copy"], "other.backup");
  await el.updateComplete;
  await vi.waitFor(() => expect(at(calls, "/setup-api/recovery/stage/discard")).toHaveLength(1));
  expect(
    JSON.parse(at(calls, "/setup-api/recovery/stage/discard")[0]!.init.body as string),
  ).toEqual({ stagedId: stagedIds[0] });
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("setup-recovery-allocation")).not.toBeNull(),
  );
  await prepare()(request("event-2"));
  expect(at(calls, "/setup-api/recovery/stage")).toHaveLength(2);
  expect(
    JSON.parse(at(calls, "/setup-api/recovery/preparation")[1]!.init.body as string).source,
  ).toEqual({ kind: "staged", stagedId: stagedIds[1] });
});

it("stages again after a refused upload", async () => {
  const { calls, prepare } = await mounted((attempt) =>
    attempt === 0
      ? new Response(JSON.stringify({ error: { code: "setup.restore_failed" } }), { status: 500 })
      : undefined,
  );
  await expect(prepare()(request())).rejects.toMatchObject({ code: "setup.restore_failed" });
  await prepare()(request());
  expect(at(calls, "/setup-api/recovery/stage")).toHaveLength(2);
  expect(at(calls, "/setup-api/recovery/preparation")).toHaveLength(1);
});

const refusedStaged = (code: string, params = {}, status = 409) =>
  new Response(JSON.stringify({ error: { code, params } }), { status });
const sentIds = (calls: { path: string; init: RequestInit }[]) =>
  at(calls, "/setup-api/recovery/preparation").map(
    ({ init }) => JSON.parse(init.body as string).source.stagedId as string,
  );

it("uploads again under the same restore event when the box no longer holds the staged copy", async () => {
  const lost = new Set<string>();
  const { calls, prepare } = await mounted(undefined, (stagedId) =>
    lost.has(stagedId) ? refusedStaged("restore.staged_copy_missing") : undefined,
  );
  await prepare()(request());
  lost.add(stagedIds[0]!);
  await expect(prepare()(request())).resolves.toEqual({ id: "challenge" });
  await prepare()(request());
  const staged = at(calls, "/setup-api/recovery/stage");
  expect(staged).toHaveLength(2);
  expect(JSON.parse((staged[1]!.init.body as FormData).get("request") as string).eventId).toBe(
    "event-1",
  );
  expect(sentIds(calls)).toEqual([stagedIds[0], stagedIds[0], stagedIds[1], stagedIds[1]]);
  expect(at(calls, "/setup-api/recovery/stage/discard")).toHaveLength(0);
});

it("stops, without uploading again, once another restore page's upload replaced its copy", async () => {
  const replaced = new Set<string>();
  const { calls, prepare } = await mounted(undefined, (stagedId) =>
    replaced.has(stagedId)
      ? refusedStaged("setup.request_invalid", { field: "stagedId" }, 400)
      : undefined,
  );
  await prepare()(request());
  replaced.add(stagedIds[0]!);
  await expect(prepare()(request())).rejects.toMatchObject({ code: "setup.request_invalid" });
  await expect(prepare()(request())).rejects.toMatchObject({ code: "setup.request_invalid" });
  expect(at(calls, "/setup-api/recovery/stage")).toHaveLength(1);
});

it("asks once more at most when the copy it uploaded again is missing too", async () => {
  const { calls, prepare } = await mounted(undefined, () =>
    refusedStaged("restore.staged_copy_missing"),
  );
  await expect(prepare()(request())).rejects.toMatchObject({
    code: "restore.staged_copy_missing",
  });
  expect(at(calls, "/setup-api/recovery/stage")).toHaveLength(2);
  expect(sentIds(calls)).toEqual([stagedIds[0], stagedIds[1]]);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const changed = { message: "Selected recovery copy changed" };
const discarded = (calls: { path: string; init: RequestInit }[]) =>
  at(calls, "/setup-api/recovery/stage/discard").map(
    ({ init }) => (JSON.parse(init.body as string) as { stagedId: string }).stagedId,
  );

it("sends nothing once the chosen copy has changed before a clock request", async () => {
  const { el, calls, prepare } = await mounted();
  const send = prepare();
  el.recoveryKey = "another-key";
  await el.updateComplete;
  await expect(send(request())).rejects.toMatchObject(changed);
  expect(at(calls, "/setup-api/recovery/stage")).toHaveLength(0);
  expect(at(calls, "/setup-api/recovery/preparation")).toHaveLength(0);
});

it("sends no clock request for a copy whose upload finished after the choice changed, and removes it from the box", async () => {
  const upload = deferred<Response>();
  const { el, calls, prepare } = await mounted(() => upload.promise);
  const pending = prepare()(request());
  await vi.waitFor(() => expect(at(calls, "/setup-api/recovery/stage")).toHaveLength(1));
  el.recoveryKey = "another-key";
  await el.updateComplete;
  upload.resolve(new Response(JSON.stringify({ stagedId: stagedIds[0] })));
  await expect(pending).rejects.toMatchObject(changed);
  expect(at(calls, "/setup-api/recovery/preparation")).toHaveLength(0);
  await vi.waitFor(() => expect(discarded(calls)).toEqual([stagedIds[0]]));
});

it("drops a clock answer that arrives after the choice changed, and removes the copy from the box", async () => {
  const answer = deferred<Response>();
  const { el, calls, prepare } = await mounted(undefined, () => answer.promise);
  const pending = prepare()(request());
  await vi.waitFor(() => expect(at(calls, "/setup-api/recovery/preparation")).toHaveLength(1));
  el.environment = "production";
  await el.updateComplete;
  answer.resolve(new Response(JSON.stringify({ id: "challenge" })));
  await expect(pending).rejects.toMatchObject(changed);
  await vi.waitFor(() => expect(discarded(calls)).toEqual([stagedIds[0]]));
});

it("asks the box to remove nothing when an upload abandoned by a changed choice is refused", async () => {
  const upload = deferred<Response>();
  const unhandled: unknown[] = [];
  const record = (event: PromiseRejectionEvent) => unhandled.push(event.reason);
  window.addEventListener("unhandledrejection", record);
  try {
    const { el, calls, prepare } = await mounted(() => upload.promise);
    const pending = prepare()(request());
    await vi.waitFor(() => expect(at(calls, "/setup-api/recovery/stage")).toHaveLength(1));
    el.recoveryKey = "another-key";
    await el.updateComplete;
    upload.resolve(refusedStaged("setup.restore_failed", {}, 500));
    await expect(pending).rejects.toMatchObject({ code: "setup.restore_failed" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(discarded(calls)).toEqual([]);
    expect(unhandled).toEqual([]);
  } finally {
    window.removeEventListener("unhandledrejection", record);
  }
});

it("carries on with the new file when the box refuses to remove the old copy", async () => {
  const unhandled: unknown[] = [];
  const record = (event: PromiseRejectionEvent) => unhandled.push(event.reason);
  window.addEventListener("unhandledrejection", record);
  try {
    const { el, calls, prepare } = await mounted(undefined, undefined, () =>
      refusedStaged("setup.restore_failed", {}, 500),
    );
    await prepare()(request());
    el.artifact = new File(["another-copy"], "other.backup");
    await el.updateComplete;
    await vi.waitFor(() => expect(discarded(calls)).toEqual([stagedIds[0]]));
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("setup-recovery-allocation")).not.toBeNull(),
    );
    await expect(prepare()(request("event-2"))).resolves.toEqual({ id: "challenge" });
    expect(sentIds(calls)).toEqual([stagedIds[0], stagedIds[1]]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unhandled).toEqual([]);
  } finally {
    window.removeEventListener("unhandledrejection", record);
  }
});

it("still removes a newer event's copy when an older event's copy is reported missing", async () => {
  const lost = deferred<Response>();
  const { calls, prepare } = await mounted(undefined, (stagedId) =>
    stagedId === stagedIds[0] && sentIds(calls).length === 1 ? lost.promise : undefined,
  );
  const older = prepare()(request("event-1"));
  await vi.waitFor(() => expect(sentIds(calls)).toEqual([stagedIds[0]]));
  await expect(prepare()(request("event-2"))).resolves.toEqual({ id: "challenge" });
  lost.resolve(refusedStaged("restore.staged_copy_missing"));
  await expect(older).resolves.toEqual({ id: "challenge" });
  expect(sentIds(calls)).toEqual([stagedIds[0], stagedIds[1], stagedIds[2]]);
  await vi.waitFor(() => expect(discarded(calls)).toEqual([stagedIds[0], stagedIds[1]]));
});

it("keeps a newer event's copy when an older event's upload is refused after it", async () => {
  const upload = deferred<Response>();
  const { calls, prepare } = await mounted((call) => (call === 0 ? upload.promise : undefined));
  const older = prepare()(request("event-1"));
  await vi.waitFor(() => expect(at(calls, "/setup-api/recovery/stage")).toHaveLength(1));
  const newer = prepare()(request("event-2"));
  upload.resolve(refusedStaged("setup.restore_failed", {}, 500));
  await expect(older).rejects.toMatchObject({ code: "setup.restore_failed" });
  await expect(newer).resolves.toEqual({ id: "challenge" });
  await prepare()(request("event-2"));
  expect(at(calls, "/setup-api/recovery/stage")).toHaveLength(2);
  expect(sentIds(calls)).toEqual([stagedIds[0], stagedIds[0]]);
});

it("drops a bucket copy's clock answer that arrives after the kit changed", async () => {
  const answer = deferred<Response>();
  const sent: string[] = [];
  const api = new SetupApi("", async (input) => {
    const path = String(input);
    sent.push(path);
    if (path === "/setup-api/restore-bucket/preview") return new Response(JSON.stringify(copy));
    return answer.promise;
  });
  const { el } = await mountWidget<SetupRecoveryCopy>("setup-recovery-copy", {
    api,
    bucketKit: "selected kit",
    environment: "preproduction",
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("setup-recovery-allocation")).not.toBeNull(),
  );
  const pending = el.shadowRoot!.querySelector<SetupRecoveryAllocation>(
    "setup-recovery-allocation",
  )!.prepare!(request());
  await vi.waitFor(() => expect(sent).toContain("/setup-api/recovery/preparation"));
  el.bucketKit = "another kit";
  await el.updateComplete;
  answer.resolve(new Response(JSON.stringify({ id: "challenge" })));
  await expect(pending).rejects.toMatchObject(changed);
  expect(sent).not.toContain("/setup-api/recovery/stage");
});
