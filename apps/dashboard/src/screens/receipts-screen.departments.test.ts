import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi, DepartmentReceiptSettings, ReceiptPreview } from "../api/client.js";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { ReceiptsScreen } from "./receipts-screen.js";
import type { DepartmentReceiptEditor } from "./department-receipt-editor.js";
import "./receipts-screen.js";

const originalUrl = location.href;
const departments = [
  { id: "deli", name: "Deli", active: true, isDefault: false },
  { id: "bar", name: "Bar", active: true, isDefault: true },
  { id: "closed", name: "Closed", active: false, isDefault: false },
];
const settings: DepartmentReceiptSettings = {
  receipt: {},
  venueDefaults: { headerSubtitle: "Venue subtitle" },
  languages: ["es-ES", "ca-ES"],
  warningLanguages: [],
  venueAddress: ["Calle Mayor 1"],
};
function preview(text: string): ReceiptPreview {
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
      address: null,
      phone: null,
      email: null,
      footerMessage: null,
    },
    paperWidth: "80mm",
    paperWidths: ["80mm"],
  };
}
function apiFixture(rows = departments) {
  const stored = new Map(
    rows.map((row) => [
      row.id,
      {
        phone: row.id === "bar" ? "+34 912 345 678" : "+34 912 345 679",
      } as DepartmentReceiptSettings["receipt"],
    ]),
  );
  return {
    liveData: new LiveData(),
    getVenueReceiptSettings: vi.fn(async () => ({
      settings: { headerSubtitle: "Venue subtitle" },
    })),
    putVenueReceiptSettings: vi.fn(async () => {}),
    getVenueDepartments: vi.fn(async () => structuredClone(rows)),
    getDepartmentReceipt: vi.fn(async (id: string) => ({
      ...structuredClone(settings),
      receipt: structuredClone(stored.get(id) ?? {}),
    })),
    putDepartmentReceipt: vi.fn(
      async (id: string, receipt: DepartmentReceiptSettings["receipt"]) => {
        stored.set(id, structuredClone(receipt));
      },
    ),
    getReceipt: vi.fn<DashboardApi["getReceipt"]>(async () => ({
      receipt: { headerSubtitle: "Venue subtitle" },
      venueAddress: ["Calle Mayor 1"],
    })),
    putReceipt: vi.fn(async () => {}),
    getLocationSettings: vi.fn(async () => ({ name: "Venue", operationDescription: "Sales" })),
    putLocationSettings: vi.fn(async () => {}),
    getReceiptLanguage: vi.fn(async () => ({
      language: "es-ES",
      choices: ["es-ES", "ca-ES"],
      fixed: null,
    })),
    putReceiptLanguage: vi.fn(async () => {}),
    getContentLanguages: vi.fn(async () => ({ defaultLanguage: "es", languages: ["es"] })),
    previewReceipt: vi.fn(async () => preview("Venue only")),
    previewReceiptDraft: vi.fn<DashboardApi["previewReceiptDraft"]>(async (draft) =>
      preview(
        draft.departmentId === null
          ? "Venue only"
          : `${draft.departmentId}: ${draft.receipt.email ?? draft.receipt.phone ?? "empty"}`,
      ),
    ),
    imageLibraryRequest: vi.fn(async () => ({ images: [], total: 0 })),
  };
}
function url(id?: string) {
  const next = new URL(location.href);
  next.pathname = "/manage/venue-settings/view/receipts";
  next.search = id ? `?departmentId=${id}` : "";
  history.replaceState(null, "", next);
}
async function mount(api = apiFixture(), theme: "light" | "dark" = "light") {
  const { el } = await mountWidget<ReceiptsScreen>(
    "dashboard-receipts-screen",
    {
      api: api as unknown as DashboardApi,
    },
    theme,
  );
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=description-save]")).not.toBeNull(),
  );
  return { el, api };
}
function editor(el: ReceiptsScreen) {
  return el.shadowRoot!.querySelector<DepartmentReceiptEditor>(
    "dashboard-department-receipt-editor",
  );
}
async function loadedEditor(el: ReceiptsScreen) {
  await vi.waitFor(() =>
    expect(editor(el)?.shadowRoot?.querySelector("wt-input[name=email]")).toBeTruthy(),
  );
  return editor(el)!;
}
function picker(el: ReceiptsScreen) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    "wt-combobox[name=departmentId]",
  )!;
}
async function fill(el: ReceiptsScreen | DepartmentReceiptEditor, name: string, value: string) {
  const root =
    name === "headerSubtitle" && el.localName === "dashboard-receipts-screen"
      ? el.shadowRoot!.querySelector("dashboard-venue-receipt-defaults-editor")!.shadowRoot!
      : el.shadowRoot!;
  const field = root.querySelector<HTMLElementTagNameMap["wt-input"]>(`wt-input[name="${name}"]`)!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", originalUrl);
  setLocale("en-GB");
});

