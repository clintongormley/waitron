import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import type { DepartmentReceiptEditor } from "./department-receipt-editor.js";
import type { DashboardApi, DepartmentReceiptSettings } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./department-receipt-editor.js";

type Editor = DepartmentReceiptEditor;
const LOGO = `${"a".repeat(64)}.png`;
const settings: DepartmentReceiptSettings = {
  receiptLanguage: "es-ES",
  receipt: { phone: "+34 912 345 678", headerSubtitle: { "es-ES": "Bar" } },
  venueDefaults: { logo: LOGO, headerSubtitle: "Venue subtitle", footerMessage: "Gracias" },
  languages: ["es-ES", "ca-ES"],
  warningLanguages: ["ca-ES"],
  venueAddress: ["Calle Mayor 1"],
};
function apiFixture(value = settings) {
  let stored = structuredClone(value);
  return {
    liveData: new LiveData(),
    getDepartmentReceipt: vi.fn(async () => structuredClone(stored)),
    putDepartmentReceipt: vi.fn<
      (id: string, receipt: DepartmentReceiptSettings["receipt"]) => Promise<void>
    >(async (...args) => {
      stored = { ...stored, receipt: structuredClone(args[1]) };
    }),
    imageLibraryRequest: vi.fn(async () => ({ images: [], total: 0 })),
  };
}
async function mount(api = apiFixture()) {
  const { el } = await mountWidget<Editor>("dashboard-department-receipt-editor", {
    api: api as unknown as DashboardApi,
    departmentId: "bar",
    departmentName: "Bar",
    receiptLanguage: "es-ES",
  });
  await vi.waitFor(() => expect(el.shadowRoot?.querySelector("wt-input[name=phone]")).toBeTruthy());
  return { el, api };
}
function field(el: Editor, name: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[name="${name}"]`,
  )!;
}
async function edit(el: Editor, name: string, value: string) {
  const input = field(el, name);
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
function save(el: Editor) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=department-save]",
  )!;
}
async function state(el: Editor) {
  await el.updateComplete;
  const button = save(el);
  await button.updateComplete;
  return {
    variant: button.variant,
    disabled: button.shadowRoot!.querySelector("button")!.disabled,
  };
}
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
describe("department receipt authored draft", () => {
  it("shows authored contact and inherited text/logo without making the draft savable", async () => {
    const { el, api } = await mount();
    expect(field(el, "phone").value).toBe("+34 912 345 678");
    expect(field(el, "email").value).toBe("");
    const subtitle = field(el, "headerSubtitle-ca-ES");
    await subtitle.updateComplete;
    expect(subtitle.value).toBe("");
    expect(subtitle.shadowRoot!.querySelector("input")!.placeholder).toBe("Bar");
    const image = el.shadowRoot!.querySelector("dashboard-image-upload") as HTMLElement & {
      image: unknown;
      inheritedImage: unknown;
    };
    expect(image.image).toBeNull();
    expect(image.inheritedImage).toBe(LOGO);
    expect(await state(el)).toEqual({ variant: "secondary", disabled: true });
    save(el).click();
    await el.updateComplete;
    expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  });
  it("submits only department fields to the selected department, leaving inherited values unwritten", async () => {
    const { el, api } = await mount();
    await edit(el, "email", "bar@example.com");
    expect(await state(el)).toEqual({ variant: "primary", disabled: false });
    save(el).click();
    save(el).click();
    await vi.waitFor(() =>
      expect(api.putDepartmentReceipt).toHaveBeenCalledExactlyOnceWith("bar", {
        phone: "+34 912 345 678",
        email: "bar@example.com",
        headerSubtitle: { "es-ES": "Bar" },
      }),
    );
    await vi.waitFor(async () =>
      expect(await state(el)).toEqual({ variant: "secondary", disabled: true }),
    );
    expect(field(el, "email").shadowRoot!.querySelector("input")!.value).toBe("bar@example.com");
  });
  it("reverting a real control edit disables Save again", async () => {
    const { el } = await mount();
    await edit(el, "phone", "+34 912 345 679");
    expect(await state(el)).toEqual({ variant: "primary", disabled: false });
    await edit(el, "phone", "+34 912 345 678");
    expect(await state(el)).toEqual({ variant: "secondary", disabled: true });
  });
  it("refused contact saves keep the draft retryable and explain the field and bottom action", async () => {
    const api = apiFixture();
    api.putDepartmentReceipt.mockRejectedValue({
      code: "receipt.invalid",
      params: { field: "email", reason: "invalid_email" },
    } as never);
    const { el } = await mount(api);
    await edit(el, "email", "bar@example.com");
    save(el).click();
    await vi.waitFor(() => expect(field(el, "email").error).not.toBe(""));
    expect(field(el, "email").value).toBe("bar@example.com");
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
        .error,
    ).not.toBe("");
    expect(await state(el)).toEqual({ variant: "primary", disabled: false });
  });
  it("commits the successful write even when the following read fails", async () => {
    const { el, api } = await mount();
    api.getDepartmentReceipt.mockRejectedValue({ code: "server.internal_error" } as never);
    await edit(el, "email", "bar@example.com");
    save(el).click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=department-load-error]")).not.toBeNull(),
    );
    expect(field(el, "email").value).toBe("bar@example.com");
    expect(await state(el)).toEqual({ variant: "secondary", disabled: true });
    save(el).click();
    expect(api.putDepartmentReceipt).toHaveBeenCalledOnce();
  });
  it("clearing a text override sends an empty map entry and keeps other authored fields", async () => {
    const { el, api } = await mount();
    await edit(el, "headerSubtitle-es-ES", "");
    save(el).click();
    await vi.waitFor(() =>
      expect(api.putDepartmentReceipt).toHaveBeenCalledExactlyOnceWith("bar", {
        phone: "+34 912 345 678",
        headerSubtitle: { "es-ES": "" },
      }),
    );
  });
});

it("returns an unwritten locale to a clean draft after typing and clearing it", async () => {
  const { el, api } = await mount();
  await edit(el, "headerSubtitle-ca-ES", "Hola");
  expect(await state(el)).toEqual({ variant: "primary", disabled: false });
  await edit(el, "headerSubtitle-ca-ES", "");
  expect(await state(el)).toEqual({ variant: "secondary", disabled: true });
  save(el).click();
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});
it("a clean live update moves inherited hints and logo without creating an override", async () => {
  const { el, api } = await mount();
  api.getDepartmentReceipt.mockResolvedValue({
    ...settings,
    receipt: {},
    venueDefaults: { logo: `${"b".repeat(64)}.png`, headerSubtitle: "New venue subtitle" },
  });
  api.liveData.invalidate([{ type: "tenant_receipts" }]);
  await vi.waitFor(async () => {
    const input = field(el, "headerSubtitle-ca-ES");
    await input.updateComplete;
    expect(input.shadowRoot!.querySelector("input")!.placeholder).toBe("New venue subtitle");
  });
  expect(field(el, "headerSubtitle-ca-ES").value).toBe("");
  expect(await state(el)).toEqual({ variant: "secondary", disabled: true });
});
it("a subscription snapshot updates inherited defaults while retaining typed department contact", async () => {
  const { el, api } = await mount();
  await edit(el, "email", "typed@example.com");
  api.getDepartmentReceipt.mockResolvedValue({
    ...settings,
    venueDefaults: { footerMessage: "Come again" },
  });
  api.liveData.invalidate([{ type: "tenant_receipts" }]);
  await vi.waitFor(() => expect(api.getDepartmentReceipt).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-textarea"]>(
        "wt-textarea[name=footerMessage-ca-ES]",
      )!.hint,
    ).toBe("Come again"),
  );
  expect(field(el, "email").value).toBe("typed@example.com");
  expect(await state(el)).toEqual({ variant: "primary", disabled: false });
});
it("invalid typed contact disables the action after submission and explains both field and summary", async () => {
  const { el, api } = await mount();
  await edit(el, "email", "invalid");
  save(el).click();
  await vi.waitFor(() => expect(field(el, "email").error).not.toBe(""));
  expect(await state(el)).toEqual({ variant: "primary", disabled: true });
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
  await edit(el, "email", "fixed@example.com");
  expect(field(el, "email").error).toBe("");
  expect(await state(el)).toEqual({ variant: "primary", disabled: false });
});
it("adding and removing an explicit logo restores inheritance and the opened draft", async () => {
  const { el, api } = await mount();
  const image = el.shadowRoot!.querySelector("dashboard-image-upload")!;
  image.dispatchEvent(
    new CustomEvent("image-changed", {
      detail: { image: `${"b".repeat(64)}.png` },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(await state(el)).toEqual({ variant: "primary", disabled: false });
  image.dispatchEvent(
    new CustomEvent("image-changed", { detail: { image: null }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(await state(el)).toEqual({ variant: "secondary", disabled: true });
  save(el).click();
  expect(api.putDepartmentReceipt).not.toHaveBeenCalled();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
it("an old live read cannot undo the successful save baseline", async () => {
  const { el, api } = await mount();
  const old = deferred<DepartmentReceiptSettings>();
  api.getDepartmentReceipt.mockImplementationOnce(() => old.promise);
  api.liveData.invalidate([{ type: "department_receipts" }]);
  await vi.waitFor(() => expect(api.getDepartmentReceipt).toHaveBeenCalledTimes(2));
  api.getDepartmentReceipt.mockResolvedValue({
    ...settings,
    receipt: { ...settings.receipt, email: "saved@example.com" },
  });
  await edit(el, "email", "saved@example.com");
  save(el).click();
  await vi.waitFor(() => expect(api.getDepartmentReceipt).toHaveBeenCalledTimes(3));
  old.resolve(settings);
  await el.updateComplete;
  expect(field(el, "email").value).toBe("saved@example.com");
  expect(await state(el)).toEqual({ variant: "secondary", disabled: true });
});
it("a late refused save for a former department cannot mark the newly selected contact", async () => {
  const { el, api } = await mount();
  const pending = deferred<void>();
  api.putDepartmentReceipt.mockImplementationOnce(() => pending.promise);
  await edit(el, "email", "bar@example.com");
  save(el).click();
  await vi.waitFor(() => expect(api.putDepartmentReceipt).toHaveBeenCalledOnce());
  api.getDepartmentReceipt.mockResolvedValue({
    ...settings,
    receipt: { email: "cafe@example.com" },
  });
  el.departmentId = "cafe";
  await el.updateComplete;
  await vi.waitFor(() => expect(field(el, "email").value).toBe("cafe@example.com"));
  pending.reject({ code: "receipt.invalid", params: { field: "email", reason: "invalid_email" } });
  await pending.promise.catch(() => undefined);
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
  await el.updateComplete;
  expect(field(el, "email").error).toBe("");
  expect(await state(el)).toEqual({ variant: "secondary", disabled: true });
});
it("puts a known language refusal under that locale and never invents a field for an unknown language", async () => {
  const { el, api } = await mount();
  api.putDepartmentReceipt.mockRejectedValue({
    code: "receipt.invalid",
    params: { field: "headerSubtitle", language: "ca-ES", reason: "too_long", maxLength: 200 },
  } as never);
  await edit(el, "headerSubtitle-ca-ES", "Catalan");
  save(el).click();
  await vi.waitFor(() => expect(field(el, "headerSubtitle-ca-ES").error).not.toBe(""));
  expect(field(el, "headerSubtitle-es-ES").error).toBe("");
  await edit(el, "headerSubtitle-ca-ES", "Catalan edited");
  expect(field(el, "headerSubtitle-ca-ES").error).toBe("");
  api.putDepartmentReceipt.mockRejectedValue({
    code: "receipt.invalid",
    params: { field: "headerSubtitle", language: "arbitrary-unknown" },
  } as never);
  save(el).click();
  await vi.waitFor(() => expect(api.putDepartmentReceipt).toHaveBeenCalledTimes(2));
  await vi.waitFor(async () =>
    expect(await state(el)).toEqual({ variant: "primary", disabled: false }),
  );
  expect(el.shadowRoot!.querySelector('[name="headerSubtitle-arbitrary-unknown"]')).toBeNull();
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).not.toBe("");
});

it.each(["en-GB", "es-ES"])(
  "a marked department contact refusal has the generic bottom summary in %s",
  async (locale) => {
    setLocale(locale);
    const api = apiFixture();
    api.putDepartmentReceipt.mockRejectedValue({
      code: "receipt.invalid",
      params: { field: "email", reason: "invalid_email" },
    });
    const { el } = await mount(api);
    await edit(el, "email", "bar@example.com");
    save(el).click();
    await vi.waitFor(() => expect(field(el, "email").error).toBe(t("receipts.invalid_email")));
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
        .error,
    ).toBe(t("form.fix_fields"));
  },
);

for (const refused of [false, true]) {
  it(`A10 an obsolete department read's ${refused ? "refusal" : "snapshot"} cannot replace the selected editor`, async () => {
    const { el, api } = await mount();
    const old = deferred<DepartmentReceiptSettings>();
    api.getDepartmentReceipt.mockImplementationOnce(() => old.promise);
    api.liveData.invalidate([{ type: "department_receipts" }]);
    await expect.poll(() => api.getDepartmentReceipt.mock.calls.length).toBe(2);
    api.getDepartmentReceipt.mockResolvedValue({
      ...settings,
      receipt: { email: "deli@example.com" },
    });
    el.departmentId = "deli";
    await expect.poll(() => field(el, "email")?.value).toBe("deli@example.com");
    await edit(el, "email", "draft@example.com");
    if (refused) old.reject({ code: "department.not_found" });
    else old.resolve(settings);
    await old.promise.catch(() => undefined);
    await el.updateComplete;
    expect(field(el, "email").value).toBe("draft@example.com");
    expect(el.shadowRoot!.querySelector("[data-test=department-load-error]")).toBeNull();
    expect(await state(el)).toEqual({ variant: "primary", disabled: false });
    expect(api.liveData.interests).toContainEqual({ type: "department_receipts" });
    el.remove();
    expect(api.liveData.interests).toEqual([]);
  });
}
it("A10 a former department's accepted write cannot commit a new department draft", async () => {
  const { el, api } = await mount();
  const pending = deferred<void>();
  api.putDepartmentReceipt.mockImplementationOnce(() => pending.promise);
  await edit(el, "email", "bar@example.com");
  save(el).click();
  await expect.poll(() => api.putDepartmentReceipt.mock.calls.length).toBe(1);
  expect(api.putDepartmentReceipt.mock.calls[0]).toEqual([
    "bar",
    {
      ...settings.receipt,
      email: "bar@example.com",
    },
  ]);
  api.getDepartmentReceipt.mockResolvedValue({
    ...settings,
    receipt: { email: "deli@example.com" },
  });
  el.departmentId = "deli";
  await expect.poll(() => field(el, "email")?.value).toBe("deli@example.com");
  await edit(el, "email", "new-draft@example.com");
  pending.resolve();
  await pending.promise;
  await el.updateComplete;
  expect(field(el, "email").value).toBe("new-draft@example.com");
  expect(await state(el)).toEqual({ variant: "primary", disabled: false });
  const { reattachAfterDetachedUpdate } = await import("../widgets/test-helpers.js");
  await reattachAfterDetachedUpdate(el);
  expect(field(el, "email").value).toBe("new-draft@example.com");
  expect(await state(el)).toEqual({ variant: "primary", disabled: false });
  await edit(el, "email", "deli@example.com");
  expect(await state(el)).toEqual({ variant: "secondary", disabled: true });
});
