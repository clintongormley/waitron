import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyTokens, setContentLanguages } from "@waitron/ui";
import { currentLocale, setLocale } from "@waitron/dashboard-kit";
import type { AdjustmentReason, AdjustmentsApi } from "./client.js";
import type { AdjustmentReasonsScreen } from "./reasons-screen.js";
import "./reasons-screen.js";

const reason: AdjustmentReason = {
  id: "reason",
  name: "Complaint",
  names: { en: "Guest complaint", es: "Guest complaint (es)" },
  kind: "comp",
  actions: ["discount_percent"],
  maxPercentBp: 5000,
  maxAmount: "30.00",
  applyRoles: ["supervisor", "manager", "admin"],
  approverRoles: ["manager", "admin"],
  noteRequired: true,
  position: 0,
};
let el: AdjustmentReasonsScreen;
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
  sessionStorage.clear();
});
afterEach(() => {
  el?.remove();
  setLocale(locale);
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
  sessionStorage.clear();
});

async function mount() {
  const api = {
    listReasons: vi.fn().mockResolvedValue([reason]),
    getSettings: vi
      .fn()
      .mockResolvedValue({ maxBillComp: "15.00", billApproverRoles: ["manager", "admin"] }),
    saveSettings: vi.fn(async (value: unknown) => value),
    updateReason: vi.fn().mockResolvedValue(reason),
    createReason: vi.fn().mockResolvedValue(reason),
  };
  el = document.createElement("dashboard-adjustment-reasons-screen");
  el.api = Object.assign(api, { background: api }) as unknown as AdjustmentsApi;
  applyTokens(el);
  document.body.append(el);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=save-limit]")).not.toBeNull(),
  );
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=edit-reason]")).not.toBeNull(),
  );
  return api;
}

async function edit(create = false) {
  el.shadowRoot!.querySelector<HTMLElement>(
    create ? "[data-test=add-reason]" : "[data-test=edit-reason]",
  )!.click();
  await el.updateComplete;
}

async function change(name: string, value: string) {
  el.shadowRoot!.querySelector(`[name=${name}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
  await el.updateComplete;
}

async function state(test: string, disabled: boolean, variant: string) {
  const button = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `[data-test=${test}]`,
  )!;
  await button.updateComplete;
  expect(button.disabled).toBe(disabled);
  expect(button.shadowRoot!.querySelector("button")!.disabled).toBe(disabled);
  expect(button.variant).toBe(variant);
}

it.each([false, true])(
  "reason opens quiet, enables on edit and quiets on undo (create=%s)",
  async (create) => {
    await mount();
    await edit(create);
    await state("save-editor", true, "secondary");
    await change("name", "New complaint");
    await state("save-editor", false, "primary");
    await change("name", create ? "" : "Complaint");
    await state("save-editor", true, "secondary");
    if (!create) {
      await change("maxPercent", "75");
      await state("save-editor", false, "primary");
      await change("maxPercent", "50.00");
      await state("save-editor", true, "secondary");
      await change("maxAmount", "35");
      await state("save-editor", false, "primary");
      await change("maxAmount", "30");
      await state("save-editor", true, "secondary");
    }
  },
);

it("unchanged reason sends no update and Cancel works without a coordinator", async () => {
  const api = await mount();
  await edit();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
  await el.updateComplete;
  expect(api.updateReason).not.toHaveBeenCalled();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await expect.poll(() => el.shadowRoot!.querySelector("wt-modal")).toBeNull();
});

it("limit opens quiet, compares numeric values and quiets after a successful save", async () => {
  const api = await mount();
  await state("save-limit", true, "secondary");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-limit]")!.click();
  expect(api.saveSettings).not.toHaveBeenCalled();
  await change("maxBillComp", "20");
  await state("save-limit", false, "primary");
  await change("maxBillComp", "15.00");
  await state("save-limit", true, "secondary");
  await change("maxBillComp", "20");
  api.getSettings.mockResolvedValue({
    maxBillComp: "20.00",
    billApproverRoles: ["manager", "admin"],
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-limit]")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=limit-saved]")).not.toBeNull(),
  );
  await state("save-limit", true, "secondary");
  expect(api.saveSettings).toHaveBeenCalledWith({
    maxBillComp: "20.00",
    billApproverRoles: ["manager", "admin"],
  });
});

it("limit's approvers enable Save when changed and quiet it when chosen back", async () => {
  const api = await mount();
  const approvers = async (values: string[]) => {
    el.shadowRoot!.querySelector("[name=billApproverRoles]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { values } }),
    );
    await el.updateComplete;
  };
  await approvers(["admin"]);
  await state("save-limit", false, "primary");
  await approvers(["admin", "manager"]);
  await state("save-limit", true, "secondary");
  await approvers(["admin"]);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-limit]")!.click();
  await vi.waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(1));
  expect(api.saveSettings).toHaveBeenCalledWith({
    maxBillComp: "15.00",
    billApproverRoles: ["admin"],
  });
});

it("a refused changed limit remains primary and retryable", async () => {
  const api = await mount();
  await change("maxBillComp", "20");
  api.saveSettings.mockRejectedValueOnce({ code: "connection.failed" });
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-limit]")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe(""),
  );
  await state("save-limit", false, "primary");
  api.getSettings.mockResolvedValue({
    maxBillComp: "20.00",
    billApproverRoles: ["manager", "admin"],
  });
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-limit]")!.click();
  await vi.waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=limit-saved]")).not.toBeNull(),
  );
  await state("save-limit", true, "secondary");
});

it("a standalone reason keeps newer input after saving and quiets when returned to the submitted value", async () => {
  const api = await mount();
  await edit();
  let finish!: (value: AdjustmentReason) => void;
  api.updateReason.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  await change("name", "Submitted complaint");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
  await el.updateComplete;
  await state("save-editor", true, "primary");
  await change("name", "Newer complaint");
  finish(reason);
  await vi.waitFor(() => expect(api.listReasons).toHaveBeenCalledTimes(2));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Newer complaint");
  await state("save-editor", false, "primary");
  await change("name", " Submitted complaint ");
  await state("save-editor", true, "secondary");
});
