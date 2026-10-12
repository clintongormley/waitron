import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets, dialogClosed } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import {
  clickReceiptSave,
  deferred,
  editReceipt,
  mountReceiptDialog,
  preview,
  receiptApi,
  receiptField,
  receiptModel,
  receiptSave,
} from "../testing/department-receipt-dialog-fixture.js";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
it("opens with required description, bare languages and no inherited content or no-op write", async () => {
  const { el, api } = await mountReceiptDialog();
  expect(receiptField(el, "operationDescription").required).toBe(true);
  expect(
    [...el.shadowRoot!.querySelectorAll("h3[lang]")].map((h) => h.textContent!.trim()),
  ).toEqual(["Spanish", "Catalan"]);
  expect(receiptField(el, "headerSubtitle-ca-ES").hint).not.toBe("Bar");
  expect(el.shadowRoot!.querySelector("dashboard-image-upload")!.inheritedImage).toBeNull();
  expect(receiptSave(el).disabled).toBe(true);
  expect(receiptSave(el).variant).toBe("secondary");
  receiptSave(el).click();
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});
it("saves exact independent receipt and policy, keeps hidden translations and closes before any refresh", async () => {
  const { el, dialog, api } = await mountReceiptDialog();
  await editReceipt(el, "email", "bar@example.com");
  expect(receiptSave(el).variant).toBe("primary");
  const closed = dialogClosed(dialog);
  await clickReceiptSave(el);
  await closed;
  expect(api.putDepartmentReceipt).toHaveBeenCalledExactlyOnceWith("bar", {
    receipt: {
      operationDescription: "Dining service",
      headerSubtitle: { "es-ES": "Bar", "eu-ES": "Retained" },
      email: "bar@example.com",
    },
    policy: { receiptPrintMode: "auto", printTradingName: true },
  });
  expect(api.getDepartmentReceipt).toHaveBeenCalledTimes(1);
  expect(dialog.open).toBe(false);
});
it("explains an empty required description and disables Save until repaired", async () => {
  const { el, api } = await mountReceiptDialog();
  await editReceipt(el, "operationDescription", "");
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  expect(receiptField(el, "operationDescription").error).toBe(t("location_settings.required"));
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  expect(receiptSave(el).disabled).toBe(true);
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  await editReceipt(el, "operationDescription", "Counter service");
  expect(receiptSave(el).disabled).toBe(false);
});

