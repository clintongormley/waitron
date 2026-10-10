import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { LiveData } from "@waitron/dashboard-kit";
import type { VenueReceiptSettings } from "@waitron/shared";
import type { DashboardApi, ReceiptPreview } from "../api/client.js";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./receipts-screen.js";

type Screen = HTMLElementTagNameMap["dashboard-receipts-screen"];
type Defaults = HTMLElementTagNameMap["dashboard-venue-receipt-defaults-editor"];
const originalUrl = location.href;
function paper(text = "Receipt"): ReceiptPreview {
  return {
    preview: {
      widthDots: 512,
      columns: 42,
      text,
      blocks: [{ kind: "text", text: `${text}\n` }],
      qrData: [],
      omittedGraphics: false,
      truncated: false,
      unsupported: false,
    },
    marks: {
      logo: null,
      headerSubtitle: null,
      footerMessage: null,
      phone: null,
      email: null,
      address: null,
    },
    paperWidth: "80mm",
    paperWidths: ["80mm"],
  };
}
function fixture() {
  let stored: VenueReceiptSettings = {
    headerSubtitle: "Current defaults",
    footerMessage: "Thanks",
    printAddress: false,
  };
  return {
    liveData: new LiveData(),
    getVenueDepartments: vi.fn(async () => [
      { id: "bar", name: "Bar", active: true, isDefault: true },
    ]),
    getDepartmentReceipt: vi.fn(async () => ({
      receipt: {},
      venueDefaults: { headerSubtitle: "Older department query" },
      languages: ["es-ES", "ca-ES"],
      warningLanguages: [],
      venueAddress: ["Calle Mayor 1"],
    })),
    putDepartmentReceipt: vi.fn<DashboardApi["putDepartmentReceipt"]>(async () => {}),
    getReceipt: vi.fn(async () => ({
      receipt: {
        headerSubtitle: "Legacy query",
        phone: "+34 912 345 678",
        email: "venue@example.com",
      },
      venueAddress: ["Calle Mayor 1"],
    })),
    putReceipt: vi.fn(async () => {}),
    getVenueReceiptSettings: vi.fn(async () => ({ settings: structuredClone(stored) })),
    putVenueReceiptSettings: vi.fn<DashboardApi["putVenueReceiptSettings"]>(async (value) => {
      stored = structuredClone(value);
    }),
    getLocationSettings: vi.fn(async () => ({ name: "Venue", operationDescription: "Sales" })),
    putLocationSettings: vi.fn(async () => {}),
    getReceiptLanguage: vi.fn(async () => ({
      language: "es-ES",
      choices: ["es-ES", "ca-ES"],
      fixed: null,
    })),
    putReceiptLanguage: vi.fn(async () => {}),
    getContentLanguages: vi.fn(async () => ({ defaultLanguage: "es", languages: ["es", "ca"] })),
    previewReceiptDraft: vi.fn<DashboardApi["previewReceiptDraft"]>(async (value) =>
      paper(value.settings?.headerSubtitle),
    ),
    imageLibraryRequest: vi.fn(async () => ({ images: [], total: 0 })),
  };
}
function defaults(el: Screen): Defaults {
  return el.shadowRoot!.querySelector<Defaults>("dashboard-venue-receipt-defaults-editor")!;
}
function department(el: Screen) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["dashboard-department-receipt-editor"]>(
    "dashboard-department-receipt-editor",
  )!;
}
async function mount(api = fixture(), theme: "light" | "dark" = "light") {
  history.replaceState(null, "", "/manage/venue-settings/view/receipts?departmentId=bar");
  const { el, host } = await mountWidget<Screen>(
    "dashboard-receipts-screen",
    {
      api: api as unknown as DashboardApi,
    },
    theme,
  );
  await vi.waitFor(() =>
    expect(defaults(el)?.shadowRoot?.querySelector("wt-input[name=headerSubtitle]")).toBeTruthy(),
  );
  return { el, host, api };
}
async function edit(root: Defaults | ReturnType<typeof department>, name: string, value: string) {
  const field = root.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name="${name}"]`,
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await root.updateComplete;
}
function save(root: Defaults | ReturnType<typeof department>, kind: "defaults" | "department") {
  return root.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `[data-test=${kind}-save]`,
  )!;
}
function hint(el: Screen) {
  return department(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "wt-input[name=headerSubtitle-es-ES]",
  )!.hint;
}
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", originalUrl);
  setLocale("en-GB");
});

it("mounts independently queried defaults after the department editor and previews those defaults", async () => {
  const { el, api } = await mount();
  await vi.waitFor(() =>
    expect(api.previewReceiptDraft).toHaveBeenLastCalledWith({
      departmentId: "bar",
      receipt: {},
      settings: {
        headerSubtitle: "Current defaults",
        footerMessage: "Thanks",
        printAddress: false,
      },
    }),
  );
  expect(hint(el)).toBe("Current defaults");
  expect(
    department(el).compareDocumentPosition(defaults(el)) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(defaults(el).shadowRoot!.querySelector("[name=phone], [name=email]")).toBeNull();
});

it("previews an unsaved default and updates inherited hints without making the department dirty", async () => {
  const { el, api } = await mount();
  await vi.waitFor(() => expect(hint(el)).toBe("Current defaults"));
  await edit(defaults(el), "headerSubtitle", "Draft defaults");
  await vi.waitFor(() =>
    expect(api.previewReceiptDraft.mock.lastCall?.[0].settings).toEqual({
      headerSubtitle: "Draft defaults",
      footerMessage: "Thanks",
      printAddress: false,
    }),
  );
  expect(hint(el)).toBe("Draft defaults");
  expect(save(department(el), "department").disabled).toBe(true);
  expect(save(defaults(el), "defaults").disabled).toBe(false);
  expect(api.putVenueReceiptSettings).not.toHaveBeenCalled();
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});

it("saves only defaults while retaining dirty department, language and description controls", async () => {
  const { el, api } = await mount();
  await vi.waitFor(() =>
    expect(department(el)?.shadowRoot?.querySelector("wt-input[name=email]")).toBeTruthy(),
  );
  await edit(department(el), "email", "bar@example.com");
  await edit(defaults(el), "headerSubtitle", "Saved defaults");
  el.shadowRoot!.querySelector("wt-combobox[name=receiptLanguage]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "ca-ES" }, bubbles: true, composed: true }),
  );
  el.shadowRoot!.querySelector("wt-input[name=operationDescription]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Dinner" }, bubbles: true, composed: true }),
  );
  save(defaults(el), "defaults").click();
  await vi.waitFor(() =>
    expect(api.putVenueReceiptSettings).toHaveBeenCalledExactlyOnceWith({
      headerSubtitle: "Saved defaults",
      footerMessage: "Thanks",
      printAddress: false,
    }),
  );
  await vi.waitFor(() => expect(save(defaults(el), "defaults").disabled).toBe(true));
  expect(save(department(el), "department").disabled).toBe(false);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=language-save]")!
      .disabled,
  ).toBe(false);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=description-save]",
    )!.disabled,
  ).toBe(false);
  expect(api.putReceipt).not.toHaveBeenCalled();
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  expect(api.putReceiptLanguage).not.toHaveBeenCalled();
  expect(api.putLocationSettings).not.toHaveBeenCalled();
  await vi.waitFor(() =>
    expect(api.previewReceiptDraft.mock.lastCall?.[0]).toEqual({
      departmentId: "bar",
      receipt: { email: "bar@example.com" },
      settings: { headerSubtitle: "Saved defaults", footerMessage: "Thanks", printAddress: false },
    }),
  );
});

it("refreshes clean default hints without copying them into department overrides", async () => {
  const { el, api } = await mount();
  await vi.waitFor(() => expect(hint(el)).toBe("Current defaults"));
  api.getVenueReceiptSettings.mockResolvedValue({ settings: { headerSubtitle: "Live defaults" } });
  api.liveData.invalidate([{ type: "tenant_receipts" }]);
  await vi.waitFor(() => expect(hint(el)).toBe("Live defaults"));
  expect(save(department(el), "department").disabled).toBe(true);
  expect(save(defaults(el), "defaults").disabled).toBe(true);
  await vi.waitFor(() =>
    expect(api.previewReceiptDraft.mock.lastCall?.[0]).toEqual({
      departmentId: "bar",
      receipt: {},
      settings: { headerSubtitle: "Live defaults" },
    }),
  );
});

it("keeps a typed default in the preview and hints across live refresh", async () => {
  const { el, api } = await mount();
  await edit(defaults(el), "headerSubtitle", "Typed defaults");
  api.getVenueReceiptSettings.mockResolvedValue({
    settings: { headerSubtitle: "Remote defaults" },
  });
  api.liveData.invalidate([{ type: "tenant_receipts" }]);
  await vi.waitFor(() => expect(api.getVenueReceiptSettings).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(api.previewReceiptDraft.mock.lastCall?.[0].settings?.headerSubtitle).toBe(
      "Typed defaults",
    ),
  );
  expect(hint(el)).toBe("Typed defaults");
  expect(save(defaults(el), "defaults").disabled).toBe(false);
});

it("keeps defaults usable after a department load refusal", async () => {
  const api = fixture();
  api.getDepartmentReceipt.mockRejectedValue({ code: "department.not_found" });
  const { el } = await mount(api);
  await edit(defaults(el), "headerSubtitle", "Saved without department");
  save(defaults(el), "defaults").click();
  await vi.waitFor(() => expect(api.putVenueReceiptSettings).toHaveBeenCalledOnce());
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  expect(api.previewReceiptDraft).not.toHaveBeenCalled();
});

it("uses authored defaults in a venue-only preview without sending stored global contact", async () => {
  const api = fixture();
  api.getVenueDepartments.mockResolvedValue([]);
  const { el } = await mount(api);
  await edit(defaults(el), "headerSubtitle", "Venue-only draft");
  await vi.waitFor(() =>
    expect(api.previewReceiptDraft.mock.lastCall?.[0]).toEqual({
      departmentId: null,
      receipt: {},
      settings: {
        headerSubtitle: "Venue-only draft",
        footerMessage: "Thanks",
        printAddress: false,
      },
    }),
  );
  expect(api.getDepartmentReceipt).not.toHaveBeenCalled();
});

it("discards an in-flight preview made with earlier defaults", async () => {
  const { el, api } = await mount();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector(".paper")?.textContent).toContain("Current defaults"),
  );
  let finish!: (value: ReceiptPreview) => void;
  api.previewReceiptDraft.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await edit(defaults(el), "headerSubtitle", "Earlier draft");
  await vi.waitFor(() =>
    expect(api.previewReceiptDraft.mock.lastCall?.[0].settings?.headerSubtitle).toBe(
      "Earlier draft",
    ),
  );
  api.previewReceiptDraft.mockImplementation(async () => {
    throw { code: "server.internal" };
  });
  await edit(defaults(el), "headerSubtitle", "Latest draft");
  finish(paper("Earlier paper"));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=preview-error]")).toBeTruthy(),
  );
  expect(el.shadowRoot!.querySelector(".paper")?.textContent).not.toContain("Earlier paper");
});

for (const failed of ["getReceipt", "getLocationSettings", "getReceiptLanguage"] as const) {
  it(`keeps the independently loaded defaults savable when ${failed} refuses`, async () => {
    const api = fixture();
    api[failed].mockRejectedValue({ code: "server.internal" });
    const { el } = await mount(api);
    await edit(defaults(el), "headerSubtitle", "Independent defaults");
    save(defaults(el), "defaults").click();
    await vi.waitFor(() =>
      expect(api.putVenueReceiptSettings).toHaveBeenCalledExactlyOnceWith({
        headerSubtitle: "Independent defaults",
        footerMessage: "Thanks",
        printAddress: false,
      }),
    );
    expect(api.putReceipt).not.toHaveBeenCalled();
    expect(api.putLocationSettings).not.toHaveBeenCalled();
    expect(api.putReceiptLanguage).not.toHaveBeenCalled();
  });
}

for (const failed of ["getReceipt", "getLocationSettings", "getReceiptLanguage"] as const) {
  it(`previews the independent department draft when ${failed} refuses`, async () => {
    const api = fixture();
    api[failed].mockRejectedValue({ code: "server.internal" });
    api.previewReceiptDraft.mockImplementation(async (value) =>
      paper(`${value.departmentId}: ${value.receipt.email ?? "empty"}`),
    );
    const { el } = await mount(api);
    await vi.waitFor(() =>
      expect(department(el)?.shadowRoot?.querySelector("wt-input[name=email]")).toBeTruthy(),
    );
    await edit(department(el), "email", "preview@bar.example");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector(".paper")?.textContent ?? "").toContain(
        "bar: preview@bar.example",
      ),
    );
    expect(api.previewReceiptDraft).toHaveBeenLastCalledWith(
      {
        departmentId: "bar",
        receipt: { email: "preview@bar.example" },
        settings: {
          headerSubtitle: "Current defaults",
          footerMessage: "Thanks",
          printAddress: false,
        },
      },
      ...(failed === "getReceipt" ? [{ passive: true }] : []),
    );
    expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
    expect(api.putReceipt).not.toHaveBeenCalled();
    expect(api.putVenueReceiptSettings).not.toHaveBeenCalled();
    expect(api.putLocationSettings).not.toHaveBeenCalled();
    expect(api.putReceiptLanguage).not.toHaveBeenCalled();
    if (failed === "getReceiptLanguage")
      expect(el.shadowRoot!.querySelector("wt-combobox[name=previewLanguage]")).toBeNull();
  });
}

for (const locale of ["en-GB", "es-ES"])
  for (const theme of ["light", "dark"] as const)
    it(`keeps mounted defaults and their refusal accessible in ${locale}/${theme}`, async () => {
      setLocale(locale);
      const api = fixture();
      api.putVenueReceiptSettings.mockRejectedValue({
        code: "receipt.invalid",
        params: { field: "headerSubtitle", maxLength: 500 },
      });
      const { el, host } = await mount(api, theme);
      await vi.waitFor(() =>
        expect(department(el)?.shadowRoot?.querySelector("wt-input[name=email]")).toBeTruthy(),
      );
      await expectNoA11yViolations(host);
      await edit(defaults(el), "headerSubtitle", "Refused defaults");
      save(defaults(el), "defaults").click();
      await vi.waitFor(() =>
        expect(
          defaults(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
            "wt-input[name=headerSubtitle]",
          )!.error,
        ).not.toBe(""),
      );
      expect(save(defaults(el), "defaults").disabled).toBe(false);
      await expectNoA11yViolations(host);
    });

for (const [failed, available] of [
  ["getReceipt", "language"],
  ["getReceipt", "description"],
  ["getLocationSettings", "language"],
  ["getReceiptLanguage", "description"],
] as const) {
  it(`keeps ${available} independently savable when ${failed} refuses`, async () => {
    const api = fixture();
    api[failed].mockRejectedValue({ code: "server.internal" });
    const { el, host } = await mount(api);
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy());
    const button = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      `[data-test=${available}-save]`,
    );
    expect(button).not.toBeNull();
    await button!.updateComplete;
    expect(button!.variant).toBe("secondary");
    expect(button!.shadowRoot!.querySelector("button")!.disabled).toBe(true);
    button!.click();
    if (available === "description") {
      const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
        "wt-input[name=operationDescription]",
      )!;
      await field.updateComplete;
      await userEvent.fill(
        page.elementLocator(field.shadowRoot!.querySelector("input")!),
        "Independent sales",
      );
    } else {
      await chooseOption(
        el.shadowRoot!.querySelector("wt-combobox[name=receiptLanguage]")!,
        "ca-ES",
      );
    }
    await el.updateComplete;
    await button!.updateComplete;
    expect(button!.variant).toBe("primary");
    expect(button!.shadowRoot!.querySelector("button")!.disabled).toBe(false);
    await userEvent.click(page.elementLocator(button!.shadowRoot!.querySelector("button")!));
    await vi.waitFor(() =>
      available === "description"
        ? expect(api.putLocationSettings).toHaveBeenCalledExactlyOnceWith("Independent sales")
        : expect(api.putReceiptLanguage).toHaveBeenCalledExactlyOnceWith("ca-ES"),
    );
    expect(api.putReceipt).not.toHaveBeenCalled();
    expect(api.putVenueReceiptSettings).not.toHaveBeenCalled();
    if (available === "description") expect(api.putReceiptLanguage).not.toHaveBeenCalled();
    else expect(api.putLocationSettings).not.toHaveBeenCalled();
    await vi.waitFor(async () => {
      await button!.updateComplete;
      expect(button!.variant).toBe("secondary");
      expect(button!.shadowRoot!.querySelector("button")!.disabled).toBe(true);
    });
    if (failed === "getReceiptLanguage")
      expect(el.shadowRoot!.querySelector("[data-test=language-section]")).toBeNull();
    if (failed === "getLocationSettings")
      expect(el.shadowRoot!.querySelector("[data-test=description-section]")).toBeNull();
    await expectNoA11yViolations(host);
  });
}

for (const available of ["language", "description"] as const) {
  it(`retains a refused ${available} draft when the receipt read recovers`, async () => {
    const api = fixture();
    const read = api.getReceipt.getMockImplementation()!;
    api.getReceipt.mockRejectedValue({ code: "server.internal" });
    if (available === "language")
      api.putReceiptLanguage.mockRejectedValue({ code: "server.internal" });
    else api.putLocationSettings.mockRejectedValue({ code: "server.internal" });
    const { el } = await mount(api);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector(`[data-test=${available}-save]`)).toBeTruthy(),
    );
    if (available === "language") {
      await chooseOption(
        el.shadowRoot!.querySelector("wt-combobox[name=receiptLanguage]")!,
        "ca-ES",
      );
    } else {
      const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
        "wt-input[name=operationDescription]",
      )!;
      await field.updateComplete;
      await userEvent.fill(
        page.elementLocator(field.shadowRoot!.querySelector("input")!),
        "Unsubmitted description",
      );
    }
    el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${available}-save]`)!.click();
    const message = () =>
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
        `[data-test=${available}-actions]`,
      )!.error;
    await vi.waitFor(() => expect(message()).not.toBe(""));
    const refusal = message();
    api.getReceipt.mockImplementation(read);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry]")!.click();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-test=retry]")).toBeNull());
    expect(message()).toBe(refusal);
    const button = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      `[data-test=${available}-save]`,
    )!;
    await button.updateComplete;
    expect(button.variant).toBe("primary");
    expect(button.shadowRoot!.querySelector("button")!.disabled).toBe(false);
    if (available === "language")
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
          "wt-combobox[name=receiptLanguage]",
        )!.value,
      ).toBe("ca-ES");
    else
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
          "wt-input[name=operationDescription]",
        )!.value,
      ).toBe("Unsubmitted description");
    expect(api.putReceipt).not.toHaveBeenCalled();
    expect(api.putVenueReceiptSettings).not.toHaveBeenCalled();
  });
}

