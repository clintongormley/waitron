import { afterEach, expect, it, vi } from "vitest";
import { userEvent, page } from "vitest/browser";
import { DashboardApi } from "../api/client.js";
import {
  cleanupWidgets,
  mountWidget,
  dialogClosed,
  expectNoA11yViolations,
} from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import {
  receiptModel,
  preview,
  receiptField,
  receiptSave,
  editReceipt,
} from "../testing/department-receipt-dialog-fixture.js";
import type { DepartmentReceiptDialog } from "./department-receipt-dialog.js";
import "./department-receipt-dialog.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
async function mount(locale = "en-GB", theme: "light" | "dark" = "light") {
  setLocale(locale);
  let model = structuredClone(receiptModel);
  const activity = vi.fn();
  const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    async (path, init) => {
      if (path === "/management-api/receipt-preview")
        return new Response(JSON.stringify(preview()));
      if (init.method === "PUT") return new Response(null, { status: 204 });
      return new Response(JSON.stringify(model));
    },
  );
  const api = new DashboardApi("", fetchImpl, undefined, activity);
  const liveData = api.liveData;
  const { el, host } = await mountWidget<DepartmentReceiptDialog>(
    "dashboard-department-receipt-dialog",
    { api, subject: { id: "bar", name: "Bar" } },
    theme,
  );
  await expect.poll(() => el.shadowRoot?.querySelector("[name=email]")).toBeTruthy();
  const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await expect.poll(() => dialog.shadowRoot?.querySelector("dialog")?.matches(":modal")).toBe(true);
  return {
    el,
    host,
    dialog,
    fetchImpl,
    liveData,
    activity,
    changeModel: (next: typeof model) => {
      model = structuredClone(next);
    },
  };
}
it("a host-selected dialog reads the initial model actively and its live refresh passively", async () => {
  const { el, fetchImpl, liveData, activity } = await mount();
  await expect
    .poll(() => fetchImpl.mock.calls.some(([path]) => path.endsWith("receipt-preview")))
    .toBe(true);
  expect(receiptField(el, "operationDescription").value).toBe("Dining service");
  liveData.invalidate([{ type: "department_receipts" }]);
  await expect
    .poll(() => fetchImpl.mock.calls.filter(([path]) => path.endsWith("/bar/receipt")).length)
    .toBe(2);
  const reads = fetchImpl.mock.calls.filter(([path]) => path.endsWith("/bar/receipt"));
  expect(new Headers(reads[0]![1].headers).has("x-waitron-live")).toBe(false);
  expect(new Headers(reads[1]![1].headers).get("x-waitron-live")).toBe("1");
  expect(activity.mock.calls.filter(([path]) => path.endsWith("/bar/receipt"))).toHaveLength(1);
});
it("a live policy and receipt read preserves the host-selected dialog's authored dirty draft", async () => {
  const { el, fetchImpl, liveData, changeModel } = await mount();
  await editReceipt(el, "email", "draft@example.com");
  changeModel({
    ...receiptModel,
    receipt: { operationDescription: "New elsewhere" },
    policy: { receiptPrintMode: "on_request", printTradingName: false },
  });
  liveData.invalidate([{ type: "department_sale_policies" }]);
  await expect
    .poll(() => fetchImpl.mock.calls.filter(([path]) => path.endsWith("/bar/receipt")).length)
    .toBe(2);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(receiptField(el, "operationDescription").value).toBe("New elsewhere");
  expect(receiptField(el, "email").value).toBe("draft@example.com");
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>("[name=receiptPrintMode]")!
      .checked,
  ).toBe(false);
  expect(receiptSave(el).disabled).toBe(false);
});
it("the host-selected dialog writes the exact model envelope through the real client and closes", async () => {
  const { el, dialog, fetchImpl } = await mount();
  await editReceipt(el, "email", "  counter@example.com  ");
  const saved = vi.fn();
  el.addEventListener("department-receipt-saved", saved);
  const closed = dialogClosed(dialog);
  await userEvent.click(page.elementLocator(receiptSave(el)));
  await closed;
  const writes = fetchImpl.mock.calls.filter(([, init]) => init.method === "PUT");
  expect(writes).toHaveLength(1);
  expect(writes[0]![0]).toBe("/management-api/venue-service/departments/bar/receipt");
  expect(JSON.parse(writes[0]![1].body as string)).toEqual({
    receipt: { ...receiptModel.receipt, email: "counter@example.com" },
    policy: receiptModel.policy,
  });
  expect((saved.mock.calls[0]![0] as CustomEvent).detail).toEqual({ departmentId: "bar" });
  expect(dialog.open).toBe(false);
});

it("a declarative selection can reopen the same department after its closed subject is cleared", async () => {
  const { el, dialog, fetchImpl } = await mount();
  const closed = dialogClosed(dialog);
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector("[data-test=cancel-receipt]")!),
  );
  await closed;
  el.subject = undefined;
  await el.updateComplete;
  el.subject = { id: "bar", name: "Bar" };
  await el.updateComplete;
  await expect
    .poll(() => fetchImpl.mock.calls.filter(([path]) => path.endsWith("/bar/receipt")).length)
    .toBe(2);
  await expect.poll(() => dialog.open).toBe(true);
});

const hostCases = (["light", "dark"] as const).flatMap((theme) =>
  ["en-GB", "es-ES"].flatMap((locale) => [390, 1280].map((width) => ({ theme, locale, width }))),
);
it.each(hostCases)(
  "host-selected receipt client fits $locale/$theme/$width",
  async ({ theme, locale, width }) => {
    const before = { width: innerWidth, height: innerHeight };
    await page.viewport(width, 900);
    try {
      const { host, el, dialog } = await mount(locale, theme);
      expect(innerWidth).toBe(width);
      expect(dialog.description).toBe("Bar");
      await expectNoA11yViolations(host);
      const native = dialog.shadowRoot!.querySelector("dialog")!;
      expect(native.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
      expect(native.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      const body = dialog.shadowRoot!.querySelector<HTMLElement>(".body")!;
      expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
      await expect.poll(() => el.shadowRoot!.querySelector(".paper")).toBeTruthy();
      if (import.meta.env.VITE_A493_PORT_CAPTURE === "1")
        await page.screenshot({
          path: `__screenshots__/look/a493-port/${locale}-${theme}-${width}.png`,
        });
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);
