import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { DepartmentReceiptWrite } from "@waitron/shared";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import {
  deferred,
  mountReceiptEditor,
  preview,
  receiptApi,
  receiptModel,
  receiptRoot,
} from "../testing/department-receipt-editor-fixture.js";
import {
  departmentDialog,
  mountReceiptApp,
  mountReceiptTab,
  receiptTabEditor,
} from "../testing/department-receipt-app-fixture.js";

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
  history.replaceState(null, "", "/manage");
});
const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
  );

it.each([1280, 390])(
  "at %ipx the department dialog offering Receipts opens at its final width and keeps it, and the fields keep theirs, as the receipt, its preview and a narrower paper arrive",
  async (width) => {
    const before = { width: innerWidth, height: innerHeight };
    await page.viewport(width, 900);
    try {
      const read = deferred<typeof receiptModel>();
      const drawn = deferred<ReturnType<typeof preview>>();
      let previews = 0;
      let held = false;
      const { app } = await mountReceiptApp({
        respond: (path, init) => {
          if (path.endsWith("/bar/receipt") && init.method !== "PUT" && !held) {
            held = true;
            return read.promise.then(json);
          }
          if (path !== "/management-api/receipt-preview") return undefined;
          previews++;
          const input = JSON.parse(init.body as string) as DepartmentReceiptWrite & {
            paperWidth?: string;
          };
          if (input.paperWidth !== "58mm") return drawn.promise.then(json);
          const answer = preview();
          return json({
            ...answer,
            paperWidth: "58mm",
            preview: { ...answer.preview, columns: 30, widthDots: 384 },
          });
        },
      });
      await expect.poll(() => receiptTabEditor(app)).toBeTruthy();
      const el = receiptTabEditor(app)!;
      const native = () =>
        departmentDialog(app)
          ?.shadowRoot?.querySelector("wt-modal")
          ?.shadowRoot?.querySelector("dialog");
      await expect.poll(() => native()?.matches(":modal")).toBe(true);
      const opening = native()!.getBoundingClientRect().width;
      if (width === 1280) expect(opening).toBeCloseTo(1024, 0);
      read.resolve(structuredClone(receiptModel));
      await expect.poll(() => receiptRoot(el).querySelector("[name=email]")).toBeTruthy();
      await expect.poll(() => previews).toBe(1);
      const fields = () => receiptRoot(el).querySelector(".fields")!.getBoundingClientRect().width;
      expect(receiptRoot(el).querySelector(".paper")).toBeNull();
      const loaded = { dialog: native()!.getBoundingClientRect().width, fields: fields() };
      expect(loaded.dialog).toBeCloseTo(opening, 0);
      drawn.resolve(preview());
      await expect.poll(() => receiptRoot(el).querySelector(".paper")).toBeTruthy();
      expect(native()!.getBoundingClientRect().width).toBeCloseTo(loaded.dialog, 0);
      expect(fields()).toBeCloseTo(loaded.fields, 0);
      await chooseOption(receiptRoot(el).querySelector("wt-combobox[name=previewWidth]")!, "58mm");
      await expect
        .poll(() => receiptRoot(el).querySelector<HTMLElement>(".paper")?.style.width)
        .toBe("30ch");
      expect(fields()).toBeCloseTo(loaded.fields, 0);
      expect(native()!.getBoundingClientRect().width).toBeCloseTo(loaded.dialog, 0);
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);

it("shows no copy of the saved address, and says so when there is none", async () => {
  const { el, api } = await mountReceiptEditor(
    receiptApi({ ...receiptModel, venueAddress: ["Calle Mayor 1", "28013 Madrid"] }),
  );
  await expect.poll(() => receiptRoot(el).querySelector(".paper")).toBeTruthy();
  expect(receiptRoot(el).textContent).not.toContain("Calle Mayor 1");
  expect(receiptRoot(el).textContent).not.toContain("28013 Madrid");
  api.getDepartmentReceipt.mockResolvedValue({ ...receiptModel, venueAddress: [] });
  api.liveData.invalidate([{ type: "locations" }]);
  await expect
    .poll(() => receiptRoot(el).querySelector("[data-test=venue-address]")?.textContent?.trim())
    .toBe(t("receipts.no_address"));
});

it("does not say the languages are available at the till", async () => {
  const { el } = await mountReceiptEditor();
  expect(receiptRoot(el).textContent).not.toContain("Available at the till.");
});

it.each([1280, 390])(
  "at %ipx a wide logo leaves the department dialog offering Receipts at its no-logo width",
  async (width) => {
    const before = { width: innerWidth, height: innerHeight };
    await page.viewport(width, 900);
    try {
      const dialogWidth = (modal: HTMLElementTagNameMap["wt-modal"]) =>
        modal.shadowRoot!.querySelector("dialog")!.getBoundingClientRect().width;
      const plain = await mountReceiptTab();
      const without = dialogWidth(plain.modal);
      cleanupWidgets();
      const { editor: el, modal } = await mountReceiptTab({
        respond: (path, init) =>
          path.endsWith("/bar/receipt") && init.method !== "PUT"
            ? json({ ...receiptModel, receipt: { ...receiptModel.receipt, logo: "wide.png" } })
            : undefined,
      });
      const upload = receiptRoot(el).querySelector("dashboard-image-upload")!;
      await upload.updateComplete;
      const img = upload.shadowRoot!.querySelector<HTMLImageElement>(
        "[data-test=choose-image] img",
      )!;
      const canvas = document.createElement("canvas");
      canvas.width = 2000;
      canvas.height = 600;
      canvas.getContext("2d")!.fillRect(0, 0, 2000, 600);
      const loaded = new Promise((resolve) =>
        img.addEventListener("load", resolve, { once: true }),
      );
      img.src = canvas.toDataURL("image/png");
      await loaded;
      expect(img.naturalWidth).toBe(2000);
      expect(dialogWidth(modal)).toBeCloseTo(without, 0);
      const fields = receiptRoot(el).querySelector(".fields")!.getBoundingClientRect();
      expect(img.getBoundingClientRect().right).toBeLessThanOrEqual(fields.right);
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);
