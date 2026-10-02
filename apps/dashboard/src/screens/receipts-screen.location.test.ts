import { LiveData } from "@waitron/dashboard-kit";
import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import { ReceiptsScreen } from "./receipts-screen.js";
import { t } from "../i18n/t.js";

const q = (el: ReceiptsScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!;
const flush = async (el: ReceiptsScreen) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
};
const PREVIEW = {
  preview: {
    widthDots: 512,
    columns: 42,
    text: "Deli Test SL\n",
    blocks: [{ kind: "text", text: "Deli Test SL\n" }],
    qrData: [],
    omittedGraphics: false,
    truncated: false,
    unsupported: false,
  },
  marks: { headerSubtitle: null, footerMessage: null },
  paperWidth: "80mm",
  paperWidths: ["80mm"],
};
function api(overrides: Record<string, unknown> = {}): DashboardApi {
  return {
    getLocationSettings: vi
      .fn()
      .mockResolvedValue({ name: "Calle Mayor", operationDescription: "Venta en establecimiento" }),
    putLocationSettings: vi.fn().mockResolvedValue(undefined),
    getReceiptLanguage: vi.fn().mockResolvedValue({
      language: "es-ES",
      choices: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
      fixed: null,
    }),
    putReceiptLanguage: vi.fn().mockResolvedValue(undefined),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    getReceipt: vi.fn().mockResolvedValue({ receipt: {} }),
    putReceipt: vi.fn().mockResolvedValue(undefined),
    previewReceipt: vi.fn().mockResolvedValue(PREVIEW),
    ...overrides,
  } as unknown as DashboardApi;
}
function edit(el: ReceiptsScreen, value: string) {
  q(el, "[name=operationDescription]").dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
}
async function bottomOf(el: ReceiptsScreen): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}
const errorOf = (el: ReceiptsScreen) => q(el, "[name=operationDescription]").getAttribute("error");
const saveDisabled = (el: ReceiptsScreen) => q(el, "[data-test=save]").hasAttribute("disabled");
async function nativeSaveDisabled(el: ReceiptsScreen): Promise<boolean> {
  const button = q(el, "[data-test=save]") as HTMLElement & { updateComplete: Promise<unknown> };
  await button.updateComplete;
  return button.shadowRoot!.querySelector("button")!.disabled;
}
const focusedInput = (el: ReceiptsScreen) => {
  const field = q(el, "[name=operationDescription]");
  return field.shadowRoot!.activeElement === field.shadowRoot!.querySelector("input");
};
afterEach(cleanupWidgets);
describe("receipts page: the location's invoice description", () => {
  it("reads the current setting and saves the entered description", async () => {
    const client = api();
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: client,
    });
    await flush(el);
    expect((q(el, "[name=operationDescription]") as unknown as { value: string }).value).toBe(
      "Venta en establecimiento",
    );
    edit(el, "Venta de comidas");
    q(el, "[data-test=save]").click();
    await flush(el);
    expect(client.putLocationSettings).toHaveBeenCalledWith("Venta de comidas");
    expect(q(el, "[role=status]")).not.toBeNull();
  });
  it("explains an empty field without saving", async () => {
    const client = api();
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: client,
    });
    await flush(el);
    edit(el, "  ");
    q(el, "[data-test=save]").click();
    await flush(el);
    expect(client.putLocationSettings).not.toHaveBeenCalled();
    expect(q(el, "[name=operationDescription]").getAttribute("error")).not.toBe("");
  });
  it("retains a rejected description with a field error", async () => {
    const client = api({
      putLocationSettings: vi.fn().mockRejectedValue({
        code: "management.request_invalid",
        params: { field: "operationDescription" },
      }),
    });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: client,
    });
    await flush(el);
    edit(el, "x".repeat(501));
    q(el, "[data-test=save]").click();
    await flush(el);
    expect(
      (q(el, "[name=operationDescription]") as unknown as { value: string }).value,
    ).toHaveLength(501);
    expect(q(el, "[name=operationDescription]").getAttribute("error")).not.toBe("");
  });
  it("reports a failed read and offers retry", async () => {
    const client = api({ getLocationSettings: vi.fn().mockRejectedValue(new Error("offline")) });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: client,
    });
    await flush(el);
    expect(q(el, "[data-test=retry]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=save]")).toBeNull();
  });
  it("keeps an edited description when the setting refreshes elsewhere", async () => {
    const liveData = new LiveData();
    const client = Object.assign(api(), { liveData });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: client,
    });
    await flush(el);
    edit(el, "Borrador local");
    await el.updateComplete;
    vi.mocked(client.getLocationSettings).mockResolvedValue({
      name: "Calle Nueva",
      operationDescription: "Cambiado en otro sitio",
    });
    liveData.invalidate([{ type: "locations" }]);
    await vi.waitFor(() =>
      expect(q(el, "[data-test=location-name]").textContent).toBe("Calle Nueva"),
    );
    expect((q(el, "[name=operationDescription]") as unknown as { value: string }).value).toBe(
      "Borrador local",
    );
  });
  it("reports a failed save beside the form without a field error", async () => {
    const client = api({
      putLocationSettings: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: client,
    });
    await flush(el);
    q(el, "[data-test=save]").click();
    await flush(el);
    expect(await bottomOf(el)).toBe(t("location_settings.save_error"));
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    expect(saveDisabled(el)).toBe(false);
    expect(q(el, "[name=operationDescription]").getAttribute("error")).toBe("");
    expect(el.shadowRoot!.querySelector("[role=status]")).toBeNull();
  });
  it.each([1280, 390])(
    "puts a failed save's message on its own line at the form's left edge, between the field and Save (%ipx)",
    async (width) => {
      await page.viewport(width, 900);
      try {
        const client = api({
          putLocationSettings: vi.fn().mockRejectedValue({ code: "server.internal" }),
        });
        const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
          api: client,
        });
        await flush(el);
        q(el, "[data-test=save]").click();
        await flush(el);
        const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
        await actions.updateComplete;
        const message = actions.shadowRoot!.querySelector("[data-error]")!;
        expect(message.textContent).toBe(t("location_settings.save_error"));
        const field = q(el, "[name=operationDescription]").getBoundingClientRect();
        const save = q(el, "[data-test=save]").getBoundingClientRect();
        const box = message.getBoundingClientRect();
        expect(box.top).toBeGreaterThanOrEqual(field.bottom);
        expect(box.bottom).toBeLessThanOrEqual(save.top);
        expect(box.left).toBeCloseTo(field.left, 0);
        expect(box.right).toBeCloseTo(field.right, 0);
        expect(getComputedStyle(message).textAlign).toBe("start");
      } finally {
        await page.viewport(1280, 900);
      }
    },
  );
  it("leaves the spacing token between the field and the action row", async () => {
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: api(),
    });
    await flush(el);
    el.style.setProperty("--wt-space-4", "23px");
    const field = q(el, "[name=operationDescription]").getBoundingClientRect();
    const actions = q(el, "wt-form-actions").getBoundingClientRect();
    expect(actions.top - field.bottom).toBe(23);
  });
  it("retries a failed read and then shows the form", async () => {
    const client = api({
      getLocationSettings: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ name: "Calle Mayor", operationDescription: "Venta" }),
    });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: client,
    });
    await flush(el);
    q(el, "[data-test=retry]").click();
    await flush(el);
    expect(client.getLocationSettings).toHaveBeenCalledTimes(2);
    expect(el.shadowRoot!.querySelector("[data-test=retry]")).toBeNull();
    expect((q(el, "[name=operationDescription]") as unknown as { value: string }).value).toBe(
      "Venta",
    );
  });
  it("saves the description when Enter is pressed in it", async () => {
    const client = api();
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: client,
    });
    await flush(el);
    const field = el.shadowRoot!.querySelector<import("@waitron/ui").WtInput>(
      "[name=operationDescription]",
    )!;
    await field.updateComplete;
    const input = field.shadowRoot!.querySelector("input")!;
    input.value = "Venta de comidas";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    input.focus();
    await userEvent.keyboard("{Enter}");
    await flush(el);
    expect(client.putLocationSettings).toHaveBeenCalledExactlyOnceWith("Venta de comidas");
  });
  it("sends one save while a save is still in flight", async () => {
    let resolve!: () => void;
    const putLocationSettings = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: api({ putLocationSettings }),
    });
    await flush(el);
    q(el, "[data-test=save]").click();
    await el.updateComplete;
    q(el, "[data-test=save]").click();
    try {
      expect(putLocationSettings).toHaveBeenCalledTimes(1);
    } finally {
      resolve();
      await flush(el);
    }
  });
  it("says nothing about errors before the first submission, and Save works", async () => {
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: api(),
    });
    await flush(el);
    edit(el, "  ");
    await el.updateComplete;
    expect(errorOf(el)).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(saveDisabled(el)).toBe(false);
  });
  it("on an invalid submission shows the field and bottom messages, focuses the field and disables Save", async () => {
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: api(),
    });
    await flush(el);
    edit(el, "  ");
    q(el, "[data-test=save]").click();
    await flush(el);
    expect(errorOf(el)).toBe(t("location_settings.required"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(saveDisabled(el)).toBe(true);
    expect(focusedInput(el)).toBe(true);
    expect((q(el, "[name=operationDescription]") as unknown as { value: string }).value).toBe("  ");
  });
  it("re-checks every change after a failed submission, and Save works again once fixed", async () => {
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: api(),
    });
    await flush(el);
    edit(el, "");
    q(el, "[data-test=save]").click();
    await flush(el);
    edit(el, "Venta");
    await el.updateComplete;
    expect(errorOf(el)).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(saveDisabled(el)).toBe(false);
    edit(el, " ");
    await el.updateComplete;
    expect(errorOf(el)).toBe(t("location_settings.required"));
    expect(saveDisabled(el)).toBe(true);
  });
  it("keeps a refused description's message until the field changes, focusing it when the refusal arrives, with Save working", async () => {
    const client = api({
      putLocationSettings: vi.fn().mockRejectedValue({
        code: "management.request_invalid",
        params: { field: "operationDescription" },
      }),
    });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: client,
    });
    await flush(el);
    edit(el, "x".repeat(501));
    q(el, "[data-test=save]").click();
    await flush(el);
    await vi.waitFor(() => expect(focusedInput(el)).toBe(true));
    expect(errorOf(el)).toBe(t("location_settings.invalid"));
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(await nativeSaveDisabled(el)).toBe(false);
    edit(el, "x".repeat(500));
    await el.updateComplete;
    expect(errorOf(el)).toBe("");
    expect(await bottomOf(el)).toBe("");
    expect(saveDisabled(el)).toBe(false);
  });
  it("says a failed save and the generic sentence together when the field then breaks", async () => {
    const client = api({
      putLocationSettings: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: client,
    });
    await flush(el);
    q(el, "[data-test=save]").click();
    await flush(el);
    edit(el, " ");
    await flush(el);
    expect(await bottomOf(el)).toBe(`${t("location_settings.save_error")} ${t("form.fix_fields")}`);
    expect(saveDisabled(el)).toBe(true);
  });
  it("puts a refusal naming a field the form does not show in the bottom message, leaving Save working", async () => {
    const client = api({
      putLocationSettings: vi.fn().mockRejectedValue({
        code: "management.request_invalid",
        params: { field: "locationId" },
      }),
    });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: client,
    });
    await flush(el);
    q(el, "[data-test=save]").click();
    await flush(el);
    expect(errorOf(el)).toBe("");
    expect(await bottomOf(el)).toBe(t("location_settings.save_error"));
    expect(await nativeSaveDisabled(el)).toBe(false);
  });
  it("leaves Save working after a refusal that names no field", async () => {
    const client = api({
      putLocationSettings: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", {
      api: client,
    });
    await flush(el);
    q(el, "[data-test=save]").click();
    await flush(el);
    expect(saveDisabled(el)).toBe(false);
    q(el, "[data-test=save]").click();
    await flush(el);
    expect(client.putLocationSettings).toHaveBeenCalledTimes(2);
  });
  it.each(["light", "dark"] as const)("has no accessibility violations in %s", async (theme) => {
    const { el, host } = await mountWidget<ReceiptsScreen>(
      "dashboard-receipts-screen",
      { api: api() },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
