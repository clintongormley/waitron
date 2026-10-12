import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtButton } from "@waitron/ui";
import type { ReceiptLanguage } from "../api/client.js";
import { cleanupWidgets, reattachAfterDetachedUpdate } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import {
  original,
  deferred,
  mount,
  field,
  save,
  pick,
  clickSave,
  unload,
} from "../testing/receipt-language-fixture.js";

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("en-GB");
});

describe("the independent receipt language card", () => {
  it("starts quiet, saves only a changed language and releases its own draft", async () => {
    const { panel, writes } = await mount();
    expect(save(panel).disabled).toBe(true);
    expect(save(panel).variant).toBe("secondary");
    expect(unload()).toBe(false);
    save(panel).dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(writes).toEqual([]);
    await pick(panel, "ca-ES");
    expect(save(panel).disabled).toBe(false);
    expect(unload()).toBe(true);
    await clickSave(panel);
    await expect.poll(() => save(panel).disabled).toBe(true);
    expect(writes).toEqual(["ca-ES"]);
    expect(field(panel).value).toBe("ca-ES");
    expect(unload()).toBe(false);
  });
  it("a real selection back to the saved language clears dirty state", async () => {
    const { panel } = await mount();
    await pick(panel, "ca-ES");
    await field(panel).updateComplete;
    await userEvent.click(page.elementLocator(field(panel).shadowRoot!.querySelector("button")!));
    await userEvent.click(page.getByRole("option", { name: "Spanish", exact: true }));
    await expect.poll(() => save(panel).disabled).toBe(true);
    expect(field(panel).value).toBe("es-ES");
    expect(unload()).toBe(false);
  });
  it.each(["receipt.language_orders_open", "receipt.language_fixed"])(
    "puts a %s refusal under the language, leaves retry available and clears it on change",
    async (code) => {
      const { panel, writes } = await mount(original, {
        putReceiptLanguage: async () => {
          throw { code, params: { field: "receiptLanguage" } };
        },
      });
      await pick(panel, "ca-ES");
      await clickSave(panel);
      await expect.poll(() => field(panel).error).toBe(codeMessage(code));
      const chooser = field(panel);
      await chooser.updateComplete;
      const native = chooser.shadowRoot!.querySelector(".trigger")!;
      expect(native.getAttribute("aria-invalid")).toBe("true");
      expect(
        native
          .getAttribute("aria-describedby")!
          .split(" ")
          .map((id) => chooser.shadowRoot!.getElementById(id)!.textContent!.trim()),
      ).toEqual([codeMessage(code)]);
      await expect.poll(() => panel.shadowRoot!.activeElement).toBe(chooser);
      expect(chooser.value).toBe("ca-ES");
      expect(native.textContent).toContain("Catalan");
      expect(panel.shadowRoot!.querySelector("[role=status]")).toBeNull();
      expect(save(panel).disabled).toBe(false);
      expect(panel.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(t("form.fix_fields"));
      expect(writes).toEqual(["ca-ES"]);
      await pick(panel, "gl-ES");
      expect(field(panel).error).toBe("");
      await chooser.updateComplete;
      expect(native.getAttribute("aria-invalid")).toBe("false");
      expect(panel.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
    },
  );
  it("puts a request refusal only below the form and keeps it through read recovery", async () => {
    let failing = false;
    const { panel, liveData } = await mount(original, {
      getReceiptLanguage: async () => {
        if (failing) throw { code: "management.failed" };
        return structuredClone(original);
      },
      putReceiptLanguage: async () => {
        throw { code: "management.failed" };
      },
    });
    await pick(panel, "ca-ES");
    await clickSave(panel);
    const sentence = codeMessage("management.failed");
    await expect
      .poll(() => panel.shadowRoot!.querySelector("wt-form-actions")!.error)
      .toBe(sentence);
    expect(field(panel).error).toBe("");
    failing = true;
    liveData.invalidate([{ type: "locations" }]);
    await expect
      .poll(() => panel.shadowRoot!.querySelector("[data-test=language-load-error]"))
      .toBeTruthy();
    failing = false;
    liveData.invalidate([{ type: "locations" }]);
    await expect
      .poll(() => panel.shadowRoot!.querySelector("[data-test=language-load-error]"))
      .toBeNull();
    expect(panel.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(sentence);
    expect(field(panel).value).toBe("ca-ES");
  });
  it("preserves a staged choice across live reads and reconnect, then adopts a clean change", async () => {
    let stored = structuredClone(original);
    let reads = 0;
    const { panel, liveData } = await mount(original, {
      getReceiptLanguage: async () => {
        reads++;
        return structuredClone(stored);
      },
    });
    await pick(panel, "ca-ES");
    stored = { ...stored, language: "gl-ES" };
    liveData.invalidate([{ type: "locations" }]);
    await expect.poll(() => reads).toBe(2);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await vi.waitFor(() => expect(field(panel).value).toBe("ca-ES"));
    await reattachAfterDetachedUpdate(panel);
    expect(field(panel).value).toBe("ca-ES");
    expect(unload()).toBe(true);
    await pick(panel, "es-ES");
    expect(unload()).toBe(false);
    liveData.invalidate([{ type: "locations" }]);
    await expect.poll(() => field(panel).value).toBe("gl-ES");
    expect(unload()).toBe(false);
  });
  it("keeps a newer delivered pick dirty after an in-flight save accepts its submitted value", async () => {
    const pending = deferred<void>();
    const { panel, writes } = await mount(original, { putReceiptLanguage: () => pending.promise });
    await pick(panel, "ca-ES");
    await clickSave(panel);
    expect(save(panel).disabled).toBe(true);
    expect(field(panel).disabled).toBe(true);
    await pick(panel, "gl-ES");
    pending.resolve();
    await expect.poll(() => save(panel).loading).toBe(false);
    expect(field(panel).value).toBe("gl-ES");
    expect(save(panel).disabled).toBe(false);
    expect(writes).toEqual(["ca-ES"]);
    expect(unload()).toBe(true);
    await pick(panel, "ca-ES");
    expect(unload()).toBe(false);
  });
  it("ignores a stale load begun before a successful save", async () => {
    const pending = deferred<ReceiptLanguage>();
    let reads = 0;
    const { panel, liveData } = await mount(original, {
      getReceiptLanguage: () =>
        ++reads === 1 ? Promise.resolve(structuredClone(original)) : pending.promise,
    });
    liveData.invalidate([{ type: "locations" }]);
    await expect.poll(() => reads).toBe(2);
    await pick(panel, "ca-ES");
    await clickSave(panel);
    await expect.poll(() => save(panel).loading).toBe(false);
    pending.resolve(structuredClone(original));
    await pending.promise;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await vi.waitFor(() => expect(field(panel).value).toBe("ca-ES"));
    expect(unload()).toBe(false);
  });
  it.each(["success", "refusal"])(
    "ignores a departed card's late %s when reconnected",
    async (answer) => {
      const pending = deferred<void>();
      const { panel } = await mount(original, { putReceiptLanguage: () => pending.promise });
      await pick(panel, "ca-ES");
      await clickSave(panel);
      await reattachAfterDetachedUpdate(panel);
      await pick(panel, "gl-ES");
      if (answer === "success") pending.resolve();
      else pending.reject({ code: "management.failed" });
      await pending.promise.catch(() => {});
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await vi.waitFor(() => expect(save(panel).loading).toBe(false));
      expect(field(panel).value).toBe("gl-ES");
      expect(panel.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
      expect(panel.shadowRoot!.querySelector("[role=status]")).toBeNull();
      expect(unload()).toBe(true);
      await pick(panel, "es-ES");
      expect(unload()).toBe(false);
    },
  );
  it("retains a stored language outside the offered choices", async () => {
    const { panel } = await mount({ ...original, language: "en-GB" });
    expect(field(panel).value).toBe("en-GB");
    expect(field(panel).options.at(-1)).toEqual({ value: "en-GB", label: "English" });
    expect(save(panel).disabled).toBe(true);
    expect(panel.shadowRoot!.querySelector("[data-test=receipt-language-warning]")).toBeTruthy();
  });
  it("shows a fixed territory rule and updates its old stored language only on explicit action", async () => {
    const { panel, writes } = await mount({
      ...original,
      fixed: {
        locale: "ca-ES",
        reason: { en: "Required for this territory", es: "Obligatorio en este territorio" },
      },
    });
    expect(field(panel)).toBeNull();
    expect(save(panel)).toBeNull();
    expect(
      panel.shadowRoot!.querySelector("[data-test=receipt-language-value]")!.textContent!.trim(),
    ).toBe("Spanish");
    const action = panel.shadowRoot!.querySelector<WtButton>("[data-test=use-fixed-language]")!;
    await action.updateComplete;
    expect(action.variant).toBe("primary");
    await userEvent.click(page.elementLocator(action.shadowRoot!.querySelector("button")!));
    await expect
      .poll(() => panel.shadowRoot!.querySelector("[data-test=use-fixed-language]"))
      .toBeNull();
    expect(writes).toEqual(["ca-ES"]);
    expect(
      panel.shadowRoot!.querySelector("[data-test=receipt-language-value]")!.textContent!.trim(),
    ).toBe("Catalan");
  });
  it("a fixed-rule live update retires a staged choice and its dirty state", async () => {
    let stored = structuredClone(original);
    const { panel, liveData } = await mount(original, {
      getReceiptLanguage: async () => structuredClone(stored),
    });
    await pick(panel, "gl-ES");
    stored = { ...stored, fixed: { locale: "ca-ES", reason: { en: "Territory" } } };
    liveData.invalidate([{ type: "locations" }]);
    await expect.poll(() => field(panel)).toBeNull();
    expect(unload()).toBe(false);
  });
});