describe("the receipt page's department context", () => {
  it("edits the active default even when another department is first, and previews its authored values", async () => {
    url();
    const { el, api } = await mount();
    const child = await loadedEditor(el);
    expect(child.departmentId).toBe("bar");
    expect(picker(el).value).toBe("bar");
    expect(new URL(location.href).searchParams.get("departmentId")).toBe("bar");
    await vi.waitFor(() =>
      expect(api.previewReceiptDraft).toHaveBeenCalledWith({
        departmentId: "bar",
        receipt: { phone: "+34 912 345 678" },
        settings: { headerSubtitle: "Venue subtitle" },
      }),
    );
    expect(api.previewReceipt).not.toHaveBeenCalled();
  });
  it("selects the first active department when the designated default is disabled", async () => {
    url();
    const { el } = await mount(
      apiFixture(departments.map((row) => ({ ...row, active: row.id === "deli" }))),
    );
    expect((await loadedEditor(el)).departmentId).toBe("deli");
  });
  it("edits and previews an explicitly addressed disabled department", async () => {
    url("closed");
    const { el, api } = await mount();
    expect((await loadedEditor(el)).departmentId).toBe("closed");
    expect(picker(el).options.map((option) => option.value)).toEqual(["deli", "bar", "closed"]);
    await vi.waitFor(() =>
      expect(api.previewReceiptDraft.mock.lastCall?.[0].departmentId).toBe("closed"),
    );
  });
  it("mounts the editor for one active department", async () => {
    url();
    const { el } = await mount(apiFixture([departments[0]!]));
    expect((await loadedEditor(el)).departmentId).toBe("deli");
    expect(picker(el)).not.toBeNull();
  });
  it("leaves global settings usable with no active department", async () => {
    url();
    const { el, api } = await mount(
      apiFixture(departments.map((row) => ({ ...row, active: false }))),
    );
    expect(editor(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=no-department]")).not.toBeNull();
    await fill(el, "headerSubtitle", "Updated venue");
    el.shadowRoot!.querySelector("dashboard-venue-receipt-defaults-editor")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=defaults-save]")!
      .click();
    await vi.waitFor(() =>
      expect(api.putVenueReceiptSettings).toHaveBeenCalledExactlyOnceWith({
        headerSubtitle: "Updated venue",
      }),
    );
    expect(api.getDepartmentReceipt).not.toHaveBeenCalled();
  });
  it("keeps global settings usable when the department read refuses", async () => {
    url("bar");
    const api = apiFixture();
    api.getDepartmentReceipt.mockRejectedValue({ code: "department.not_found" });
    const { el } = await mount(api);
    await vi.waitFor(() =>
      expect(
        editor(el)?.shadowRoot?.querySelector("[data-test=department-load-error]"),
      ).toBeTruthy(),
    );
    await fill(el, "headerSubtitle", "Updated venue");
    el.shadowRoot!.querySelector("dashboard-venue-receipt-defaults-editor")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=defaults-save]")!
      .click();
    await vi.waitFor(() => expect(api.putVenueReceiptSettings).toHaveBeenCalledOnce());
    expect(api.previewReceiptDraft).not.toHaveBeenCalled();
  });
  it("uses the same department for picker, editor, draft preview and save without sending an address", async () => {
    url("bar");
    const { el, api } = await mount();
    await loadedEditor(el);
    await chooseOption(picker(el), "deli");
    await vi.waitFor(() => expect(editor(el)?.departmentId).toBe("deli"));
    const child = await loadedEditor(el);
    await fill(child, "email", "deli@example.com");
    await vi.waitFor(() =>
      expect(api.previewReceiptDraft.mock.lastCall?.[0]).toEqual({
        departmentId: "deli",
        receipt: { phone: "+34 912 345 679", email: "deli@example.com" },
        settings: { headerSubtitle: "Venue subtitle" },
      }),
    );
    child.shadowRoot!.querySelector<HTMLElement>("[data-test=department-save]")!.click();
    await vi.waitFor(() =>
      expect(api.putDepartmentReceipt).toHaveBeenCalledExactlyOnceWith("deli", {
        phone: "+34 912 345 679",
        email: "deli@example.com",
      }),
    );
    expect(api.putReceipt).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(
        child.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
          "[data-test=department-save]",
        )!.disabled,
      ).toBe(true),
    );
    const email =
      child.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=email]")!;
    await email.updateComplete;
    expect(email.shadowRoot!.querySelector("input")!.value).toBe("deli@example.com");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector(".paper")!.textContent).toContain(
        "deli: deli@example.com",
      ),
    );
  });
});

