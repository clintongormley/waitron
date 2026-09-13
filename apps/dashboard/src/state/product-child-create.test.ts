import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { ProductEditor } from "../widgets/product-editor.js";
import { ProductChildCreate } from "./product-child-create.js";

afterEach(cleanupWidgets);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function fixture() {
  const { el } = await mountWidget<ProductEditor>("dashboard-product-editor", {
    open: true,
    locales: ["en"],
  });
  const change = el.shadowRoot!.querySelector("[name=name-en]")!;
  change.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Dirty coffee" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  const loadError = vi.fn();
  const refresh = vi.fn(async () => {});
  const focus = vi.fn();
  const accept = vi.fn(
    (
      kind: "unit" | "category" | "modifier",
      value: { id: string; name: Record<string, string> },
    ) => {
      if (kind === "unit") el.units = [...el.units, value];
      if (kind === "category") el.categories = [...el.categories, value];
      if (kind === "modifier") el.modifiers = [...el.modifiers, value];
      el.selectRelated(kind, value.id);
    },
  );
  const controller = new ProductChildCreate(el, { accept, refresh, loadError, focus });
  return { el, controller, refresh, loadError, accept, focus };
}

it.each(["unit", "category", "modifier"] as const)(
  "keeps the dirty product after a durable %s create even if refresh fails",
  async (kind) => {
    const fx = await fixture();
    fx.controller.open(kind);
    fx.refresh.mockRejectedValueOnce(new Error("offline"));
    const saved = { id: crypto.randomUUID(), name: { en: "New choice" } };
    await fx.controller.submit(async () => saved);
    expect(fx.controller.kind).toBeNull();
    expect(fx.controller.error).toBeNull();
    expect(fx.accept).toHaveBeenCalledExactlyOnceWith(kind, saved);
    expect(fx.focus).toHaveBeenCalledWith(kind);
    expect(fx.loadError).toHaveBeenCalledOnce();
    expect(fx.el.currentValue.name).toEqual({ en: "Dirty coffee" });
    expect(
      kind === "unit"
        ? fx.el.currentValue.unitId
        : kind === "category"
          ? fx.el.currentValue.categoryIds[0]
          : fx.el.currentValue.modifierIds[0],
    ).toBe(saved.id);
  },
);

it("retains a failed child and drops a duplicate submit while the write is pending", async () => {
  const fx = await fixture();
  fx.controller.open("unit");
  const request = deferred<{ id: string; name: Record<string, string> }>();
  const write = vi.fn(() => request.promise);
  const first = fx.controller.submit(write);
  await fx.controller.submit(write);
  fx.controller.cancel();
  expect(write).toHaveBeenCalledOnce();
  expect(fx.controller.kind).toBe("unit");
  request.reject(new Error("Name already used"));
  await first;
  expect(fx.controller.kind).toBe("unit");
  expect(fx.controller.busy).toBe(false);
  expect(fx.controller.error).toEqual(new Error("Name already used"));
  expect(fx.accept).not.toHaveBeenCalled();
  fx.controller.cancel();
  await fx.el.updateComplete;
  expect(fx.controller.kind).toBeNull();
  expect(fx.el.currentValue.name).toEqual({ en: "Dirty coffee" });
});

it("does not attach a late write to a different product or release its child gate", async () => {
  const fx = await fixture();
  fx.controller.open("category");
  const request = deferred<{ id: string; name: Record<string, string> }>();
  const saving = fx.controller.submit(() => request.promise);
  fx.controller.reset();
  fx.controller.open("modifier");
  request.resolve({ id: crypto.randomUUID(), name: { en: "Old category" } });
  await saving;
  expect(fx.controller.kind).toBe("modifier");
  expect(fx.accept).not.toHaveBeenCalled();
  expect(fx.refresh).not.toHaveBeenCalled();
  expect(fx.focus).not.toHaveBeenCalled();
});

it("closes the child before refresh completes and ignores a late load error after switching product", async () => {
  const fx = await fixture();
  fx.controller.open("unit");
  const refreshing = deferred<void>();
  fx.refresh.mockReturnValueOnce(refreshing.promise);
  const saving = fx.controller.submit(async () => ({
    id: crypto.randomUUID(),
    name: { en: "Custom unit" },
  }));
  await expect.poll(() => fx.refresh.mock.calls.length).toBe(1);
  expect(fx.controller.kind).toBeNull();
  fx.controller.reset();
  fx.controller.open("category");
  refreshing.reject(new Error("Offline"));
  await saving;
  expect(fx.loadError).not.toHaveBeenCalled();
  expect(fx.controller.kind).toBe("category");
});