it("uses the server's installed contribution metadata to hide the description and save decoration", async () => {
  const { el, api } = await mountReceiptDialog(
    receiptApi({
      ...receiptModel,
      receipt: {},
      operationDescriptionRequired: false,
    }),
  );
  expect(el.shadowRoot!.querySelector("[name=operationDescription]")).toBeNull();
  await editReceipt(el, "email", "bar@example.com");
  await clickReceiptSave(el);
  await expect.poll(() => api.putDepartmentReceipt.mock.calls.length).toBe(1);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt).toEqual({ email: "bar@example.com" });
});
it("allows installations without a description field to save their empty receipt", async () => {
  const { el, api } = await mountReceiptDialog(receiptApi({ ...receiptModel, receipt: {} }));
  el.requiresDescription = false;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[name=operationDescription]")).toBeNull();
  await editReceipt(el, "email", "bar@example.com");
  await clickReceiptSave(el);
  await expect.poll(() => api.putDepartmentReceipt.mock.calls.length).toBe(1);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt).toEqual({ email: "bar@example.com" });
});
it.each(["a".repeat(501), "Sale\u0001service"])(
  "refuses an invalid authored description without writing (%j)",
  async (value) => {
    const { el, api } = await mountReceiptDialog();
    await editReceipt(el, "operationDescription", value);
    await clickReceiptSave(el);
    expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
    expect(receiptField(el, "operationDescription").error).toBe(t("location_settings.invalid"));
    expect(receiptSave(el).disabled).toBe(true);
  },
);
it("permits a 500-character description and validates the telephone before writing", async () => {
  const { el, api } = await mountReceiptDialog();
  await editReceipt(el, "operationDescription", "a".repeat(500));
  await editReceipt(el, "phone", "not a telephone");
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  expect(receiptField(el, "phone").error).toBe(t("receipts.invalid_phone"));
  await editReceipt(el, "phone", "+34 912 345 678");
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt.operationDescription).toBe(
    "a".repeat(500),
  );
});
it("keeps receipt policies read-only without service management permission", async () => {
  const { el, api } = await mountReceiptDialog();
  el.canManagePolicy = false;
  await el.updateComplete;
  const toggle =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>("[name=printTradingName]")!;
  expect(toggle.disabled).toBe(true);
  toggle.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked: false }, bubbles: true, composed: true }),
  );
  await editReceipt(el, "phone", "+34 912 345 678");
  await clickReceiptSave(el);
  await expect.poll(() => api.putDepartmentReceipt.mock.calls.length).toBe(1);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].policy).toEqual({
    receiptPrintMode: "auto",
    printTradingName: true,
  });
});
it("puts a server refusal beside its translated field and keeps the retry enabled", async () => {
  const api = receiptApi();
  api.putDepartmentReceipt.mockRejectedValue({
    code: "receipt.invalid",
    params: { field: "headerSubtitle", language: "ca-ES", reason: "too_long", maxLength: 80 },
  });
  const { el } = await mountReceiptDialog(api);
  await editReceipt(el, "headerSubtitle-ca-ES", "Cafè");
  await clickReceiptSave(el);
  await expect
    .poll(() => receiptField(el, "headerSubtitle-ca-ES").error)
    .toBe(t("receipts.trim_too_long").replace("{max}", "80"));
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  expect(receiptSave(el).disabled).toBe(false);
});
it("stale preview success and failure cannot replace the latest draft's paper", async () => {
  const api = receiptApi();
  const first = deferred<ReturnType<typeof preview>>();
  api.previewReceiptDraft.mockImplementationOnce(() => first.promise);
  const { el } = await mountReceiptDialog(api);
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(1);
  api.previewReceiptDraft.mockResolvedValue(preview("LATEST"));
  await editReceipt(el, "email", "new@example.com");
  first.resolve(preview("STALE"));
  await first.promise;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".paper")?.textContent ?? "").not.toContain("STALE");
  await expect.poll(() => el.shadowRoot!.querySelector(".paper")?.textContent).toContain("LATEST");
  expect(el.shadowRoot!.querySelector(".paper")!.textContent).toContain("LATEST");
  expect(api.previewReceiptDraft.mock.lastCall?.[1]).toEqual({ passive: true });
});
it("live reads preserve a dirty draft and read recovery cannot erase a failed save", async () => {
  const { el, api } = await mountReceiptDialog();
  await editReceipt(el, "email", "draft@example.com");
  api.putDepartmentReceipt.mockRejectedValue({ code: "server.internal" });
  await clickReceiptSave(el);
  await expect.poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
  api.getDepartmentReceipt.mockResolvedValue({
    ...receiptModel,
    receipt: { operationDescription: "New", email: "remote@example.com" },
  });
  api.liveData.invalidate([{ type: "department_receipts" }]);
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(receiptField(el, "email").value).toBe("draft@example.com");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
});
it("shows missing translations in the offered languages and clears the warning as the draft is filled", async () => {
  const { el } = await mountReceiptDialog();
  expect(el.shadowRoot!.querySelector("[data-test=translation-warning]")?.textContent).toBe(
    t("receipts.translation_warning"),
  );
  await editReceipt(el, "headerSubtitle-ca-ES", "Bar català");
  expect(el.shadowRoot!.querySelector("[data-test=translation-warning]")).toBeNull();
});
it.each(["printTradingName", "receiptPrintMode"] as const)(
  "a %s policy refusal is visible beside its switch as well as in the bottom summary",
  async (field) => {
    const api = receiptApi();
    api.putDepartmentReceipt.mockRejectedValue({
      code: "management.request_invalid",
      params: { field },
    });
    const { el } = await mountReceiptDialog(api);
    const toggle = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
      `[name=${field}]`,
    )!;
    await toggle.updateComplete;
    await userEvent.click(page.elementLocator(toggle.shadowRoot!.querySelector("label")!));
    await clickReceiptSave(el);
    await expect
      .poll(() => el.shadowRoot!.querySelector(`[data-field-error=${field}]`)?.textContent)
      .toBeTruthy();
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
    expect(receiptSave(el).disabled).toBe(false);
  },
);
it("draft address and policy switches affect both preview and the exact submitted receipt", async () => {
  const { el, api } = await mountReceiptDialog();
  for (const name of ["printAddress", "printTradingName", "receiptPrintMode"]) {
    const toggle = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
      `[name=${name}]`,
    )!;
    await toggle.updateComplete;
    await userEvent.click(page.elementLocator(toggle.shadowRoot!.querySelector("label")!));
  }
  await expect
    .poll(() => api.previewReceiptDraft.mock.lastCall?.[0])
    .toMatchObject({
      departmentId: "bar",
      receipt: { printAddress: true },
      policy: { receiptPrintMode: "on_request", printTradingName: false },
    });
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1]).toMatchObject({
    receipt: { printAddress: true },
    policy: { receiptPrintMode: "on_request", printTradingName: false },
  });
});
it("returning an initially absent address switch to off restores the quiet Save baseline", async () => {
  const { el, app } = await mountReceiptDialog();
  const toggle =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>("[name=printAddress]")!;
  await toggle.updateComplete;
  const label = page.elementLocator(toggle.shadowRoot!.querySelector("label")!);
  await userEvent.click(label);
  await expect.poll(() => receiptSave(el).disabled).toBe(false);
  await userEvent.click(label);
  await expect.poll(() => receiptSave(el).disabled).toBe(true);
  expect(receiptSave(el).variant).toBe("secondary");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("an explicit preview paper width is sent without changing the receipt draft", async () => {
  const { el, api, app } = await mountReceiptDialog();
  await expect.poll(() => el.shadowRoot!.querySelector("[name=previewWidth]")).toBeTruthy();
  await chooseOption(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=previewWidth]")!,
    "58mm",
  );
  await expect
    .poll(() => api.previewReceiptDraft.mock.lastCall?.[0])
    .toMatchObject({ paperWidth: "58mm" });
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("a deleted department's live read closes its editor and releases the draft", async () => {
  const { el, api, dialog, app } = await mountReceiptDialog();
  await editReceipt(el, "email", "draft@example.com");
  api.getDepartmentReceipt.mockRejectedValue({ code: "department.not_found" });
  const closed = dialogClosed(dialog);
  api.liveData.invalidate([{ type: "departments" }]);
  await expect.poll(() => dialog.open).toBe(false);
  await closed;
  expect(dialog.open).toBe(false);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("a stale preview refusal cannot show an error after the current paper arrives", async () => {
  const api = receiptApi();
  const old = deferred<ReturnType<typeof preview>>();
  api.previewReceiptDraft.mockImplementationOnce(() => old.promise);
  const { el } = await mountReceiptDialog(api);
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(1);
  api.previewReceiptDraft.mockResolvedValue(preview("CURRENT"));
  await editReceipt(el, "email", "new@example.com");
  old.reject({ code: "server.internal" });
  await old.promise.catch(() => {});
  await el.updateComplete;
  await expect.poll(() => el.shadowRoot!.querySelector(".paper")?.textContent).toContain("CURRENT");
  expect(el.shadowRoot!.querySelector(".preview [role=alert]")).toBeNull();
});
it.each(["success", "refusal"])(
  "a departed %s cannot close or mark a reopened dialog",
  async (outcome) => {
    const api = receiptApi();
    const held = deferred<void>();
    api.putDepartmentReceipt.mockImplementationOnce(() => held.promise);
    const { el, dialog } = await mountReceiptDialog(api);
    await editReceipt(el, "email", "sent@example.com");
    await clickReceiptSave(el);
    el.dismiss();
    await dialogClosed(dialog);
    el.show({ id: "cafe", name: "Cafe" });
    await expect.poll(() => el.shadowRoot!.querySelector("[name=email]")).toBeTruthy();
    await editReceipt(el, "email", "later@example.com");
    if (outcome === "success") held.resolve();
    else held.reject({ code: "server.internal" });
    await held.promise.catch(() => {});
    await el.updateComplete;
    expect(dialog.open).toBe(true);
    expect(receiptField(el, "email").value).toBe("later@example.com");
    expect(receiptSave(el).disabled).toBe(false);
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
  },
);

it("opens a host-selected subject once and returns to its host on close", async () => {
  const { el, dialog, api } = await mountReceiptDialog();
  const closed = dialogClosed(dialog);
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector("[data-test=cancel-receipt]")!),
  );
  await closed;
  const returned: string[] = [];
  el.addEventListener("department-receipt-closed", (event) =>
    returned.push((event as CustomEvent).detail.departmentId),
  );
  el.subject = { id: "terrace", name: "Terrace" };
  await el.updateComplete;
  await expect.poll(() => api.getDepartmentReceipt.mock.lastCall?.[0]).toBe("terrace");
  await expect.poll(() => dialog.open).toBe(true);
  const nextClosed = dialogClosed(dialog);
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector("[data-test=cancel-receipt]")!),
  );
  await nextClosed;
  expect(returned).toEqual(["terrace"]);
  el.subject = { id: "terrace", name: "New name" };
  await el.updateComplete;
  expect(dialog.open).toBe(false);
  expect(api.getDepartmentReceipt).toHaveBeenCalledTimes(2);
});

it("refreshes the selected subject name without replacing its dirty receipt or rereading", async () => {
  const { el, api } = await mountReceiptDialog();
  await editReceipt(el, "email", "draft@example.com");
  el.subject = { id: "bar", name: "Renamed counter" };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-dialog")!.description).toBe("Renamed counter");
  expect(receiptField(el, "email").value).toBe("draft@example.com");
  expect(api.getDepartmentReceipt).toHaveBeenCalledTimes(1);
});
it("can reopen the same subject after its host clears a closed selection", async () => {
  const { el, dialog, api } = await mountReceiptDialog();
  el.subject = { id: "bar", name: "Bar" };
  await el.updateComplete;
  const closed = dialogClosed(dialog);
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector("[data-test=cancel-receipt]")!),
  );
  await closed;
  el.subject = undefined;
  await el.updateComplete;
  el.subject = { id: "bar", name: "Bar" };
  await el.updateComplete;
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  await expect.poll(() => dialog.open).toBe(true);
});
it("a selected department removed during its live read returns its identity to the host once", async () => {
  const { el, api, dialog } = await mountReceiptDialog();
  const returned: string[] = [];
  el.addEventListener("department-receipt-closed", (event) =>
    returned.push((event as CustomEvent).detail.departmentId),
  );
  api.getDepartmentReceipt.mockRejectedValue({ code: "department.not_found", status: 404 });
  const closed = dialogClosed(dialog);
  api.liveData.invalidate([{ type: "departments" }]);
  await closed;
  expect(returned).toEqual(["bar"]);
  el.dismiss();
  expect(returned).toEqual(["bar"]);
});

