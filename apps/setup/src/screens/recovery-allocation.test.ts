import { afterEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { SetupApi, type RecoveryRestoreCredentials } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetupRestoreScreen } from "./restore-screen.js";
import { SetupRestoreBucketScreen } from "./restore-bucket-screen.js";
import { SetupCloudRestoreScreen } from "./cloud-restore-screen.js";
import { setLocale } from "../i18n/t.js";

const nodeId = "00000000-0000-4000-8000-000000000001";
const preview = {
  sourceId: "selected-archive-digest",
  createdAt: "2026-10-01T08:00:00.000Z",
  environment: "production",
  nodeId,
  nodeRecoveryKeyName: "Amber Hill",
  taxpayer: { legalName: "Saved venue", taxId: "89890001K" },
  locationName: "Saved location",
};
const operation = {
  binding: {
    module: "fiscal-verifactu",
    action: "restore",
    eventId: "outside-event",
    sourceId: preview.sourceId,
    targetNodeId: nodeId,
  },
  input: {
    allocation: { receipt: "public-signed-reservation" },
    approval: { eventId: "outside-event" },
  },
};
type Entry = LitElement & {
  readCredentials(): RecoveryRestoreCredentials | undefined | null;
};
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

async function selected(extra: Record<string, unknown> = {}) {
  const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {
    api: new SetupApi("", async () => new Response(JSON.stringify({ ...preview, ...extra }))),
  });
  const files = new DataTransfer();
  files.items.add(new File(["encrypted"], "selected.backup"));
  const picker = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=artifact]")!;
  picker.files = files.files;
  picker.dispatchEvent(new Event("change"));
  change(el, "recovery-key", "archive-key");
  await el.updateComplete;
  const copy = el.shadowRoot!.querySelector<LitElement>("setup-recovery-copy")!;
  await copy.updateComplete;
  copy.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
  await vi.waitFor(() => expect(copy.shadowRoot!.textContent).toContain("Amber Hill"));
  const entry = copy.shadowRoot!.querySelector<Entry>("setup-recovery-allocation");
  expect(entry, "selected-copy preview offers recovery allocation input").not.toBeNull();
  await entry!.updateComplete;
  return { el, host, copy, entry: entry! };
}
function change(el: LitElement, field: string, value: string) {
  const input = el.shadowRoot!.querySelector(`[data-test=${field}]`)!;
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
}
function tick(entry: LitElement, field: string) {
  const input = entry.shadowRoot!.querySelector<HTMLInputElement>(`[data-test=${field}]`)!;
  input.checked = true;
  input.dispatchEvent(new Event("change"));
}
async function fill(entry: Entry, record = operation) {
  change(entry, "record", JSON.stringify(record));
  change(entry, "node-key", "node-key-secret");
  tick(entry, "isolated");
  tick(entry, "retained");
  await entry.updateComplete;
}

it("pairs the public recovery record with the selected copy's separate node key", async () => {
  const { entry } = await selected();
  expect(entry.readCredentials()).toBeUndefined();
  await fill(entry);
  expect(entry.readCredentials()).toEqual({
    recoveryOperation: operation,
    nodeRecoverySecret: "node-key-secret",
  });
  expect(entry.shadowRoot!.textContent).not.toContain("node-key-secret");
  expect(entry.outerHTML).not.toContain("node-key-secret");
  const native = entry
    .shadowRoot!.querySelector("[data-test=node-key]")!
    .shadowRoot!.querySelector<HTMLInputElement>("input")!;
  expect(native.type).toBe("password");
  expect(native.value).toBe("node-key-secret");
});
it.each(["source", "node", "action", "extra", "malformed", "too-large"])(
  "refuses a %s recovery record rather than sending an unrelated activation",
  async (fault) => {
    const { entry } = await selected();
    const record = structuredClone(operation);
    if (fault === "source") record.binding.sourceId = "different-backup";
    if (fault === "node") record.binding.targetNodeId = "00000000-0000-4000-8000-000000000002";
    if (fault === "action") record.binding.action = "promote";
    await fill(entry, record);
    if (fault === "extra")
      change(entry, "record", JSON.stringify({ ...record, authority: "untrusted" }));
    if (fault === "malformed") change(entry, "record", "broken receipt");
    if (fault === "too-large")
      change(entry, "record", JSON.stringify({ ...record, input: "é".repeat(66000) }));
    expect(entry.readCredentials()).toBeNull();
    await entry.updateComplete;
    expect(
      entry.shadowRoot!.querySelector<HTMLElement & { error: string }>("[data-test=record]")!.error,
    ).not.toBe("");
  },
);
it("uses the prepared stream digest rather than the generation's display locator", async () => {
  const { entry } = await selected({
    sourceId: "stream:venue:generation",
    activationSourceId: "actual-copy-digest",
  });
  await fill(entry, {
    ...operation,
    binding: { ...operation.binding, sourceId: "actual-copy-digest" },
  });
  expect(entry.readCredentials()?.recoveryOperation.binding.sourceId).toBe("actual-copy-digest");
  await fill(entry, {
    ...operation,
    binding: { ...operation.binding, sourceId: "stream:venue:generation" },
  });
  expect(entry.readCredentials()).toBeNull();
});
it("requires the node key and both operator confirmations after entering a record", async () => {
  const { entry } = await selected();
  change(entry, "record", JSON.stringify(operation));
  expect(entry.readCredentials()).toBeNull();
  await entry.updateComplete;
  expect(
    entry.shadowRoot!.querySelector<HTMLElement & { error: string }>("[data-test=node-key]")!.error,
  ).not.toBe("");
  change(entry, "node-key", "node-key-secret");
  tick(entry, "isolated");
  expect(entry.readCredentials()).toBeNull();
  tick(entry, "retained");
  expect(entry.readCredentials()).toEqual({
    recoveryOperation: operation,
    nodeRecoverySecret: "node-key-secret",
  });
});
it("forwards credentials from the archive screen after the operator's confirmations", async () => {
  const { el, entry } = await selected();
  await fill(entry);
  const acknowledged = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=acknowledge]")!;
  acknowledged.checked = true;
  acknowledged.dispatchEvent(new Event("change"));
  const delivered = new Promise<CustomEvent>((resolve) =>
    el.addEventListener("restore-requested", (e) => resolve(e as CustomEvent), { once: true }),
  );
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=restore]")!.click();
  expect((await delivered).detail.request).toMatchObject({
    recoveryOperation: operation,
    nodeRecoverySecret: "node-key-secret",
    recoveryKey: "archive-key",
  });
});
it("clears the key and public record when leaving or changing the selected copy", async () => {
  const { el, entry, host } = await selected();
  await fill(entry);
  change(el, "recovery-key", "different-archive-key");
  await el.updateComplete;
  await vi.waitFor(() => expect(entry.isConnected).toBe(false));
  expect(entry.readCredentials()).toBeUndefined();
  host.remove();
});

