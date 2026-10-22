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
const stagedIds = ["5c1d6c43-4f61-4c4a-9e0b-0a8f2f8d9a11", "6d2e7d54-5a72-4d5b-8f1c-1b9a3a9eab22"];
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

async function mounted(stage: (call: number) => Response | undefined = () => undefined) {
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
      return new Response(JSON.stringify({ discarded: true }));
    return new Response(JSON.stringify({ id: "challenge" }));
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
