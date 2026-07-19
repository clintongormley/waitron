import { expect, test, afterEach } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "./wt-dialog.js";

afterEach(cleanup);

type Openable = HTMLElement & { open: boolean; updateComplete: Promise<unknown> };

test("is closed by default", async () => {
  const el = await mount("<wt-dialog>body</wt-dialog>");
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  expect(dialog.open).toBe(false);
});

test("opens when the open property is set", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  expect(dialog.open).toBe(true);
});

test("renders the heading", async () => {
  const el = await mount('<wt-dialog heading="Anular venta">body</wt-dialog>');
  expect(el.shadowRoot!.querySelector("h2")?.textContent?.trim()).toBe("Anular venta");
});

test("associates the heading with the dialog so it has an accessible name", async () => {
  const el = await mount('<wt-dialog heading="Anular venta">body</wt-dialog>');
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  const heading = el.shadowRoot!.querySelector("h2")!;
  expect(heading.id).not.toBe("");
  // Pins down the actual "wt-dialog-heading-N" shape, not just non-emptiness: uniqueId() always
  // appends a "-N" counter suffix, so a mutant that empties out just the "wt-dialog-heading"
  // prefix argument still produces a non-empty id (e.g. "-3") and would slip past a bare
  // `.not.toBe("")` check.
  expect(heading.id).toMatch(/^wt-dialog-heading-\d+$/);
  expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
});

test("declares an explicit dialog role, not just the native element's implicit one", async () => {
  // A native <dialog> already gets an implicit ARIA role of "dialog" once shown modally, so this
  // looks redundant — but it isn't purely decorative. axe-core's "aria-dialog-name" rule (the one
  // that actually verifies aria-labelledby/aria-label above) only runs against elements carrying
  // an *explicit* role="dialog"/"alertdialog" attribute; it does not infer the implicit role of a
  // bare <dialog>. Confirmed empirically: with this attribute removed, deleting
  // aria-labelledby/aria-label from a dialog produced zero axe violations, even though the dialog
  // was left with no accessible name at all — see wt-dialog.a11y.test.ts and
  // docs/developers/design-system.md. Losing this attribute silently blinds that test.
  const el = await mount('<wt-dialog heading="Anular venta">body</wt-dialog>');
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  expect(dialog.getAttribute("role")).toBe("dialog");
});

test("falls back to a forwarded aria-label when there is no heading", async () => {
  const el = await mount('<wt-dialog aria-label="Cerrar sesión">body</wt-dialog>');
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  expect(dialog.getAttribute("aria-label")).toBe("Cerrar sesión");
  expect(dialog.hasAttribute("aria-labelledby")).toBe(false);
});

test("emits wt-close when the native dialog closes", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;

  const closed = new Promise<void>((resolve) => {
    el.addEventListener("wt-close", () => resolve(), { once: true });
  });

  el.shadowRoot!.querySelector("dialog")!.close();
  await closed; // will hang/time out if wt-close never fires — a real signal either way
});

test("wt-close bubbles and crosses shadow boundaries, so an ancestor outside a wrapping shadow root receives it", async () => {
  // See wt-input.test.ts's identical-purpose test for why the nested-shadow-root + document
  // listener is required to make bubbles and composed both load-bearing (a light-DOM mount()
  // can't distinguish "composed: false" from "composed: true" at all).
  const el = (await mountInShadowRoot("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;

  const closed = new Promise<void>((resolve) => {
    document.addEventListener("wt-close", () => resolve(), { once: true });
  });

  el.shadowRoot!.querySelector("dialog")!.close();
  await closed; // will hang/time out if wt-close never reaches document — a real signal either way
});

test("setting open = false closes the dialog via the reactive property path", async () => {
  // Distinct from "emits wt-close when the native dialog closes" above: that test only exercises
  // onClose()'s own path (native <dialog> close event -> this.open = false). This drives the
  // reverse direction — setting `open = false` directly — which is what updated()'s
  // `if (!this.open && this.dialog.open) this.dialog.close()` guard exists for, and which no
  // other test in this file reaches.
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  expect(dialog.open).toBe(true);

  el.open = false;
  await el.updateComplete;
  expect(dialog.open).toBe(false);
});

test("opens as a modal (top layer, not just visible)", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  expect(dialog.matches(":modal")).toBe(true);
});

test("does not render a footer bar when no footer content is provided", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;
  const footer = el.shadowRoot!.querySelector(".footer")!;
  expect(footer.getBoundingClientRect().height).toBe(0);
});

test("renders a footer bar when footer content is provided", async () => {
  const el = (await mount('<wt-dialog><button slot="footer">OK</button></wt-dialog>')) as Openable;
  el.open = true;
  await el.updateComplete;
  const footer = el.shadowRoot!.querySelector(".footer")!;
  expect(footer.getBoundingClientRect().height).toBeGreaterThan(0);
});

test("paints from the raised surface token", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;
  host.style.setProperty("--wt-color-surface-raised", "rgb(30, 31, 32)");
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  expect(getComputedStyle(dialog).backgroundColor).toBe("rgb(30, 31, 32)");
});

test("paints its border from the border token", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;
  host.style.setProperty("--wt-color-border", "rgb(20, 21, 22)");
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  expect(getComputedStyle(dialog).borderColor).toBe("rgb(20, 21, 22)");
});

test("paints its shadow from the shadow-2 token", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;
  host.style.setProperty("--wt-shadow-2", "1px 2px 3px 4px rgb(9, 10, 11)");
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  expect(getComputedStyle(dialog).boxShadow).toBe("rgb(9, 10, 11) 1px 2px 3px 4px");
});

test("backdrop paints from the scrim token", async () => {
  // The backdrop pseudo-element only exists once the dialog is a genuine
  // modal (showModal(), not just `open`), so this must open it first.
  // getComputedStyle(el, "::backdrop") is a real, working read in this
  // browser-mode (Playwright/Chromium) test setup — confirmed empirically
  // before writing this test.
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;
  host.style.setProperty("--wt-color-scrim", "rgb(9, 10, 11)");
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  expect(getComputedStyle(dialog, "::backdrop").backgroundColor).toBe("rgb(9, 10, 11)");
});