it("refuses an old allocation even when Restore follows a new file before rendering", async () => {
  const { el, entry } = await selected();
  await fill(entry);
  const acknowledged = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=acknowledge]")!;
  acknowledged.checked = true;
  acknowledged.dispatchEvent(new Event("change"));
  const listener = vi.fn();
  el.addEventListener("restore-requested", listener);
  const files = new DataTransfer();
  files.items.add(new File(["different"], "different.backup"));
  const picker = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=artifact]")!;
  picker.files = files.files;
  picker.dispatchEvent(new Event("change"));
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=restore]")!.click();
  expect(listener).not.toHaveBeenCalled();
});

it("holds Restore after an invalid record and releases it after the fields are fixed", async () => {
  const { el, entry } = await selected();
  const acknowledged = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=acknowledge]")!;
  acknowledged.checked = true;
  acknowledged.dispatchEvent(new Event("change"));
  change(entry, "record", "broken");
  const button = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    "[data-test=restore]",
  )!;
  const listener = vi.fn();
  el.addEventListener("restore-requested", listener);
  button.click();
  await el.updateComplete;
  expect(listener).not.toHaveBeenCalled();
  expect(button.disabled).toBe(true);
  await fill(entry);
  await el.updateComplete;
  expect(button.disabled).toBe(false);
});

it("shows a request's node-key refusal beside that field and clears it when edited", async () => {
  const { el, entry } = await selected();
  Object.assign(el, {
    invalidField: "nodeRecoverySecret",
    errorMessage: "Check the selected backup's node key.",
  });
  await el.updateComplete;
  await entry.updateComplete;
  const field = entry.shadowRoot!.querySelector<HTMLElement & { error: string }>(
    "[data-test=node-key]",
  )!;
  await vi.waitFor(() => expect(field.error).toBe("Check the selected backup's node key."));
  change(entry, "node-key", "another-node-key");
  await entry.updateComplete;
  expect(field.error).toBe("");
});

it.each(["bucket", "cloud"])("forwards the selected %s copy's credentials", async (kind) => {
  const api = new SetupApi(
    "",
    async () =>
      new Response(
        JSON.stringify({
          ...preview,
          sourceId: "stream:generation",
          activationSourceId: preview.sourceId,
        }),
      ),
  );
  const { el } =
    kind === "bucket"
      ? await mountWidget<SetupRestoreBucketScreen>("setup-restore-bucket-screen", { api })
      : await mountWidget<SetupCloudRestoreScreen>("setup-cloud-restore-screen", {
          api,
          view: {
            state: "approved",
            requestId: "request",
            code: "12345678",
            expiresAt: "2026-10-14T23:00:00Z",
            openCloudUrl: "https://cloud.example.test/recover",
            point: { id: "point", venueId: "venue", capturedAt: preview.createdAt, modules: {} },
          },
        });
  if (kind === "bucket") change(el, "kit", "outside-recovery-kit");
  await el.updateComplete;
  const copy = el.shadowRoot!.querySelector<LitElement>("setup-recovery-copy")!;
  await copy.updateComplete;
  copy.shadowRoot!.querySelector<HTMLElement>("[data-test=preview]")!.click();
  await vi.waitFor(() => expect(copy.shadowRoot!.textContent).toContain("Amber Hill"));
  const entry = copy.shadowRoot!.querySelector<Entry>("setup-recovery-allocation")!;
  await entry.updateComplete;
  await fill(entry);
  const acknowledged = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=acknowledge]")!;
  acknowledged.checked = true;
  acknowledged.dispatchEvent(new Event("change"));
  if (kind === "bucket") {
    const confirmed = el.shadowRoot!.querySelector<HTMLInputElement>(
      "[data-test=venue-confirmed]",
    )!;
    confirmed.checked = true;
    confirmed.dispatchEvent(new Event("change"));
  }
  const listener = vi.fn();
  el.addEventListener(
    kind === "bucket" ? "bucket-restore-requested" : "cloud-restore-action",
    listener,
  );
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=restore]")!.click();
  const detail = listener.mock.calls[0]?.[0].detail;
  expect(kind === "bucket" ? detail?.request : detail).toMatchObject({
    recoveryOperation: operation,
    nodeRecoverySecret: "node-key-secret",
  });
});