it("previews the rest of a department draft while its contact is incomplete", async () => {
  url("bar");
  const { el, api } = await mount();
  const child = await loadedEditor(el);
  await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledOnce());
  await fill(child, "email", "bar@");
  await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(api.previewReceiptDraft.mock.lastCall?.[0].receipt).toEqual({
      phone: "+34 912 345 678",
    }),
  );
  expect(
    child.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=email]")!
      .value,
  ).toBe("bar@");
});
it("global draft edits move inherited hints and preview without waking the department Save", async () => {
  url("bar");
  const { el, api } = await mount();
  const child = await loadedEditor(el);
  await fill(el, "headerSubtitle", "Unsaved venue subtitle");
  await vi.waitFor(async () => {
    const input = child.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      "wt-input[name=headerSubtitle-es-ES]",
    )!;
    await input.updateComplete;
    expect(input.shadowRoot!.querySelector("input")!.placeholder).toBe("Unsaved venue subtitle");
  });
  await vi.waitFor(() =>
    expect(api.previewReceiptDraft.mock.lastCall?.[0]).toEqual({
      departmentId: "bar",
      receipt: { phone: "+34 912 345 678" },
      settings: { headerSubtitle: "Unsaved venue subtitle" },
    }),
  );
  const action = child.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=department-save]",
  )!;
  await action.updateComplete;
  expect(action.shadowRoot!.querySelector("button")!.disabled).toBe(true);
  expect(api.putReceipt).not.toHaveBeenCalled();
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});

it("excludes stored venue contact from a department's preview defaults", async () => {
  url("bar");
  const api = apiFixture();
  api.getReceipt.mockResolvedValue({
    receipt: {
      headerSubtitle: "Venue subtitle",
      phone: "+34 912 111 111",
      email: "venue@example.com",
    },
    venueAddress: ["Calle Mayor 1"],
  });
  const { el } = await mount(api);
  await loadedEditor(el);
  await vi.waitFor(() =>
    expect(api.previewReceiptDraft.mock.lastCall?.[0]).toEqual({
      departmentId: "bar",
      receipt: { phone: "+34 912 345 678" },
      settings: { headerSubtitle: "Venue subtitle" },
    }),
  );
});

it("a preview completing for the former department cannot replace the selected department's paper", async () => {
  url("bar");
  const api = apiFixture();
  let resolve!: (value: ReceiptPreview) => void;
  const held = new Promise<ReceiptPreview>((yes) => {
    resolve = yes;
  });
  api.previewReceiptDraft.mockImplementationOnce(() => held);
  const { el } = await mount(api);
  await loadedEditor(el);
  await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledOnce());
  await chooseOption(picker(el), "deli");
  await vi.waitFor(() => expect(editor(el)?.departmentId).toBe("deli"));
  await loadedEditor(el);
  let resolveNext!: (value: ReceiptPreview) => void;
  const next = new Promise<ReceiptPreview>((yes) => {
    resolveNext = yes;
  });
  api.previewReceiptDraft.mockImplementationOnce(() => next);
  resolve(preview("Obsolete Bar"));
  await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledTimes(2));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".paper")).toBeNull();
  resolveNext(preview("Current Deli"));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector(".paper")?.textContent).toContain("Current Deli"),
  );
});

