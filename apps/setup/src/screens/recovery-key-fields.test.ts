import { afterEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { cleanupWidgets, mountWidget, typeMasterKey } from "../widgets/test-helpers.js";
import { SetupRecoveryAllocation } from "./recovery-allocation.js";
import { encodeMasterKeyCode } from "@waitron/shared";

const MASTER_KEY = encodeMasterKeyCode(new Uint8Array(16).fill(7));

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
      venueName: "Olivo Centro",
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
/** The master-key field's own text field. */
async function keyField(el: SetupRecoveryAllocation) {
  const key = el.shadowRoot!.querySelector<LitElement>("wt-master-key-input")!;
  await key.updateComplete;
  const field = key.shadowRoot!.querySelector<LitElement & { error: string }>(
    '[name="master-key"]',
  )!;
  await field.updateComplete;
  return field;
}
it("draws the master-key field for a fiscal backup, expecting the backup's key", async () => {
  const el = await mount();
  const key = el.shadowRoot!.querySelector<LitElement & { keyName?: string }>(
    "wt-master-key-input",
  );
  expect(key, "a fiscal backup asks for its master key").not.toBeNull();
  expect(key!.keyName).toBe("Caja principal");
  const field = await keyField(el);
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
  await typeMasterKey(el, MASTER_KEY.replaceAll(" ", "").toLowerCase());
}
it("forwards the printed key and clears the real field with Clear", async () => {
  const el = await mount();
  fillOperation(el);
  await fillKey(el);
  await vi.waitFor(() =>
    expect(el.readCredentials()).toEqual({
      recoveryOperation: operation,
      nodeRecoverySecret: MASTER_KEY,
    }),
  );
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="clear"]')!.click();
  await el.updateComplete;
  const field = await keyField(el);
  expect(field.shadowRoot!.querySelector<HTMLInputElement>("input")!.value).toBe("");
  expect(el.readCredentials()).toBeNull();
});
it("places the server's named-key refusal under the master-key field", async () => {
  const el = await mount();
  fillOperation(el);
  await fillKey(el);
  await vi.waitFor(() => expect(el.readCredentials()?.nodeRecoverySecret).toBe(MASTER_KEY));
  Object.assign(el, {
    errorMessage: "The backup needs its older key.",
    refusedField: "nodeRecoverySecret",
  });
  await el.updateComplete;
  const field = await keyField(el);
  await vi.waitFor(() => expect(field.error).toBe("The backup needs its older key."));
  expect(el.readCredentials()?.nodeRecoverySecret).toBe(MASTER_KEY);
});
it("requires fiscal credentials even before the printed fields have decoded", async () => {
  const el = await mount();
  expect(el.readCredentials()).toBeNull();
  const record = el.shadowRoot!.querySelector<LitElement & { required: boolean }>(
    '[data-test="record"]',
  )!;
  expect(record.required).toBe(true);
});