for (const failed of ["getReceipt", "getLocationSettings", "getReceiptLanguage"] as const) {
  it(`keeps the department editable and independently savable when ${failed} refuses`, async () => {
    const api = fixture();
    api[failed].mockRejectedValue({ code: "server.internal" });
    const { el, host } = await mount(api);
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).toBeTruthy());
    await vi.waitFor(() =>
      expect(department(el)?.shadowRoot?.querySelector("wt-input[name=email]")).toBeTruthy(),
    );
    const action = save(department(el), "department");
    await action.updateComplete;
    expect(action.variant).toBe("secondary");
    expect(action.shadowRoot!.querySelector("button")!.disabled).toBe(true);
    action.click();
    await edit(department(el), "email", "bar@example.com");
    await action.updateComplete;
    expect(action.variant).toBe("primary");
    expect(action.shadowRoot!.querySelector("button")!.disabled).toBe(false);
    await userEvent.click(page.elementLocator(action.shadowRoot!.querySelector("button")!));
    await vi.waitFor(() =>
      expect(api.putDepartmentReceipt).toHaveBeenCalledExactlyOnceWith("bar", {
        email: "bar@example.com",
      }),
    );
    await vi.waitFor(async () => {
      await action.updateComplete;
      expect(action.variant).toBe("secondary");
      expect(action.shadowRoot!.querySelector("button")!.disabled).toBe(true);
    });
    expect(api.putReceipt).not.toHaveBeenCalled();
    expect(api.putVenueReceiptSettings).not.toHaveBeenCalled();
    expect(api.putLocationSettings).not.toHaveBeenCalled();
    expect(api.putReceiptLanguage).not.toHaveBeenCalled();
    await expectNoA11yViolations(host);
  });

  it(`keeps a refused department draft after ${failed} recovers`, async () => {
    const api = fixture();
    const read = api[failed].getMockImplementation()!;
    api[failed].mockRejectedValue({ code: "server.internal" });
    api.putDepartmentReceipt.mockRejectedValue({ code: "server.internal" });
    const { el } = await mount(api);
    await vi.waitFor(() =>
      expect(department(el)?.shadowRoot?.querySelector("wt-input[name=email]")).toBeTruthy(),
    );
    const form = department(el);
    await edit(form, "email", "refused@bar.example");
    save(form, "department").click();
    const message = () =>
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
        .error;
    await vi.waitFor(() => expect(message()).not.toBe(""));
    const refusal = message();
    api[failed].mockImplementation(read as never);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry]")!.click();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-test=retry]")).toBeNull());
    expect(department(el)).toBe(form);
    expect(message()).toBe(refusal);
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=email]")!
        .value,
    ).toBe("refused@bar.example");
    const action = save(form, "department");
    await action.updateComplete;
    expect(action.variant).toBe("primary");
    expect(action.shadowRoot!.querySelector("button")!.disabled).toBe(false);
    api.putDepartmentReceipt.mockResolvedValue(undefined);
    await userEvent.click(page.elementLocator(action.shadowRoot!.querySelector("button")!));
    await vi.waitFor(() => expect(api.putDepartmentReceipt).toHaveBeenCalledTimes(2));
    expect(api.putDepartmentReceipt.mock.calls).toEqual([
      ["bar", { email: "refused@bar.example" }],
      ["bar", { email: "refused@bar.example" }],
    ]);
    expect(api.putReceipt).not.toHaveBeenCalled();
    expect(api.putVenueReceiptSettings).not.toHaveBeenCalled();
    expect(api.putLocationSettings).not.toHaveBeenCalled();
    expect(api.putReceiptLanguage).not.toHaveBeenCalled();
  });
}

