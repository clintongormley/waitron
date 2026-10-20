import { afterEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { SetupRecoveryAllocation } from "./recovery-allocation.js";

afterEach(cleanupWidgets);
async function mount() {
  const { el } = await mountWidget<SetupRecoveryAllocation>("setup-recovery-allocation", {
    preview: {
      sourceId: "saved-digest",
      createdAt: "2026-10-17T12:30:00.000Z",
      environment: "production",
      nodeId: "node-1",
      nodeRecoveryKeyName: "Caja principal",
      taxpayer: { legalName: "Olivo Restauración SL", taxId: "B12345674" },
      locationName: "Olivo Centro",
      fiscalSelection: {
        module: "fiscal-verifactu",
        country: "ES",
        fiscalTerritory: "common",
        timeZone: "Europe/Madrid",
      },
    } as NonNullable<SetupRecoveryAllocation["preview"]>,
  });
  return el;
}
it("mounts the selected module's printed-key fields for a fiscal backup", async () => {
  const el = await mount();
  const entry = el.shadowRoot!.querySelector<LitElement>("vf-recovery-key");
  expect(entry, "selected module owns printed-key and PDF entry").not.toBeNull();
  await entry!.updateComplete;
  const field = entry!.shadowRoot!.querySelector('[name="printed-recovery-key"]')!;
  await (field as LitElement).updateComplete;
  expect(field.shadowRoot!.querySelector<HTMLInputElement>("input")!.type).toBe("password");
});

const operation = {
  binding: {
    module: "fiscal-verifactu",
    action: "restore",
    eventId: "event",
    sourceId: "saved-digest",
    targetNodeId: "node-1",
  },
  input: { public: "selected-hour-input" },
};
function fillOperation(el: SetupRecoveryAllocation) {
  el.shadowRoot!.querySelector('[data-test="record"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: JSON.stringify(operation) } }),
  );
  for (const name of ["isolated", "retained"]) {
    const field = el.shadowRoot!.querySelector<HTMLInputElement>(`[data-test="${name}"]`)!;
    field.checked = true;
    field.dispatchEvent(new Event("change"));
  }
}
async function fillKey(el: SetupRecoveryAllocation) {
  const entry = el.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
  await entry.updateComplete;
  for (const [name, value] of [
    ["printed-recovery-key", "06r9 t4fh m4h3 599j eemm 5d5d abtv 2rsx 6qdq we8m c"],
  ]) {
    const field = entry.shadowRoot!.querySelector<LitElement>(`[name="${name}"]`)!;
    await field.updateComplete;
    const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }
}
it("forwards the decoded secret and clears the real fields with Clear", async () => {
  const el = await mount();
  fillOperation(el);
  await fillKey(el);
  await vi.waitFor(() =>
    expect(el.readCredentials()).toEqual({
      recoveryOperation: operation,
      nodeRecoverySecret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    }),
  );
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="clear"]')!.click();
  await el.updateComplete;
  const entry = el.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
  await entry.updateComplete;
  const field = entry.shadowRoot!.querySelector<LitElement>('[name="printed-recovery-key"]')!;
  await field.updateComplete;
  expect(field.shadowRoot!.querySelector<HTMLInputElement>("input")!.value).toBe("");
  expect(el.readCredentials()).toBeNull();
});
it("places the server's named-key refusal under the module's actual fields", async () => {
  const el = await mount();
  fillOperation(el);
  await fillKey(el);
  await vi.waitFor(() =>
    expect(el.readCredentials()?.nodeRecoverySecret).toBe("AbCdEfGhIjKlMnOpQrStUvWxYz012345"),
  );
  Object.assign(el, {
    errorMessage: "The backup needs its older key.",
    refusedField: "nodeRecoverySecret",
  });
  await el.updateComplete;
  const entry = el.shadowRoot!.querySelector<LitElement>("vf-recovery-key")!;
  await entry.updateComplete;
  const field = entry.shadowRoot!.querySelector<LitElement & { error: string }>(
    '[name="printed-recovery-key"]',
  )!;
  await vi.waitFor(() => expect(field.error).toBe("The backup needs its older key."));
  expect(el.readCredentials()?.nodeRecoverySecret).toBe("AbCdEfGhIjKlMnOpQrStUvWxYz012345");
});
it("requires fiscal credentials even before the printed fields have decoded", async () => {
  const el = await mount();
  expect(el.readCredentials()).toBeNull();
  const record = el.shadowRoot!.querySelector<LitElement & { required: boolean }>(
    '[data-test="record"]',
  )!;
  expect(record.required).toBe(true);
});