for (const theme of ["light", "dark"] as const) {
  for (const locale of ["en-GB", "es-ES"]) {
    it(`integrated department fields are accessible clean, dirty and refused in ${locale}/${theme}`, async () => {
      url("bar");
      setLocale(locale);
      const api = apiFixture();
      api.putDepartmentReceipt.mockRejectedValue({
        code: "receipt.invalid",
        params: { field: "email", reason: "invalid_email" },
      });
      const { el } = await mount(api, theme);
      const child = await loadedEditor(el);
      await expectNoA11yViolations(el);
      await fill(child, "email", "bar@example.com");
      await expectNoA11yViolations(el);
      child.shadowRoot!.querySelector<HTMLElement>("[data-test=department-save]")!.click();
      await vi.waitFor(() =>
        expect(
          child.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
            "wt-input[name=email]",
          )!.error,
        ).not.toBe(""),
      );
      await expectNoA11yViolations(el);
    });
  }
}

function previewLanguage(el: ReceiptsScreen) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    "wt-combobox[name=previewLanguage]",
  );
}

it("starts department previews in the saved receipt language and offers an independent language choice", async () => {
  url("bar");
  const { el, api } = await mount();
  await loadedEditor(el);
  const language = previewLanguage(el);
  expect(language).not.toBeNull();
  expect(language!.value).toBe("es-ES");
  expect(language!.options.map((option) => option.value)).toEqual(["es-ES", "ca-ES"]);
  await chooseOption(language!, "ca-ES");
  await vi.waitFor(() =>
    expect(api.previewReceiptDraft.mock.lastCall?.[0]).toEqual({
      departmentId: "bar",
      receipt: { phone: "+34 912 345 678" },
      settings: { headerSubtitle: "Venue subtitle" },
      language: "ca-ES",
    }),
  );
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "wt-combobox[name=receiptLanguage]",
    )!.value,
  ).toBe("es-ES");
  for (const action of [
    el
      .shadowRoot!.querySelector("dashboard-venue-receipt-defaults-editor")!
      .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=defaults-save]")!,
    editor(el)!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=department-save]",
    )!,
  ]) {
    await action.updateComplete;
    expect(action.shadowRoot!.querySelector("button")!.disabled).toBe(true);
  }
  expect(api.putReceiptLanguage).not.toHaveBeenCalled();
  expect(api.putReceipt).not.toHaveBeenCalled();
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});

it("a staged receipt-language setting does not choose the department preview language", async () => {
  url("bar");
  const { el, api } = await mount();
  await loadedEditor(el);
  await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledOnce());
  const savedLanguage = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    "wt-combobox[name=receiptLanguage]",
  )!;
  await chooseOption(savedLanguage, "ca-ES");
  await fill(editor(el)!, "email", "bar@example.com");
  await vi.waitFor(() =>
    expect(api.previewReceiptDraft.mock.lastCall?.[0]).toEqual({
      departmentId: "bar",
      receipt: { phone: "+34 912 345 678", email: "bar@example.com" },
      settings: { headerSubtitle: "Venue subtitle" },
    }),
  );
  expect(previewLanguage(el)!.value).toBe("es-ES");
  expect(api.putReceiptLanguage).not.toHaveBeenCalled();
});

it("keeps the preview language when selecting another department", async () => {
  url("bar");
  const { el, api } = await mount();
  await loadedEditor(el);
  expect(previewLanguage(el)).not.toBeNull();
  await chooseOption(previewLanguage(el)!, "ca-ES");
  await chooseOption(picker(el), "deli");
  await vi.waitFor(() => expect(editor(el)?.departmentId).toBe("deli"));
  await loadedEditor(el);
  await vi.waitFor(() =>
    expect(api.previewReceiptDraft.mock.lastCall?.[0]).toEqual({
      departmentId: "deli",
      receipt: { phone: "+34 912 345 679" },
      settings: { headerSubtitle: "Venue subtitle" },
      language: "ca-ES",
    }),
  );
  expect(previewLanguage(el)!.value).toBe("ca-ES");
});

it("keeps a venue-only preview independent of an unsaved receipt language", async () => {
  url();
  const { el, api } = await mount(apiFixture([]));
  await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledOnce());
  await chooseOption(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "wt-combobox[name=receiptLanguage]",
    )!,
    "ca-ES",
  );
  await fill(el, "headerSubtitle", "Unsaved default");
  await vi.waitFor(() =>
    expect(api.previewReceiptDraft.mock.lastCall?.[0]).toEqual({
      departmentId: null,
      receipt: {},
      settings: { headerSubtitle: "Unsaved default" },
    }),
  );
  expect(previewLanguage(el)!.value).toBe("es-ES");
});

