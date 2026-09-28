import { afterEach, describe, expect, it } from "vitest";
import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import "@waitron/ui/src/components/wt-dialog.js";
import { dialogOpenUnder, trackDialog } from "./track-dialog.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

@customElement("test-tracked-dialog")
class TestTrackedDialog extends LitElement {
  @property({ type: Boolean }) shown = false;
  @property({ type: Boolean }) drawn = true;

  override render() {
    return this.drawn
      ? html`<wt-dialog ${trackDialog()} .open=${this.shown} aria-label="Test">x</wt-dialog>`
      : nothing;
  }
}

/** Holds a tracked dialog one shadow root further down. */
@customElement("test-tracked-dialog-outer")
class TestTrackedDialogOuter extends LitElement {
  override render() {
    return html`<test-tracked-dialog></test-tracked-dialog>`;
  }
}

afterEach(cleanupWidgets);

async function mounted(): Promise<{ el: TestTrackedDialog; host: HTMLElement }> {
  return mountWidget<TestTrackedDialog>("test-tracked-dialog", {});
}

async function set(el: TestTrackedDialog, props: Partial<TestTrackedDialog>): Promise<void> {
  Object.assign(el, props);
  await el.updateComplete;
}

describe("dialogOpenUnder", () => {
  it("is false while a drawn dialog is closed, and true once it opens", async () => {
    const { el, host } = await mounted();
    expect(dialogOpenUnder(host)).toBe(false);

    await set(el, { shown: true });

    expect(dialogOpenUnder(host)).toBe(true);
    expect(dialogOpenUnder(el.shadowRoot!)).toBe(true);
  });

  it("is false once an open dialog is no longer drawn, or its element leaves the page", async () => {
    const { el, host } = await mounted();
    await set(el, { shown: true });

    await set(el, { drawn: false });
    expect(dialogOpenUnder(host)).toBe(false);

    await set(el, { drawn: true });
    expect(dialogOpenUnder(host)).toBe(true);
    el.remove();
    expect(dialogOpenUnder(host)).toBe(false);
  });

  it("counts a dialog again when its element comes back to the page", async () => {
    const { el, host } = await mounted();
    await set(el, { shown: true });
    el.remove();

    host.appendChild(el);

    expect(dialogOpenUnder(host)).toBe(true);
  });

  it("finds a dialog through nested shadow roots, and not under another root", async () => {
    const { el: outer, host } = await mountWidget<TestTrackedDialogOuter>(
      "test-tracked-dialog-outer",
      {},
    );
    const { host: elsewhere } = await mounted();
    const inner = outer.shadowRoot!.querySelector<TestTrackedDialog>("test-tracked-dialog")!;
    await set(inner, { shown: true });

    expect(dialogOpenUnder(host)).toBe(true);
    expect(dialogOpenUnder(elsewhere)).toBe(false);
  });
});

describe("every dialog the till draws is tracked", () => {
  const sources = import.meta.glob(["../**/*.ts", "!../**/*.test.ts"], {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  it("reads the till's sources, dialogs among them", () => {
    const withDialogs = Object.entries(sources).filter(([, text]) => text.includes("<wt-dialog"));
    expect(withDialogs.map(([path]) => path)).toContain("../screens/till-table-order-screen.ts");
  });

  it("puts trackDialog() first on each wt-dialog, wt-modal and dialog tag", () => {
    const untracked = Object.entries(sources).flatMap(([path, text]) =>
      [...text.matchAll(/<(wt-dialog|wt-modal|dialog)(?=[\s>])(?!\s+\$\{trackDialog\(\)\})/g)].map(
        (match) => `${path}: <${match[1]}`,
      ),
    );
    expect(untracked).toEqual([]);
  });
});
