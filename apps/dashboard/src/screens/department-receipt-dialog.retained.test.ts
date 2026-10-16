import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@waitron/dashboard-modules";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import {
  deferred,
  clickReceiptSave,
  editReceipt,
  mountReceiptDialog,
  receiptApi,
  receiptField,
  receiptModel,
  receiptSave,
} from "../testing/department-receipt-dialog-fixture.js";

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
const LOGO = `${"a".repeat(64)}.png`;
it("clears one authored map entry without losing other visible or hidden translations", async () => {
  const api = receiptApi({
    ...receiptModel,
    receipt: {
      ...receiptModel.receipt,
      footerMessage: { "es-ES": "Thanks", "ca-ES": "Gràcies", "eu-ES": "Agur" },
    },
  });
  const { el } = await mountReceiptDialog(api);
  await editReceipt(el, "footerMessage-ca-ES", "");
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt).toEqual({
    ...receiptModel.receipt,
    footerMessage: { "es-ES": "Thanks", "ca-ES": "", "eu-ES": "Agur" },
  });
});
it("typing then clearing an absent translation returns to a clean draft", async () => {
  const { el, app, api } = await mountReceiptDialog();
  await editReceipt(el, "footerMessage-ca-ES", "New");
  expect(receiptSave(el).disabled).toBe(false);
  await editReceipt(el, "footerMessage-ca-ES", "");
  expect(receiptSave(el).disabled).toBe(true);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  receiptSave(el).click();
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});
it("trims contacts on save and omits blank contact keys", async () => {
  const { el, api } = await mountReceiptDialog(
    receiptApi({
      ...receiptModel,
      receipt: { ...receiptModel.receipt, phone: "910000000", email: "old@example.com" },
    }),
  );
  await editReceipt(el, "phone", "  +34 912 345 678  ");
  await editReceipt(el, "email", "   ");
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt).toEqual({
    ...receiptModel.receipt,
    phone: "+34 912 345 678",
  });
});
it("marks both invalid contacts and enables Save only after both are repaired", async () => {
  const { el, api } = await mountReceiptDialog();
  await editReceipt(el, "phone", "not yet");
  await editReceipt(el, "email", "a@");
  await clickReceiptSave(el);
  expect(receiptField(el, "phone").error).toBe(t("receipts.invalid_phone"));
  expect(receiptField(el, "email").error).toBe(t("receipts.invalid_email"));
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  expect(receiptSave(el).disabled).toBe(true);
  await editReceipt(el, "phone", "910000000");
  expect(receiptSave(el).disabled).toBe(true);
  await editReceipt(el, "email", "bar@example.com");
  expect(receiptSave(el).disabled).toBe(false);
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});
it.each([
  { field: "phone", at: `123${" ".repeat(24)}456`, over: `123${" ".repeat(25)}456`, max: 30 },
  { field: "email", at: "a".repeat(248) + "@b.com", over: "a".repeat(249) + "@b.com", max: 254 },
] as const)("holds $field to its exact trimmed save bound", async ({ field, at, over, max }) => {
  const { el, api } = await mountReceiptDialog();
  await editReceipt(el, field, " " + over + " ");
  await clickReceiptSave(el);
  expect(receiptField(el, field).error).toBe(
    t("receipts.trim_too_long").replace("{max}", String(max)),
  );
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  await editReceipt(el, field, " " + at + " ");
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt[field]).toBe(at);
});
it("choosing and clearing a previously absent logo restores a clean draft without inheritance", async () => {
  const { el, api, app } = await mountReceiptDialog();
  const upload = el.shadowRoot!.querySelector("dashboard-image-upload")!;
  upload.dispatchEvent(
    new CustomEvent("image-changed", { detail: { image: LOGO }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(upload.image).toBe(LOGO);
  expect(receiptSave(el).disabled).toBe(false);
  await upload.updateComplete;
  await userEvent.click(
    page.elementLocator(upload.shadowRoot!.querySelector("[data-test=remove-image]")!),
  );
  await el.updateComplete;
  expect(upload.image).toBeNull();
  expect(upload.inheritedImage).toBeNull();
  expect(receiptSave(el).disabled).toBe(true);
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});
it("clearing a saved logo previews and saves no logo", async () => {
  const { el, api } = await mountReceiptDialog(
    receiptApi({ ...receiptModel, receipt: { ...receiptModel.receipt, logo: LOGO } }),
  );
  const upload = el.shadowRoot!.querySelector("dashboard-image-upload")!;
  await upload.updateComplete;
  await userEvent.click(
    page.elementLocator(upload.shadowRoot!.querySelector("[data-test=remove-image]")!),
  );
  await expect
    .poll(() => api.previewReceiptDraft.mock.lastCall?.[0].receipt)
    .toEqual(receiptModel.receipt);
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt).toEqual(receiptModel.receipt);
});
it("a last-language footer refusal focuses its textarea and survives edits to another field", async () => {
  const api = receiptApi();
  api.putDepartmentReceipt.mockRejectedValue({
    code: "receipt.invalid",
    params: { field: "footerMessage", language: "ca-ES", maxLength: 300 },
  });
  const { el, dialog } = await mountReceiptDialog(api);
  await editReceipt(el, "footerMessage-ca-ES", "Draft");
  await clickReceiptSave(el);
  const refused = receiptField(el, "footerMessage-ca-ES");
  await expect.poll(() => refused.error).toBe(t("receipts.trim_too_long").replace("{max}", "300"));
  expect(refused.shadowRoot!.activeElement).toBe(refused.shadowRoot!.querySelector("textarea"));
  expect(dialog.shadowRoot!.querySelector(".body")!.scrollTop).toBeGreaterThan(0);
  await editReceipt(el, "email", "bar@example.com");
  expect(refused.error).not.toBe("");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  await editReceipt(el, "footerMessage-ca-ES", "Fixed");
  expect(refused.error).toBe("");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
  expect(receiptSave(el).disabled).toBe(false);
});
it("an unknown refused language is summarized without marking fields or creating hostile markup", async () => {
  const api = receiptApi();
  const hostile = '<img src=x onerror="alert(1)">';
  api.putDepartmentReceipt.mockRejectedValue({
    code: "receipt.invalid",
    params: { field: "footerMessage", language: hostile, reason: "invalid_language" },
  });
  const { el } = await mountReceiptDialog(api);
  await editReceipt(el, "footerMessage-ca-ES", "Draft");
  await clickReceiptSave(el);
  await expect
    .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
    .toBe(codeMessage("receipt.invalid"));
  for (const name of [
    "footerMessage-ca-ES",
    "footerMessage-es-ES",
    "headerSubtitle-ca-ES",
    "email",
  ])
    expect(receiptField(el, name).error).toBe("");
  expect(el.shadowRoot!.querySelector("img")).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain(hostile);
  expect(receiptSave(el).disabled).toBe(false);
});
it("a refused address switch is explained beside it and clears when the switch is fixed", async () => {
  const api = receiptApi();
  api.putDepartmentReceipt.mockRejectedValue({
    code: "receipt.invalid",
    params: { field: "printAddress", reason: "not_boolean" },
  });
  const { el } = await mountReceiptDialog(api);
  await editReceipt(el, "email", "bar@example.com");
  await clickReceiptSave(el);
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-field-error=printAddress]")?.textContent)
    .toBe(codeMessage("receipt.invalid"));
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
  const toggle = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
    "wt-switch[name=printAddress]",
  )!;
  await toggle.updateComplete;
  await userEvent.click(page.elementLocator(toggle.shadowRoot!.querySelector("label")!));
  expect(el.shadowRoot!.querySelector("[data-field-error=printAddress]")).toBeNull();
  expect(receiptSave(el).disabled).toBe(false);
});
it("a failed initial read offers native Retry and uses the localized fallback for an uncoded rejection", async () => {
  const api = receiptApi();
  api.getDepartmentReceipt.mockRejectedValueOnce(new Error("internal details"));
  const { el, host: app } = await mountWidget<
    HTMLElementTagNameMap["dashboard-department-receipt-dialog"]
  >("dashboard-department-receipt-dialog", { api, subject: { id: "bar", name: "Bar" } });
  await expect
    .poll(() => el.shadowRoot!.querySelector(".error[role=alert]")?.textContent)
    .toBe(codeMessage("server.internal_error"));
  expect(app.textContent).not.toContain("internal details");
  await userEvent.click(page.elementLocator(el.shadowRoot!.querySelector("wt-button")!));
  await expect.poll(() => el.shadowRoot!.querySelector("[name=email]")).toBeTruthy();
  expect(receiptField(el, "operationDescription").value).toBe("Dining service");
});
it("Enter on an unchanged receipt sends nothing and Enter on an edited description saves exactly once", async () => {
  const { el, api, dialog } = await mountReceiptDialog();
  const description = receiptField(el, "operationDescription");
  await description.updateComplete;
  const input = description.shadowRoot!.querySelector("input");
  expect(input).toBeInstanceOf(HTMLInputElement);
  await userEvent.click(page.elementLocator(input!));
  await userEvent.keyboard("{Enter}");
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  await editReceipt(el, "operationDescription", "Counter service");
  const closed = dialogClosed(dialog);
  await userEvent.click(page.elementLocator(input!));
  await userEvent.keyboard("{Enter}");
  await closed;
  expect(api.putDepartmentReceipt).toHaveBeenCalledTimes(1);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt.operationDescription).toBe(
    "Counter service",
  );
});
it("an unassigned save refusal stays visible when another authored field changes", async () => {
  const api = receiptApi();
  api.putDepartmentReceipt.mockRejectedValue({ code: "management.failed" });
  const { el } = await mountReceiptDialog(api);
  await editReceipt(el, "email", "bar@example.com");
  await clickReceiptSave(el);
  await expect
    .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
    .toBe(codeMessage("management.failed"));
  await editReceipt(el, "phone", "910000000");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
    codeMessage("management.failed"),
  );
  expect(receiptSave(el).disabled).toBe(false);
});