it("does not paint an older language response after a new preview language is selected", async () => {
  url("bar");
  const api = apiFixture();
  let resolveOld!: (value: ReceiptPreview) => void;
  const old = new Promise<ReceiptPreview>((resolve) => {
    resolveOld = resolve;
  });
  let resolveCurrent!: (value: ReceiptPreview) => void;
  const current = new Promise<ReceiptPreview>((resolve) => {
    resolveCurrent = resolve;
  });
  api.previewReceiptDraft.mockImplementationOnce(() => old).mockImplementationOnce(() => current);
  const { el } = await mount(api);
  await loadedEditor(el);
  await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledOnce());
  expect(previewLanguage(el)).not.toBeNull();
  await chooseOption(previewLanguage(el)!, "ca-ES");
  resolveOld(preview("Obsolete Spanish"));
  await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledTimes(2));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".paper")).toBeNull();
  expect(api.previewReceiptDraft.mock.lastCall?.[0].language).toBe("ca-ES");
  resolveCurrent(preview("Current Catalan"));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector(".paper")?.textContent).toContain("Current Catalan"),
  );
});

function heldPreview() {
  let resolve!: (value: ReceiptPreview) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ReceiptPreview>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

for (const refused of [false, true]) {
  it(`ignores an older department draft preview's ${refused ? "refusal" : "paper"} after another edit`, async () => {
    url("bar");
    const { el, api } = await mount();
    const child = await loadedEditor(el);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector(".paper")?.textContent).toContain("bar: +34 912 345 678"),
    );
    const old = heldPreview();
    const current = heldPreview();
    api.previewReceiptDraft
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => current.promise);
    try {
      await fill(child, "email", "before@example.com");
      await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledTimes(2));
      await fill(child, "email", "latest@example.com");
      if (refused) old.reject({ code: "connection.failed" });
      else old.resolve(preview("Obsolete draft"));
      await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledTimes(3));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector(".paper")?.textContent).toContain("bar: +34 912 345 678");
      expect(el.shadowRoot!.querySelector("[data-test=preview-error]")).toBeNull();
      expect(api.previewReceiptDraft.mock.lastCall?.[0].receipt).toEqual({
        phone: "+34 912 345 678",
        email: "latest@example.com",
      });
      current.resolve(preview("Latest draft"));
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector(".paper")?.textContent).toContain("Latest draft"),
      );
      expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
    } finally {
      old.resolve(preview("Old settled"));
      current.resolve(preview("Current settled"));
    }
  });
}

for (const venueOnly of [false, true]) {
  for (const refused of [false, true]) {
    it(`ignores an implicit-language ${refused ? "refusal" : "paper"} after saved language changes in a ${venueOnly ? "venue-only" : "department"} preview`, async () => {
      url(venueOnly ? undefined : "bar");
      const api = apiFixture(venueOnly ? [] : departments);
      const { el } = await mount(api);
      if (!venueOnly) await loadedEditor(el);
      const request = api.previewReceiptDraft;
      const initial = venueOnly ? "Venue only" : "bar: +34 912 345 678";
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector(".paper")?.textContent).toContain(initial),
      );
      const old = heldPreview();
      const current = heldPreview();
      request
        .mockImplementationOnce(() => old.promise)
        .mockImplementationOnce(() => current.promise);
      try {
        if (venueOnly) await fill(el, "headerSubtitle", "Updated venue");
        else await fill(editor(el)!, "email", "bar@example.com");
        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
        api.getReceiptLanguage.mockResolvedValue({
          language: "ca-ES",
          choices: ["es-ES", "ca-ES"],
          fixed: null,
        });
        api.liveData.invalidate([{ type: "locations" }]);
        await vi.waitFor(() => expect(previewLanguage(el)!.value).toBe("ca-ES"));
        if (refused) old.reject({ code: "connection.failed" });
        else old.resolve(preview("Obsolete Spanish"));
        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
        await el.updateComplete;
        expect(el.shadowRoot!.querySelector(".paper")?.textContent).toContain(initial);
        expect(el.shadowRoot!.querySelector("[data-test=preview-error]")).toBeNull();
        current.reject({ code: "connection.failed" });
        await vi.waitFor(() =>
          expect(el.shadowRoot!.querySelector("[data-test=preview-error]")).not.toBeNull(),
        );
        expect(el.shadowRoot!.querySelector(".paper")?.textContent).toContain(initial);
        expect(api.putReceiptLanguage).not.toHaveBeenCalled();
      } finally {
        old.resolve(preview("Old settled"));
        current.resolve(preview("Current settled"));
      }
    });
  }
}

