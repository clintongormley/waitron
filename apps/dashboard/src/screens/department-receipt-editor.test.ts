import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import {
  clickReceiptSave,
  deferred,
  editReceipt,
  mountReceiptEditor,
  preview,
  receiptApi,
  receiptField,
  receiptModel,
  receiptSave,
  receiptRoot,
} from "../testing/department-receipt-editor-fixture.js";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
it("opens with required description, bare languages and no inherited content or no-op write", async () => {
  const { el, api } = await mountReceiptEditor();
  expect(receiptField(el, "operationDescription").required).toBe(true);
  expect(
    [...receiptRoot(el).querySelectorAll("h3[lang]")].map((h) => h.textContent!.trim()),
  ).toEqual(["Spanish", "Catalan"]);
  expect(receiptField(el, "headerSubtitle-ca-ES").hint).not.toBe("Bar");
  expect(receiptRoot(el).querySelector("dashboard-image-upload")!.inheritedImage).toBeNull();
  expect(receiptSave(el).disabled).toBe(true);
  expect(receiptSave(el).variant).toBe("secondary");
  receiptSave(el).click();
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});
it("saves exact independent receipt and policy, keeps hidden translations and stays with Save quiet before any refresh", async () => {
  const { el, api, events } = await mountReceiptEditor();
  await editReceipt(el, "email", "bar@example.com");
  expect(receiptSave(el).variant).toBe("primary");
  await clickReceiptSave(el);
  await expect.poll(() => events).toEqual(["department-receipt-saved:bar"]);
  expect(api.putDepartmentReceipt).toHaveBeenCalledExactlyOnceWith("bar", {
    receipt: {
      operationDescription: "Dining service",
      headerSubtitle: { "es-ES": "Bar", "eu-ES": "Retained" },
      email: "bar@example.com",
    },
    policy: { receiptPrintMode: "auto", printTradingName: true },
  });
  expect(api.getDepartmentReceipt).toHaveBeenCalledTimes(1);
  await el.updateComplete;
  expect(receiptSave(el).variant).toBe("secondary");
  expect(receiptSave(el).disabled).toBe(true);
});
it("explains an empty required description and disables Save until repaired", async () => {
  const { el, api } = await mountReceiptEditor();
  await editReceipt(el, "operationDescription", "");
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  expect(receiptField(el, "operationDescription").error).toBe(t("location_settings.required"));
  expect(receiptRoot(el).querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  expect(receiptSave(el).disabled).toBe(true);
  const description = receiptField(el, "operationDescription");
  await expect
    .poll(() => description.shadowRoot!.activeElement)
    .toBe(description.shadowRoot!.querySelector("input"));
  expect(description.value).toBe("");
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  await editReceipt(el, "operationDescription", "Counter service");
  expect(description.error).toBe("");
  expect(receiptRoot(el).querySelector("wt-form-actions")!.error).toBe("");
  expect(receiptSave(el).disabled).toBe(false);
  await editReceipt(el, "operationDescription", " ");
  expect(description.error).toBe(t("location_settings.required"));
  expect(receiptSave(el).disabled).toBe(true);
});

it("uses the server's installed contribution metadata to hide the description and save decoration", async () => {
  const { el, api } = await mountReceiptEditor(
    receiptApi({
      ...receiptModel,
      receipt: {},
      operationDescriptionRequired: false,
    }),
  );
  expect(receiptRoot(el).querySelector("[name=operationDescription]")).toBeNull();
  await editReceipt(el, "email", "bar@example.com");
  await clickReceiptSave(el);
  await expect.poll(() => api.putDepartmentReceipt.mock.calls.length).toBe(1);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt).toEqual({ email: "bar@example.com" });
});
it("allows installations without a description field to save their empty receipt", async () => {
  const { el, api } = await mountReceiptEditor(receiptApi({ ...receiptModel, receipt: {} }));
  el.requiresDescription = false;
  await el.updateComplete;
  expect(receiptRoot(el).querySelector("[name=operationDescription]")).toBeNull();
  await editReceipt(el, "email", "bar@example.com");
  await clickReceiptSave(el);
  await expect.poll(() => api.putDepartmentReceipt.mock.calls.length).toBe(1);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt).toEqual({ email: "bar@example.com" });
});
it.each(["a".repeat(501), "Sale\u0001service"])(
  "refuses an invalid authored description without writing (%j)",
  async (value) => {
    const { el, api } = await mountReceiptEditor();
    await editReceipt(el, "operationDescription", value);
    await clickReceiptSave(el);
    expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
    expect(receiptField(el, "operationDescription").error).toBe(t("location_settings.invalid"));
    expect(receiptSave(el).disabled).toBe(true);
  },
);
it("permits a 500-character description and validates the telephone before writing", async () => {
  const { el, api } = await mountReceiptEditor();
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
  const { el, api } = await mountReceiptEditor();
  el.canManagePolicy = false;
  await el.updateComplete;
  const toggle =
    receiptRoot(el).querySelector<HTMLElementTagNameMap["wt-switch"]>("[name=printTradingName]")!;
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
  const { el } = await mountReceiptEditor(api);
  await editReceipt(el, "headerSubtitle-ca-ES", "Cafè");
  await clickReceiptSave(el);
  await expect
    .poll(() => receiptField(el, "headerSubtitle-ca-ES").error)
    .toBe(t("receipts.trim_too_long").replace("{max}", "80"));
  expect(receiptRoot(el).querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  expect(receiptSave(el).disabled).toBe(false);
});
it("stale preview success and failure cannot replace the latest draft's paper", async () => {
  const api = receiptApi();
  const first = deferred<ReturnType<typeof preview>>();
  api.previewReceiptDraft.mockImplementationOnce(() => first.promise);
  const { el } = await mountReceiptEditor(api);
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(1);
  api.previewReceiptDraft.mockResolvedValue(preview("LATEST"));
  await editReceipt(el, "email", "new@example.com");
  first.resolve(preview("STALE"));
  await first.promise;
  await el.updateComplete;
  expect(receiptRoot(el).querySelector(".paper")?.textContent ?? "").not.toContain("STALE");
  await expect.poll(() => receiptRoot(el).querySelector(".paper")?.textContent).toContain("LATEST");
  expect(receiptRoot(el).querySelector(".paper")!.textContent).toContain("LATEST");
  expect(api.previewReceiptDraft.mock.lastCall?.[1]).toEqual({ passive: true });
});
it("live reads preserve a dirty draft and read recovery cannot erase a failed save", async () => {
  const { el, api } = await mountReceiptEditor();
  await editReceipt(el, "email", "draft@example.com");
  api.putDepartmentReceipt.mockRejectedValue({ code: "server.internal" });
  await clickReceiptSave(el);
  await expect.poll(() => receiptRoot(el).querySelector("wt-form-actions")!.error).not.toBe("");
  api.getDepartmentReceipt.mockResolvedValue({
    ...receiptModel,
    receipt: { operationDescription: "New", email: "remote@example.com" },
  });
  api.liveData.invalidate([{ type: "department_receipts" }]);
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(receiptField(el, "email").value).toBe("draft@example.com");
  expect(receiptRoot(el).querySelector("wt-form-actions")!.error).not.toBe("");
});
it("shows missing translations in the offered languages and clears the warning as the draft is filled", async () => {
  const { el } = await mountReceiptEditor();
  expect(receiptRoot(el).querySelector("[data-test=translation-warning]")?.textContent).toBe(
    t("receipts.translation_warning"),
  );
  await editReceipt(el, "headerSubtitle-ca-ES", "Bar català");
  expect(receiptRoot(el).querySelector("[data-test=translation-warning]")).toBeNull();
});
it.each(["printTradingName", "receiptPrintMode"] as const)(
  "a %s policy refusal is visible beside its switch as well as in the bottom summary",
  async (field) => {
    const api = receiptApi();
    api.putDepartmentReceipt.mockRejectedValue({
      code: "management.request_invalid",
      params: { field },
    });
    const { el } = await mountReceiptEditor(api);
    const toggle = receiptRoot(el).querySelector<HTMLElementTagNameMap["wt-switch"]>(
      `[name=${field}]`,
    )!;
    await toggle.updateComplete;
    await userEvent.click(page.elementLocator(toggle.shadowRoot!.querySelector("label")!));
    await clickReceiptSave(el);
    await expect
      .poll(() => receiptRoot(el).querySelector(`[data-field-error=${field}]`)?.textContent)
      .toBeTruthy();
    expect(receiptRoot(el).querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
    expect(receiptSave(el).disabled).toBe(false);
  },
);
it("draft address and policy switches affect both preview and the exact submitted receipt", async () => {
  const { el, api } = await mountReceiptEditor();
  for (const name of ["printAddress", "printTradingName", "receiptPrintMode"]) {
    const toggle = receiptRoot(el).querySelector<HTMLElementTagNameMap["wt-switch"]>(
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
  const { el, app } = await mountReceiptEditor();
  const toggle =
    receiptRoot(el).querySelector<HTMLElementTagNameMap["wt-switch"]>("[name=printAddress]")!;
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
  const { el, api, app } = await mountReceiptEditor();
  await expect.poll(() => receiptRoot(el).querySelector("[name=previewWidth]")).toBeTruthy();
  await chooseOption(
    receiptRoot(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=previewWidth]")!,
    "58mm",
  );
  await expect
    .poll(() => api.previewReceiptDraft.mock.lastCall?.[0])
    .toMatchObject({ paperWidth: "58mm" });
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("a deleted department's live read closes its editor and releases the draft", async () => {
  const { el, api, app, events } = await mountReceiptEditor();
  await editReceipt(el, "email", "draft@example.com");
  api.getDepartmentReceipt.mockRejectedValue({ code: "department.not_found" });
  api.liveData.invalidate([{ type: "departments" }]);
  await expect.poll(() => events).toEqual(["department-receipt-closed:bar"]);
  expect(receiptRoot(el).querySelector("[name=email]")).toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
it("a stale preview refusal cannot show an error after the current paper arrives", async () => {
  const api = receiptApi();
  const old = deferred<ReturnType<typeof preview>>();
  api.previewReceiptDraft.mockImplementationOnce(() => old.promise);
  const { el } = await mountReceiptEditor(api);
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBe(1);
  api.previewReceiptDraft.mockResolvedValue(preview("CURRENT"));
  await editReceipt(el, "email", "new@example.com");
  old.reject({ code: "server.internal" });
  await old.promise.catch(() => {});
  await el.updateComplete;
  await expect
    .poll(() => receiptRoot(el).querySelector(".paper")?.textContent)
    .toContain("CURRENT");
  expect(receiptRoot(el).querySelector(".preview [role=alert]")).toBeNull();
});
it.each(["success", "refusal"])("a departed %s cannot mark a reopened editor", async (outcome) => {
  const api = receiptApi();
  const held = deferred<void>();
  api.putDepartmentReceipt.mockImplementationOnce(() => held.promise);
  const { el } = await mountReceiptEditor(api);
  await editReceipt(el, "email", "sent@example.com");
  await clickReceiptSave(el);
  el.subject = undefined;
  await el.updateComplete;
  el.subject = { id: "cafe", name: "Cafe" };
  await expect.poll(() => receiptRoot(el).querySelector("[name=email]")).toBeTruthy();
  await editReceipt(el, "email", "later@example.com");
  if (outcome === "success") held.resolve();
  else held.reject({ code: "server.internal" });
  await held.promise.catch(() => {});
  await el.updateComplete;
  expect(receiptField(el, "email").value).toBe("later@example.com");
  expect(receiptSave(el).disabled).toBe(false);
  expect(receiptRoot(el).querySelector("wt-form-actions")!.error).toBe("");
});

it("opens a host-selected subject once", async () => {
  const { el, api } = await mountReceiptEditor();
  el.subject = { id: "terrace", name: "Terrace" };
  await el.updateComplete;
  await expect.poll(() => api.getDepartmentReceipt.mock.lastCall?.[0]).toBe("terrace");
  el.subject = { id: "terrace", name: "New name" };
  await el.updateComplete;
  expect(api.getDepartmentReceipt).toHaveBeenCalledTimes(2);
});

it("refreshes the selected subject name without replacing its dirty receipt or rereading", async () => {
  const { el, api } = await mountReceiptEditor();
  await editReceipt(el, "email", "draft@example.com");
  el.subject = { id: "bar", name: "Renamed counter" };
  await el.updateComplete;
  expect(receiptField(el, "email").value).toBe("draft@example.com");
  expect(api.getDepartmentReceipt).toHaveBeenCalledTimes(1);
});
it("a cleared then re-set subject loads afresh", async () => {
  const { el, api } = await mountReceiptEditor();
  await editReceipt(el, "email", "draft@example.com");
  el.subject = undefined;
  await el.updateComplete;
  el.subject = { id: "bar", name: "Bar" };
  await el.updateComplete;
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  await expect.poll(() => receiptRoot(el).querySelector("[name=email]")).toBeTruthy();
  expect(receiptField(el, "email").value).toBe("");
});
it("a selected department removed during its live read returns its identity to the host once", async () => {
  const { el, api } = await mountReceiptEditor();
  const returned: string[] = [];
  el.addEventListener("department-receipt-closed", (event) =>
    returned.push((event as CustomEvent).detail.departmentId),
  );
  api.getDepartmentReceipt.mockRejectedValue({ code: "department.not_found", status: 404 });
  api.liveData.invalidate([{ type: "departments" }]);
  await expect.poll(() => returned).toEqual(["bar"]);
  el.subject = undefined;
  await el.updateComplete;
  expect(returned).toEqual(["bar"]);
});

it("a replacement subject loads the new department and shows its values in place of a dirty draft", async () => {
  const { el, api, app } = await mountReceiptEditor();
  await editReceipt(el, "email", "draft@example.com");
  api.getDepartmentReceipt.mockImplementation(async (id: string) =>
    id === "terrace"
      ? { ...receiptModel, receipt: { operationDescription: "Terrace service" } }
      : structuredClone(receiptModel),
  );
  el.subject = { id: "terrace", name: "Terrace" };
  await el.updateComplete;
  await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
  expect(api.getDepartmentReceipt.mock.lastCall?.[0]).toBe("terrace");
  await expect.poll(() => receiptField(el, "operationDescription")?.value).toBe("Terrace service");
  expect(receiptField(el, "email").value).toBe("");
  expect(receiptSave(el).disabled).toBe(true);
  expect(app.leave.coordinator.isDirty()).toBe(false);
});

it("compares and sends trimmed offered text while preserving hidden authored values exactly", async () => {
  const api = receiptApi({
    ...receiptModel,
    receipt: { ...receiptModel.receipt, headerSubtitle: { "es-ES": "Bar", "eu-ES": "  Hidden  " } },
  });
  const { el, app } = await mountReceiptEditor(api);
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
it.each(["success", "refusal"] as const)(
  "a native receipt trading-name choice stays authored through %s at its new owner",
  async (outcome) => {
    const api = receiptApi();
    if (outcome === "refusal") api.putDepartmentReceipt.mockRejectedValue(new Error("offline"));
    const { el, events } = await mountReceiptEditor(api);
    const toggle =
      receiptRoot(el).querySelector<HTMLElementTagNameMap["wt-switch"]>("[name=printTradingName]")!;
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
      await expect.poll(() => events).toEqual(["department-receipt-saved:bar"]);
      el.subject = undefined;
      await el.updateComplete;
      el.subject = { id: "bar", name: "Bar" };
      await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
      await expect
        .poll(() => receiptRoot(el).querySelector("[name=printTradingName]"))
        .toBeTruthy();
      await expect
        .poll(
          () =>
            receiptRoot(el).querySelector<HTMLElementTagNameMap["wt-switch"]>(
              "[name=printTradingName]",
            )!.checked,
        )
        .toBe(false);
    } else {
      await expect
        .poll(() => receiptRoot(el).querySelector("wt-form-actions")!.error)
        .toBe("Something went wrong, try again");
      expect(native.checked).toBe(false);
      expect(receiptSave(el).disabled).toBe(false);
    }
    expect(receiptModel.policy.printTradingName).toBe(true);
  },
);

it("a refused receipt print choice returns to its baseline without another write", async () => {
  const api = receiptApi();
  api.putDepartmentReceipt.mockRejectedValue(new Error("offline"));
  const { el } = await mountReceiptEditor(api);
  const toggle =
    receiptRoot(el).querySelector<HTMLElementTagNameMap["wt-switch"]>("[name=receiptPrintMode]")!;
  await toggle.updateComplete;
  const label = toggle.shadowRoot!.querySelector("label")!;
  const native = toggle.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  expect(native.checked).toBe(true);
  await userEvent.click(page.elementLocator(label));
  await el.updateComplete;
  await clickReceiptSave(el);
  await expect
    .poll(() => receiptRoot(el).querySelector("wt-form-actions")!.error)
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
  expect(receiptRoot(el).querySelector("wt-form-actions")!.error).toBe("");
});

it("after Save the editor stays, shows the saved values with Save quiet, and reports saved", async () => {
  const { el, api, events } = await mountReceiptEditor();
  await editReceipt(el, "phone", " +34 600 000 000 ");
  expect(receiptSave(el).variant).toBe("primary");
  await clickReceiptSave(el);
  await expect.poll(() => events).toEqual(["department-receipt-saved:bar"]);
  expect(api.putDepartmentReceipt).toHaveBeenCalledExactlyOnceWith(
    "bar",
    expect.objectContaining({
      receipt: expect.objectContaining({ phone: "+34 600 000 000" }),
    }),
  );
  await el.updateComplete;
  expect(el.isConnected).toBe(true);
  expect(receiptField(el, "phone").value).toBe("+34 600 000 000");
  expect(receiptSave(el).variant).toBe("secondary");
  expect(receiptSave(el).disabled).toBe(true);
  expect(el.saving).toBe(false);
  expect(el.hasUnsavedChanges).toBe(false);
  expect(receiptRoot(el).querySelector("wt-form-actions")!.getAttribute("slot")).toBeNull();
});

it("Cancel reports cancel and changes nothing", async () => {
  const { el, api, events } = await mountReceiptEditor();
  await editReceipt(el, "email", "bar@example.com");
  await userEvent.click(
    page.elementLocator(receiptRoot(el).querySelector("[data-test=cancel-receipt]")!),
  );
  expect(events).toEqual(["department-receipt-cancel:bar"]);
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  expect(el.isConnected).toBe(true);
  expect(receiptField(el, "email").value).toBe("bar@example.com");
  expect(el.hasUnsavedChanges).toBe(true);
});

it("leaveScope is dirty after an edit and clean after Save", async () => {
  const { app, el } = await mountReceiptEditor();
  const scope = el.leaveScope;
  expect(scope).toBeDefined();
  expect(el.hasUnsavedChanges).toBe(false);
  expect(app.leave.coordinator.isDirty([scope!])).toBe(false);
  await editReceipt(el, "phone", "+34 600 000 000");
  expect(el.hasUnsavedChanges).toBe(true);
  expect(app.leave.coordinator.isDirty([scope!])).toBe(true);
  await clickReceiptSave(el);
  await expect.poll(() => el.hasUnsavedChanges).toBe(false);
  expect(el.leaveScope).toBe(scope);
  expect(app.leave.coordinator.isDirty([scope!])).toBe(false);
});