it("redraws the department's saved-language fallback after a live change despite a failed venue receipt read", async () => {
  const api = fixture();
  api.getReceipt.mockRejectedValue({ code: "server.internal" });
  let savedLanguage = "es-ES";
  api.previewReceiptDraft.mockImplementation(async () => paper(savedLanguage));
  const { el } = await mount(api);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector(".paper")?.textContent ?? "").toContain("es-ES"),
  );
  savedLanguage = "ca-ES";
  api.getReceiptLanguage.mockResolvedValue({
    language: "ca-ES",
    choices: ["es-ES", "ca-ES"],
    fixed: null,
  });
  api.liveData.invalidate([{ type: "locations" }]);
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
        "wt-combobox[name=previewLanguage]",
      )?.value,
    ).toBe("ca-ES"),
  );
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector(".paper")?.textContent ?? "").toContain("ca-ES"),
  );
  expect(api.previewReceiptDraft.mock.lastCall?.[0]).toEqual({
    departmentId: "bar",
    receipt: {},
    settings: {
      headerSubtitle: "Current defaults",
      footerMessage: "Thanks",
      printAddress: false,
    },
  });
  expect(save(department(el), "department").disabled).toBe(true);
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  expect(api.putReceiptLanguage).not.toHaveBeenCalled();
});