it("an ignored replacement subject does not overwrite a dirty receipt or consume its later opening", async () => {
  const { el, dialog, api } = await mountReceiptDialog();
  await editReceipt(el, "email", "draft@example.com");
  el.subject = { id: "terrace", name: "Terrace" };
  await el.updateComplete;
  expect(api.getDepartmentReceipt).toHaveBeenCalledTimes(1);
  expect(dialog.description).toBe("Bar");
  expect(receiptField(el, "email").value).toBe("draft@example.com");
  expect(receiptSave(el).disabled).toBe(false);
  expect(receiptField(el, "operationDescription").value).toBe("Dining service");
  await editReceipt(el, "email", "");
  const closed = dialogClosed(dialog);
  await userEvent.click(
    page.elementLocator(el.shadowRoot!.querySelector("[data-test=cancel-receipt]")!),
  );
  await closed;
  el.subject = { id: "terrace", name: "Terrace" };
  await el.updateComplete;
  await expect.poll(() => api.getDepartmentReceipt.mock.lastCall?.[0]).toBe("terrace");
  await expect.poll(() => dialog.open).toBe(true);
});

it("compares and sends trimmed offered text while preserving hidden authored values exactly", async () => {
  const api = receiptApi({
    ...receiptModel,
    receipt: { ...receiptModel.receipt, headerSubtitle: { "es-ES": "Bar", "eu-ES": "  Hidden  " } },
  });
  const { el, app } = await mountReceiptDialog(api);
  await editReceipt(el, "headerSubtitle-es-ES", "  Bar  ");
  expect(receiptSave(el).disabled).toBe(true);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await editReceipt(el, "headerSubtitle-es-ES", "  New Bar  ");
  await editReceipt(el, "footerMessage-ca-ES", "   ");
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt).toEqual({
    operationDescription: "Dining service",
    headerSubtitle: { "es-ES": "New Bar", "eu-ES": "  Hidden  " },
  });
});
it("a live receipt response delivered after Cancel begins cannot reopen the closing dialog", async () => {
  const api = receiptApi();
  const held = deferred<typeof receiptModel>();
  const { el, dialog } = await mountReceiptDialog(api);
  api.getDepartmentReceipt.mockImplementationOnce(() => held.promise);
  api.liveData.invalidate([{ type: "department_receipts" }]);
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  const closed = dialogClosed(dialog);
  expect(await dialog.requestClose("cancel")).toBe(true);
  expect(dialog.open).toBe(false);
  held.resolve(structuredClone(receiptModel));
  await held.promise;
  await el.updateComplete;
  await expect.poll(() => el.shadowRoot!.querySelector("[name=email]")).toBeNull();
  await closed;
  expect(dialog.open).toBe(false);
  expect(el.shadowRoot!.querySelector("[name=email]")).toBeNull();
});

