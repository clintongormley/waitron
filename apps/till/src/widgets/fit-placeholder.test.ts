import { afterEach, describe, expect, it, vi } from "vitest";
import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import "@waitron/ui/src/components/wt-input.js";
import { TABLE_SEPARATOR } from "@waitron/shared";
import { cleanupWidgets, drawn, measured, mountWidget } from "./test-helpers.js";
import { PlaceholderFit, fitPlaceholder } from "./fit-placeholder.js";

@customElement("placeholder-fit-probe")
class PlaceholderFitProbe extends LitElement {
  @property() text = "";
  @property({ type: Boolean }) showField = true;
  readonly fit = new PlaceholderFit(this, () => this.text, TABLE_SEPARATOR);

  override render() {
    return this.showField
      ? html`<wt-input style="width: 160px" .placeholder=${this.fit.placeholder}></wt-input>`
      : nothing;
  }
}

afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
});

/** The `loadingdone` listeners on `document.fonts`, and the resize observers not disconnected. */
function watchAttachments() {
  const fontListeners = new Set<unknown>();
  const observing = new Map<ResizeObserver, Element[]>();
  const fonts = document.fonts;
  const add = fonts.addEventListener.bind(fonts);
  const remove = fonts.removeEventListener.bind(fonts);
  vi.spyOn(fonts, "addEventListener").mockImplementation((type, listener, options) => {
    if (type === "loadingdone") fontListeners.add(listener);
    add(type, listener, options);
  });
  vi.spyOn(fonts, "removeEventListener").mockImplementation((type, listener, options) => {
    if (type === "loadingdone") fontListeners.delete(listener);
    remove(type, listener, options);
  });
  const { observe, disconnect } = ResizeObserver.prototype;
  vi.spyOn(ResizeObserver.prototype, "observe").mockImplementation(function (
    this: ResizeObserver,
    target,
    options,
  ) {
    observing.set(this, [...(observing.get(this) ?? []), target]);
    observe.call(this, target, options);
  });
  vi.spyOn(ResizeObserver.prototype, "disconnect").mockImplementation(function (
    this: ResizeObserver,
  ) {
    observing.delete(this);
    disconnect.call(this);
  });
  return {
    fontListeners: () => fontListeners.size,
    observersOf: (target: Element) =>
      [...observing.values()].filter((targets) => targets.includes(target)).length,
  };
}

describe("fitPlaceholder, measuring one unit per character", () => {
  const measure = (text: string) => text.length;

  it("keeps text that fits exactly as it is", () => {
    expect(fitPlaceholder("Aa, Bb", 6, measure)).toBe("Aa, Bb");
  });

  it("keeps as many whole names as fit, then an ellipsis", () => {
    expect(fitPlaceholder("Aa, Bb, Cc", 9, measure)).toBe("Aa, Bb, …");
    expect(fitPlaceholder("Aa, Bb, Cc", 8, measure)).toBe("Aa, …");
  });

  it("cuts the first name by characters when not even it fits beside the ellipsis", () => {
    expect(fitPlaceholder("Abcdef, Gh", 4, measure)).toBe("Abc…");
    expect(fitPlaceholder("Wwwwwwww", 5, measure)).toBe("Wwww…");
  });

  it("drops a space left before the ellipsis", () => {
    expect(fitPlaceholder("Ab cdef", 4, measure)).toBe("Ab…");
  });

  it("cuts between whole characters, never inside an emoji", () => {
    const chef = "\u{1F469}\u200D\u{1F373}";
    expect(fitPlaceholder(chef.repeat(3), 8, measure)).toBe(`${chef}…`);
  });

  it("cuts between whole characters, never between a letter and its accent", () => {
    expect(fitPlaceholder("e\u0301e\u0301e\u0301", 4, measure)).toBe("e\u0301…");
  });

  it("shows the ellipsis alone when no character fits", () => {
    expect(fitPlaceholder("Ww", 0, measure)).toBe("…");
  });

  it("splits on the separator it is given", () => {
    expect(fitPlaceholder("Aa+Bb+Cc", 7, measure, "+")).toBe("Aa+Bb+…");
    expect(fitPlaceholder("Aa+Bb+Cc", 6, measure, "+")).toBe("Aa+…");
  });
});

describe("PlaceholderFit", () => {
  it("leaves no font listener or resize observer behind when removed with an update queued", async () => {
    const attached = watchAttachments();
    const { el, host } = await mountWidget<PlaceholderFitProbe>("placeholder-fit-probe", {
      text: "Mesa 1",
    });
    const field = el.shadowRoot!.querySelector("wt-input")!;
    expect(attached.fontListeners()).toBe(1);
    expect(attached.observersOf(field)).toBe(1);

    el.text = "Mesa 2";
    host.remove();
    await el.updateComplete;

    expect(attached.fontListeners()).toBe(0);
    expect(attached.observersOf(field)).toBe(0);
  });

  it("listens for fonts and watches the field again when its host is put back", async () => {
    const attached = watchAttachments();
    const { el, host } = await mountWidget<PlaceholderFitProbe>("placeholder-fit-probe", {
      text: "Mesa 1",
    });
    const field = el.shadowRoot!.querySelector("wt-input")!;

    host.remove();
    document.body.append(host);
    await el.updateComplete;
    await measured();
    await el.updateComplete;

    expect(attached.fontListeners()).toBe(1);
    expect(attached.observersOf(field)).toBe(1);
  });

  it("fits the placeholder to a field first drawn on a later update", async () => {
    const text = "Counter 1, Counter 2, Counter 3, Counter 4";
    const { el } = await mountWidget<PlaceholderFitProbe>("placeholder-fit-probe", {
      text,
      showField: false,
    });
    const errors: string[] = [];
    const record = (event: ErrorEvent) => errors.push(event.message);
    addEventListener("error", record);
    try {
      document.fonts.dispatchEvent(new Event("loadingdone"));
    } finally {
      removeEventListener("error", record);
    }
    expect(errors).toEqual([]);

    el.showField = true;
    await el.updateComplete;
    await measured();
    await el.updateComplete;

    const shown = drawn(el);
    expect(shown.placeholder).toMatch(/^Counter 1, .*…$/);
    expect(shown.placeholder).not.toBe(text);
    expect(shown.width(shown.placeholder)).toBeLessThanOrEqual(shown.textBox);
  });
});