it("shows one defaults form and no legacy global contact fields or combined Save", async () => {
  const { el, api } = await mount();
  expect(el.shadowRoot!.querySelectorAll("dashboard-venue-receipt-defaults-editor")).toHaveLength(
    1,
  );
  expect(
    el.shadowRoot!.querySelector(
      "[name=headerSubtitle], [name=footerMessage], [name=phone], [name=email], [name=printAddress]",
    ),
  ).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=save], [data-test=combined-actions]")).toBeNull();
  expect(el.shadowRoot!.querySelectorAll("[name=operationDescription]")).toHaveLength(1);
  expect(el.shadowRoot!.querySelectorAll("[name=receiptLanguage]")).toHaveLength(1);
  expect(api.putReceipt).not.toHaveBeenCalled();
});

it("shows the current venue address beside its global switch and highlights focused defaults on the preview", async () => {
  const api = fixture();
  api.previewReceiptDraft.mockImplementation(async () => {
    const result = paper("Current defaults\nCalle Mayor 1");
    result.marks.headerSubtitle = { start: 0, end: 1 } as never;
    return result;
  });
  const { el } = await mount(api);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector(".paper")).toBeTruthy());
  const root = defaults(el).shadowRoot!;
  expect(root.querySelector("[data-test=venue-address]")?.textContent).toContain("Calle Mayor 1");
  const field = root.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=headerSubtitle]")!;
  await field.updateComplete;
  field.shadowRoot!.querySelector("input")!.focus();
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector("[data-mark=headerSubtitle]")?.hasAttribute("data-active"),
  ).toBe(true);
});
