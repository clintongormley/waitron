import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LiveData } from "@waitron/dashboard-kit";
import { LeaveController } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi } from "../api/client.js";
import {
  cleanupWidgets,
  mountWidget,
  reattachAfterDetachedUpdate,
} from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./receipts-screen.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture() {
  return {
    liveData: new LiveData(),
    getReceipt: vi.fn(async () => ({
      receipt: { headerSubtitle: "Venue", printAddress: false },
      venueAddress: ["Main street"],
    })),
    getDepartmentReceipt: vi.fn(async () => ({
      receipt: {},
      venueDefaults: { headerSubtitle: "Venue", printAddress: false },
      languages: ["es-ES", "ca-ES"],
      warningLanguages: [],
      venueAddress: ["Main street"],
    })),
    getLocationSettings: vi.fn(async () => ({ name: "Venue", operationDescription: "Sales" })),
    getReceiptLanguage: vi.fn(async () => ({
      language: "es-ES",
      choices: ["es-ES", "ca-ES"],
      fixed: null,
    })),
    getContentLanguages: vi.fn(async () => ({ defaultLanguage: "es", languages: ["es", "ca"] })),
    putDepartmentReceipt: vi.fn<DashboardApi["putDepartmentReceipt"]>(async () => {}),
    previewReceiptDraft: vi.fn<DashboardApi["previewReceiptDraft"]>(async (draft) => ({
      preview: {
        widthDots: 512,
        columns: 42,
        text: draft.receipt.email ?? "Sample",
        blocks: [{ kind: "text", text: draft.receipt.email ?? "Sample" }],
        qrData: [],
        omittedGraphics: false,
        truncated: false,
        unsupported: false,
      },
      marks: {
        logo: null,
        headerSubtitle: null,
        address: null,
        phone: null,
        email: null,
        footerMessage: null,
      },
      paperWidth: "80mm",
      paperWidths: ["58mm", "80mm"],
    })),
    imageLibraryRequest: vi.fn(async () => ({ images: [], total: 0 })),
  };
}
class TabDraftHost extends LitElement {
  readonly leave = new LeaveController(this);
  api = fixture();
  override render() {
    return html`<dashboard-receipts-screen
        .api=${this.api as unknown as DashboardApi}
        departmentId="bar"
        departmentName="Bar"
      ></dashboard-receipts-screen>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("receipt-tab-draft-host", TabDraftHost);
async function mount(api = fixture()) {
  const { el: app } = await mountWidget<TabDraftHost>("receipt-tab-draft-host", { api });
  const screen = app.shadowRoot!.querySelector("dashboard-receipts-screen")!;
  await expect
    .poll(() =>
      screen.shadowRoot
        ?.querySelector("dashboard-department-receipt-editor")
        ?.shadowRoot?.querySelector("[name=email]"),
    )
    .toBeTruthy();
  const editor = screen.shadowRoot!.querySelector("dashboard-department-receipt-editor")!;
  return { app, screen, editor, api };
}
async function edit(
  editor: HTMLElementTagNameMap["dashboard-department-receipt-editor"],
  value: string,
) {
  const field =
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=email]")!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  return field;
}
async function choose(app: TabDraftHost, decision: "keep" | "discard") {
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  const modal = question.shadowRoot!.querySelector("wt-modal")!;
  const closed = new Promise<void>((resolve) =>
    modal.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  await userEvent.click(
    page.elementLocator(question.shadowRoot!.querySelector(`[data-choice=${decision}]`)!),
  );
  await closed;
}
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it("hosted receipt refreshes live defaults and its paper passively without erasing a draft", async () => {
  const { screen, editor, api } = await mount();
  const field = await edit(editor, "draft@example.com");
  await expect
    .poll(() => api.previewReceiptDraft.mock.lastCall?.[0].receipt.email)
    .toBe("draft@example.com");
  api.getReceipt.mockResolvedValue({
    receipt: { headerSubtitle: "New venue", printAddress: true },
    venueAddress: ["Main street"],
  });
  api.liveData.invalidate([{ type: "tenant_receipts" }]);
  await expect
    .poll(() => api.previewReceiptDraft.mock.lastCall?.[0].settings)
    .toEqual({ headerSubtitle: "New venue" });
  expect(api.previewReceiptDraft.mock.lastCall?.[1]).toEqual({ passive: true });
  expect(field.value).toBe("draft@example.com");
  await expect
    .poll(
      () =>
        editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
          "[name=headerSubtitle-es-ES]",
        )!.hint,
    )
    .toBe("New venue");
  expect(screen.shadowRoot!.querySelector("[name=printAddress]")).toBeNull();
});

it("hosted Keep and Discard use one editor scope and restore the visible input", async () => {
  const { app, editor } = await mount();
  const field = await edit(editor, "draft@example.com");
  let count = 0;
  const request = () =>
    app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {
        count++;
      },
    });
  const kept = request();
  await choose(app, "keep");
  expect(await kept).toBe("kept");
  expect(count).toBe(0);
  expect(field.value).toBe("draft@example.com");
  const discarded = request();
  await choose(app, "discard");
  expect(await discarded).toBe("proceeded");
  expect(count).toBe(1);
  await expect.poll(() => field.shadowRoot!.querySelector("input")!.value).toBe("");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("hosted reconnect preserves the native draft and its Save baseline", async () => {
  const { app, screen, editor } = await mount();
  await edit(editor, "draft@example.com");
  await reattachAfterDetachedUpdate(screen);
  await expect
    .poll(
      () =>
        editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=email]")!.value,
    )
    .toBe("draft@example.com");
  expect(app.leave.coordinator.isDirty()).toBe(true);
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=department-save]",
    )!.disabled,
  ).toBe(false);
  await edit(editor, "");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("a hosted late save cannot commit the reconnected draft", async () => {
  const api = fixture();
  const held = deferred<void>();
  api.putDepartmentReceipt.mockImplementationOnce(() => held.promise);
  const { app, screen, editor } = await mount(api);
  await edit(editor, "sent@example.com");
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=department-save]")!.click();
  await expect.poll(() => api.putDepartmentReceipt.mock.calls.length).toBe(1);
  await reattachAfterDetachedUpdate(screen);
  await edit(editor, "later@example.com");
  held.resolve();
  await held.promise;
  await editor.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(true);
  const discarded = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  await choose(app, "discard");
  expect(await discarded).toBe("proceeded");
  await expect
    .poll(
      () =>
        editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=email]")!.value,
    )
    .toBe("");
});
it("hosted preview language is independent and unchanged Save performs no write", async () => {
  const { app, screen, editor, api } = await mount();
  await expect.poll(() => screen.shadowRoot!.querySelector("[name=previewLanguage]")).toBeTruthy();
  await chooseOption(
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "[name=previewLanguage]",
    )!,
    "ca-ES",
  );
  await expect.poll(() => api.previewReceiptDraft.mock.lastCall?.[0].language).toBe("ca-ES");
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=department-save]")!.click();
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("hosted refusal identifies its locale field, focuses it and leaves retry available", async () => {
  const api = fixture();
  api.putDepartmentReceipt.mockRejectedValue({
    code: "receipt.invalid",
    params: { field: "headerSubtitle", language: "ca-ES", reason: "too_long", maxLength: 80 },
  });
  const { app, editor } = await mount(api);
  const subtitle = editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "[name=headerSubtitle-ca-ES]",
  )!;
  await subtitle.updateComplete;
  await userEvent.fill(
    page.elementLocator(subtitle.shadowRoot!.querySelector("input")!),
    "Draft català",
  );
  const save = editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=department-save]",
  )!;
  save.click();
  await expect.poll(() => subtitle.error).not.toBe("");
  expect(subtitle.error).toBe(t("receipts.trim_too_long").replace("{max}", "80"));
  expect(editor.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  await expect
    .poll(() => subtitle.shadowRoot!.activeElement)
    .toBe(subtitle.shadowRoot!.querySelector("input"));
  expect(save.disabled).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(true);
});