it.each(["success", "refusal"] as const)(
  "a native receipt trading-name choice stays authored through %s at its new owner",
  async (outcome) => {
    const api = receiptApi();
    if (outcome === "refusal") api.putDepartmentReceipt.mockRejectedValue(new Error("offline"));
    const { el, dialog } = await mountReceiptDialog(api);
    const toggle =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>("[name=printTradingName]")!;
    await toggle.updateComplete;
    const native = toggle.shadowRoot!.querySelector<HTMLInputElement>("input")!;
    expect(native.checked).toBe(true);
    await userEvent.click(page.elementLocator(toggle.shadowRoot!.querySelector("label")!));
    await el.updateComplete;
    await clickReceiptSave(el);
    await expect.poll(() => api.putDepartmentReceipt.mock.calls.length).toBe(1);
    expect(api.putDepartmentReceipt.mock.calls).toEqual([
      [
        "bar",
        {
          receipt: {
            operationDescription: "Dining service",
            headerSubtitle: { "es-ES": "Bar", "eu-ES": "Retained" },
          },
          policy: { receiptPrintMode: "auto", printTradingName: false },
        },
      ],
    ]);
    if (outcome === "success") {
      await expect.poll(() => dialog.open).toBe(false);
      el.show({ id: "bar", name: "Bar" });
      await expect.poll(() => dialog.open).toBe(true);
      await expect
        .poll(
          () =>
            el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
              "[name=printTradingName]",
            )!.checked,
        )
        .toBe(false);
    } else {
      await expect
        .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
        .toBe("Something went wrong, try again");
      expect(dialog.open).toBe(true);
      expect(native.checked).toBe(false);
      expect(receiptSave(el).disabled).toBe(false);
    }
    expect(receiptModel.policy.printTradingName).toBe(true);
  },
);

it("a refused receipt print choice returns to its baseline without another write", async () => {
  const api = receiptApi();
  api.putDepartmentReceipt.mockRejectedValue(new Error("offline"));
  const { el } = await mountReceiptDialog(api);
  const toggle =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>("[name=receiptPrintMode]")!;
  await toggle.updateComplete;
  const label = toggle.shadowRoot!.querySelector("label")!;
  const native = toggle.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  expect(native.checked).toBe(true);
  await userEvent.click(page.elementLocator(label));
  await el.updateComplete;
  await clickReceiptSave(el);
  await expect
    .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
    .toBe("Something went wrong, try again");
  expect(native.checked).toBe(false);
  expect(api.putDepartmentReceipt.mock.calls).toHaveLength(1);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].policy.receiptPrintMode).toBe("on_request");
  await userEvent.click(page.elementLocator(label));
  await el.updateComplete;
  expect(native.checked).toBe(true);
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt.mock.calls).toHaveLength(1);
  expect(receiptSave(el).disabled).toBe(true);
  expect(receiptSave(el).variant).toBe("secondary");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
});