it("accepts an in-flight draft preview after an unchanged department snapshot", async () => {
  url("bar");
  const { el, api } = await mount();
  const child = await loadedEditor(el);
  await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledOnce());
  const held = heldPreview();
  api.previewReceiptDraft.mockImplementationOnce(() => held.promise);
  try {
    await fill(child, "email", "bar@example.com");
    await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledTimes(2));
    api.liveData.invalidate([{ type: "department_receipts" }]);
    await vi.waitFor(() => expect(api.getDepartmentReceipt).toHaveBeenCalledTimes(2));
    await child.updateComplete;
    await el.updateComplete;
    held.resolve(preview("Accepted unchanged draft"));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector(".paper")?.textContent).toContain(
        "Accepted unchanged draft",
      ),
    );
    expect(api.previewReceiptDraft).toHaveBeenCalledTimes(2);
    expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  } finally {
    held.resolve(preview("Settled draft"));
  }
});

it("accepts the chosen preview language's paper when a different saved language changes", async () => {
  url("bar");
  const { el, api } = await mount();
  await loadedEditor(el);
  await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledOnce());
  const held = heldPreview();
  const next = heldPreview();
  api.previewReceiptDraft
    .mockImplementationOnce(() => held.promise)
    .mockImplementationOnce(() => next.promise);
  try {
    await chooseOption(previewLanguage(el)!, "ca-ES");
    await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledTimes(2));
    api.getReceiptLanguage.mockResolvedValue({
      language: "gl-ES",
      choices: ["es-ES", "ca-ES", "gl-ES"],
      fixed: null,
    });
    api.liveData.invalidate([{ type: "locations" }]);
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
          "wt-combobox[name=receiptLanguage]",
        )!.value,
      ).toBe("gl-ES"),
    );
    expect(previewLanguage(el)!.value).toBe("ca-ES");
    held.resolve(preview("Chosen Catalan"));
    await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledTimes(3));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".paper")?.textContent).toContain("Chosen Catalan");
    expect(api.previewReceiptDraft.mock.lastCall?.[0].language).toBe("ca-ES");
    next.resolve(preview("Refreshed Catalan"));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector(".paper")?.textContent).toContain("Refreshed Catalan"),
    );
    expect(api.putReceiptLanguage).not.toHaveBeenCalled();
  } finally {
    held.resolve(preview("Held settled"));
    next.resolve(preview("Next settled"));
  }
});

it("posts a venue-only authored preview without copying stored contact into the draft", async () => {
  url();
  const api = apiFixture([]);
  api.getReceipt.mockResolvedValue({
    receipt: { headerSubtitle: "Stored", phone: "+34 912 345 678", email: "venue@example.test" },
    venueAddress: ["Calle Mayor 1"],
  });
  const { el } = await mount(api);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector(".paper")?.textContent).toContain("Venue only"),
  );
  expect(api.previewReceiptDraft.mock.lastCall).toEqual([
    { departmentId: null, receipt: {}, settings: { headerSubtitle: "Venue subtitle" } },
  ]);
  await fill(el, "headerSubtitle", "Venue draft");
  await vi.waitFor(() =>
    expect(api.previewReceiptDraft.mock.lastCall?.[0].settings).toEqual({
      headerSubtitle: "Venue draft",
    }),
  );
  expect(api.previewReceiptDraft.mock.lastCall?.[0].receipt).toEqual({});
  expect(api.previewReceipt).not.toHaveBeenCalled();
});

it("makes a venue contact refresh passive without sending contact as an authored override", async () => {
  url();
  const api = apiFixture([]);
  const { el } = await mount(api);
  await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledOnce());
  api.getReceipt.mockResolvedValue({
    receipt: { phone: "+34 912 345 678" },
    venueAddress: ["Calle Mayor 1"],
  });
  api.liveData.invalidate([{ type: "tenant_receipts" }]);
  await vi.waitFor(() => expect(api.previewReceiptDraft).toHaveBeenCalledTimes(2));
  expect(api.previewReceiptDraft.mock.lastCall).toEqual([
    { departmentId: null, receipt: {}, settings: { headerSubtitle: "Venue subtitle" } },
    { passive: true },
  ]);
  expect(el.shadowRoot!.querySelector(".paper")?.textContent).toContain("Venue only");
  expect(api.putReceipt).not.toHaveBeenCalled();
});
