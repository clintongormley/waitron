import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillReaderPicker } from "./reader-picker.js";
import type { ReaderOption } from "./reader-picker.js";

const readers: ReaderOption[] = [
  { id: "r1", name: "Front counter", provider: "stripe_terminal" },
  { id: "r2", name: "Bar", provider: "sumup_cloud", online: false },
];

const query = (el: TillReaderPicker, selector: string) => el.shadowRoot!.querySelector(selector);
const click = (el: TillReaderPicker, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();

afterEach(cleanupWidgets);

describe("till-reader-picker", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-reader-picker")).toBeDefined();
  });

  it("renders every active reader by name", async () => {
    const { el } = await mountWidget<TillReaderPicker>("till-reader-picker", { readers });
    expect(el.shadowRoot!.textContent).toContain("Front counter");
    expect(el.shadowRoot!.textContent).toContain("Bar");
  });

  it("marks a reader shown offline, but leaves it selectable", async () => {
    const { el } = await mountWidget<TillReaderPicker>("till-reader-picker", { readers });
    const offlineOption = query(el, "[data-test=reader-r2]") as HTMLButtonElement;
    expect(offlineOption.textContent).toContain(t("reader_picker.offline"));
    expect(offlineOption.disabled).toBe(false);

    const spy = vi.fn();
    el.addEventListener("reader-chosen", (e) => spy((e as CustomEvent).detail));
    click(el, "[data-test=reader-r2]");
    expect(spy).toHaveBeenCalledWith({ readerId: "r2" });
  });

  it("does not mark an online (or status-unknown) reader offline", async () => {
    const { el } = await mountWidget<TillReaderPicker>("till-reader-picker", { readers });
    expect(query(el, "[data-test=reader-r1-offline]")).toBeNull();
    expect(query(el, "[data-test=reader-r2-offline]")).not.toBeNull();
  });

  it("choosing a reader emits reader-chosen with its id", async () => {
    const { el } = await mountWidget<TillReaderPicker>("till-reader-picker", { readers });
    const spy = vi.fn();
    el.addEventListener("reader-chosen", (e) => spy((e as CustomEvent).detail));
    click(el, "[data-test=reader-r1]");
    expect(spy).toHaveBeenCalledWith({ readerId: "r1" });
  });

  it("marks the currently-selected reader via aria-checked", async () => {
    const { el } = await mountWidget<TillReaderPicker>("till-reader-picker", {
      readers,
      selectedReaderId: "r2",
    });
    expect(
      (query(el, "[data-test=reader-r1]") as HTMLButtonElement).getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      (query(el, "[data-test=reader-r2]") as HTMLButtonElement).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("shows an empty-state message when there are no active readers", async () => {
    const { el } = await mountWidget<TillReaderPicker>("till-reader-picker", { readers: [] });
    expect(el.shadowRoot!.textContent).toContain(t("reader_picker.empty"));
    expect(query(el, "[role=menu]")).toBeNull();
  });

  it("emits reader-picker-cancel on Cancel, choosing nothing", async () => {
    const { el } = await mountWidget<TillReaderPicker>("till-reader-picker", { readers });
    const chosen = vi.fn();
    const cancelled = vi.fn();
    el.addEventListener("reader-chosen", chosen);
    el.addEventListener("reader-picker-cancel", cancelled);
    click(el, ".cancel");
    expect(cancelled).toHaveBeenCalledOnce();
    expect(chosen).not.toHaveBeenCalled();
  });
});
