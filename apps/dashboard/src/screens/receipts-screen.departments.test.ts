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
    previewReceiptDraft: vi.fn(async (draft: Parameters<DashboardApi["previewReceiptDraft"]>[0]) =>
      preview(`${draft.departmentId}: ${draft.receipt.email ?? draft.receipt.phone ?? "empty"}`),
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
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[data-test=save]")).not.toBeNull());
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
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name="${name}"]`,
  )!;
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
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await vi.waitFor(() =>
      expect(api.putReceipt).toHaveBeenCalledExactlyOnceWith({ headerSubtitle: "Updated venue" }),
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
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await vi.waitFor(() => expect(api.putReceipt).toHaveBeenCalledOnce());
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
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!,
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
  await vi.waitFor(() => expect(api.previewReceipt).toHaveBeenCalledOnce());
  await chooseOption(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "wt-combobox[name=receiptLanguage]",
    )!,
    "ca-ES",
  );
  await fill(el, "headerSubtitle", "Unsaved default");
  await vi.waitFor(() =>
    expect(api.previewReceipt.mock.lastCall).toEqual([{ headerSubtitle: "Unsaved default" }]),
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