it.each([
  {
    error: { code: "receipt.invalid", params: { field: "logo", reason: "image_not_found" } },
    key: "receipts.logo_not_found",
  },
  {
    error: { code: "receipt.invalid", params: { field: "logo", reason: "invalid_logo" } },
    key: "receipts.invalid_logo",
  },
  { error: { code: "image.invalid_file", params: {} }, key: "image.invalid_file" },
])(
  "places $key beside the logo and clears only that refusal when the image changes",
  async ({ error, key }) => {
    const api = receiptApi();
    api.putDepartmentReceipt.mockRejectedValue(error);
    const { el } = await mountReceiptDialog(api);
    const upload = el.shadowRoot!.querySelector("dashboard-image-upload")!;
    upload.dispatchEvent(
      new CustomEvent("image-changed", { detail: { image: LOGO }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    await clickReceiptSave(el);
    const sentence =
      key === "image.invalid_file"
        ? codeMessage(key)
        : t(key as "receipts.logo_not_found" | "receipts.invalid_logo");
    await expect
      .poll(() =>
        upload.nextElementSibling?.matches("p.error")
          ? upload.nextElementSibling.textContent
          : undefined,
      )
      .toBe(sentence);
    expect(upload.invalid).toBe(true);
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
    expect(receiptSave(el).disabled).toBe(false);
    await editReceipt(el, "email", "bar@example.com");
    expect(
      upload.nextElementSibling?.matches("p.error")
        ? upload.nextElementSibling.textContent
        : undefined,
    ).toBe(sentence);
    upload.dispatchEvent(
      new CustomEvent("image-changed", { detail: { image: null }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(upload.nextElementSibling?.matches("p.error")).toBe(false);
    expect(upload.invalid).toBe(false);
  },
);

it("adopts untouched receipt fields and translations while retaining typed values and their original baseline", async () => {
  const { el, api } = await mountReceiptDialog();
  await editReceipt(el, "headerSubtitle-es-ES", "Typed");
  api.getDepartmentReceipt.mockResolvedValue({
    ...receiptModel,
    receipt: {
      operationDescription: "Remote service",
      phone: "933333333",
      logo: LOGO,
      printAddress: true,
      headerSubtitle: { "es-ES": "Remote subtitle", "ca-ES": "Cafè", "eu-ES": "New hidden" },
      footerMessage: { "ca-ES": "Remote footer" },
    },
  });
  api.liveData.invalidate([{ type: "department_receipts" }]);
  await expect.poll(() => receiptField(el, "phone").value).toBe("933333333");
  expect(receiptField(el, "headerSubtitle-es-ES").value).toBe("Typed");
  expect(receiptField(el, "headerSubtitle-ca-ES").value).toBe("Cafè");
  expect(receiptField(el, "footerMessage-ca-ES").value).toBe("Remote footer");
  expect(el.shadowRoot!.querySelector("dashboard-image-upload")!.image).toBe(LOGO);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>("[name=printAddress]")!
      .checked,
  ).toBe(true);
  await editReceipt(el, "headerSubtitle-es-ES", "Bar");
  expect(receiptSave(el).disabled).toBe(true);
  await editReceipt(el, "headerSubtitle-es-ES", "Typed again");
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1]).toEqual({
    policy: receiptModel.policy,
    receipt: {
      operationDescription: "Remote service",
      phone: "933333333",
      logo: LOGO,
      printAddress: true,
      headerSubtitle: { "es-ES": "Typed again", "ca-ES": "Cafè", "eu-ES": "New hidden" },
      footerMessage: { "ca-ES": "Remote footer" },
    },
  });
});
it("pending Save freezes the saved logo and closes an already open picker", async () => {
  const api = receiptApi({ ...receiptModel, receipt: { ...receiptModel.receipt, logo: LOGO } });
  const pending = deferred<void>();
  api.putDepartmentReceipt.mockImplementation(() => pending.promise);
  const { el } = await mountReceiptDialog(api);
  const upload = el.shadowRoot!.querySelector("dashboard-image-upload")!;
  await editReceipt(el, "email", "bar@example.com");
  await upload.updateComplete;
  await userEvent.click(
    page.elementLocator(upload.shadowRoot!.querySelector("[data-test=choose-image]")!),
  );
  await expect.poll(() => upload.shadowRoot!.querySelector("media-image-picker")).toBeTruthy();
  receiptSave(el).click();
  await expect.poll(() => upload.disabled).toBe(true);
  await upload.updateComplete;
  expect(upload.shadowRoot!.querySelector("media-image-picker")).toBeNull();
  for (const action of ["remove-image", "choose-image"]) {
    const button = upload.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      `[data-test=${action}]`,
    )!;
    expect(button.disabled).toBe(true);
    button.click();
  }
  upload.dispatchEvent(
    new CustomEvent("image-changed", { detail: { image: null }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(upload.image).toBe(LOGO);
  expect(api.putDepartmentReceipt.mock.lastCall?.[1].receipt.logo).toBe(LOGO);
  pending.reject({ code: "management.failed" });
  await expect.poll(() => upload.disabled).toBe(false);
  expect(upload.image).toBe(LOGO);
});
it("shows no copy of the address and previews its live replacement without changing authored receipt fields", async () => {
  const { el, api } = await mountReceiptDialog();
  expect(el.shadowRoot!.textContent).not.toContain("Calle Mayor 1");
  await editReceipt(el, "email", "bar@example.com");
  const before = api.previewReceiptDraft.mock.calls.length;
  api.getDepartmentReceipt.mockResolvedValue({
    ...receiptModel,
    venueAddress: ["Plaza Nueva 2", "41001 Sevilla"],
  });
  api.liveData.invalidate([{ type: "locations" }]);
  await expect.poll(() => api.previewReceiptDraft.mock.calls.length).toBeGreaterThan(before);
  expect(el.shadowRoot!.textContent).not.toContain("Plaza Nueva 2");
  expect(receiptField(el, "email").value).toBe("bar@example.com");
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});

it("marks exactly the offered languages missing authored translations, including the receipt language", async () => {
  const { el } = await mountReceiptDialog(
    receiptApi({
      ...receiptModel,
      languages: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
      receipt: { operationDescription: "Dining service" },
    }),
  );
  const missing = () =>
    [...el.shadowRoot!.querySelectorAll("h3")]
      .filter((heading) => heading.parentElement!.querySelector("[aria-label]"))
      .map((heading) => heading.lang);
  expect(missing()).toEqual([]);
  expect(el.shadowRoot!.querySelector("[data-test=translation-warning]")).toBeNull();
  await editReceipt(el, "footerMessage-eu-ES", "Eskerrik asko");
  expect(missing()).toEqual(["es-ES", "ca-ES", "gl-ES"]);
  expect(
    el.shadowRoot!.querySelector("[data-test=translation-warning]")!.getAttribute("role"),
  ).toBe("note");
  for (const language of ["es-ES", "ca-ES", "gl-ES", "eu-ES"])
    for (const field of ["headerSubtitle", "footerMessage"])
      expect(receiptField(el, `${field}-${language}`).name).toBe(`${field}-${language}`);
  await editReceipt(el, "footerMessage-eu-ES", "   ");
  expect(missing()).toEqual([]);
  await editReceipt(el, "headerSubtitle-ca-ES", "Cafè");
  expect(missing()).toEqual(["es-ES", "gl-ES", "eu-ES"]);
});

it("the real logo library keeps an upload refusal visible without changing the receipt", async () => {
  const api = receiptApi();
  api.imageLibraryRequest = (async <T>(_path: string, method: string) => {
    if (method === "POST") throw { code: "image.too_large", params: {}, status: 413 };
    return { images: [], total: 0 } as T;
  }) as typeof api.imageLibraryRequest;
  const { el } = await mountReceiptDialog(api);
  const upload = el.shadowRoot!.querySelector("dashboard-image-upload")!;
  await upload.updateComplete;
  await userEvent.click(
    page.elementLocator(upload.shadowRoot!.querySelector("[data-test=choose-image]")!),
  );
  const library = await expect
    .poll(() =>
      upload
        .shadowRoot!.querySelector("media-image-picker")
        ?.shadowRoot?.querySelector("dashboard-image-library"),
    )
    .toBeTruthy()
    .then(() =>
      upload
        .shadowRoot!.querySelector("media-image-picker")!
        .shadowRoot!.querySelector("dashboard-image-library")!,
    );
  const root = library.shadowRoot!;
  await expect.poll(() => root.querySelector("[data-test=upload]")).toBeTruthy();
  await userEvent.click(page.elementLocator(root.querySelector("[data-test=upload]")!));
  await expect.poll(() => root.querySelector("input[name=image-file]")).toBeTruthy();
  const transfer = new DataTransfer();
  transfer.items.add(new File(["big"], "logo.png", { type: "image/png" }));
  const file = root.querySelector<HTMLInputElement>("input[name=image-file]")!;
  file.files = transfer.files;
  file.dispatchEvent(new Event("change"));
  root
    .querySelector("[name=name-es]")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Logo" }, bubbles: true, composed: true }),
    );
  await library.updateComplete;
  await userEvent.click(page.elementLocator(root.querySelector("wt-modal [data-test=save]")!));
  await expect
    .poll(() => root.querySelector("#file-error")?.textContent?.trim())
    .toBe(codeMessage("image.too_large"));
  expect(upload.image).toBeNull();
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});

it("keeps a request failure beside the local correction summary when the draft becomes invalid", async () => {
  const api = receiptApi();
  api.putDepartmentReceipt.mockRejectedValue({ code: "management.failed" });
  const { el } = await mountReceiptDialog(api);
  await editReceipt(el, "email", "bar@example.com");
  await clickReceiptSave(el);
  await expect
    .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
    .toBe(codeMessage("management.failed"));
  await editReceipt(el, "operationDescription", "");
  expect(receiptField(el, "operationDescription").error).toBe(t("location_settings.required"));
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
    `${t("form.fix_fields")} ${codeMessage("management.failed")}`,
  );
  expect(receiptSave(el).disabled).toBe(true);
  await editReceipt(el, "operationDescription", "Repaired");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
    codeMessage("management.failed"),
  );
  expect(receiptSave(el).disabled).toBe(false);
});

it("an uncoded save refusal uses the localized fallback and leaves the exact draft available to retry", async () => {
  const api = receiptApi();
  api.putDepartmentReceipt.mockRejectedValueOnce(new Error("private internal detail"));
  const { el } = await mountReceiptDialog(api);
  await editReceipt(el, "email", "bar@example.com");
  await clickReceiptSave(el);
  await expect
    .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
    .toBe(codeMessage("server.internal_error"));
  expect(el.shadowRoot!.textContent).not.toContain("private internal detail");
  expect(receiptField(el, "email").error).toBe("");
  expect(receiptField(el, "email").value).toBe("bar@example.com");
  expect(receiptSave(el).disabled).toBe(false);
  await clickReceiptSave(el);
  expect(api.putDepartmentReceipt.mock.calls).toEqual([
    [
      "bar",
      {
        receipt: { ...receiptModel.receipt, email: "bar@example.com" },
        policy: receiptModel.policy,
      },
    ],
    [
      "bar",
      {
        receipt: { ...receiptModel.receipt, email: "bar@example.com" },
        policy: receiptModel.policy,
      },
    ],
  ]);
});
it.each(["phone", "email", "operationDescription", "headerSubtitle-es-ES", "footerMessage-ca-ES"])(
  "contains the native %s field change event",
  async (name) => {
    const { el } = await mountReceiptDialog();
    const leaked = vi.fn();
    el.addEventListener("wt-change", leaked);
    await editReceipt(el, name, "Updated");
    expect(receiptField(el, name).value).toBe("Updated");
    expect(leaked).not.toHaveBeenCalled();
  },
);

it.each(["en-GB", "es-ES"] as const)(
  "shows no address line and words an absent address in %s",
  async (locale) => {
    setLocale(locale);
    const { el, api } = await mountReceiptDialog(
      receiptApi({ ...receiptModel, venueAddress: ["Calle Mayor 1", "28013 Madrid"] }),
    );
    expect(el.shadowRoot!.querySelector("[data-test=venue-address]")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain("Calle Mayor 1");
    expect(el.shadowRoot!.textContent).not.toContain("28013 Madrid");
    api.getDepartmentReceipt.mockResolvedValue({ ...receiptModel, venueAddress: [] });
    api.liveData.invalidate([{ type: "locations" }]);
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=venue-address]")?.textContent?.trim())
      .toBe(t("receipts.no_address"));
  },
);

it("focuses a server-refused description and keeps its refusal until that field changes", async () => {
  const { el, api } = await mountReceiptDialog();
  api.putDepartmentReceipt.mockRejectedValue({
    code: "management.request_invalid",
    params: { field: "operationDescription" },
  });
  await editReceipt(el, "operationDescription", "Rejected service");
  await clickReceiptSave(el);
  const description = receiptField(el, "operationDescription");
  await expect.poll(() => description.error).toBe(t("location_settings.invalid"));
  await expect
    .poll(() => description.shadowRoot!.activeElement)
    .toBe(description.shadowRoot!.querySelector("input"));
  expect(description.value).toBe("Rejected service");
  expect(receiptSave(el).disabled).toBe(false);
  await editReceipt(el, "email", "other@example.test");
  expect(description.error).toBe(t("location_settings.invalid"));
  await editReceipt(el, "operationDescription", "Corrected service");
  expect(description.error).toBe("");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
  expect(api.putDepartmentReceipt).toHaveBeenCalledTimes(1);
});
