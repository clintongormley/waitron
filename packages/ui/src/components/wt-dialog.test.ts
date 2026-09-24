import { expect, test, afterEach, vi } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "./wt-dialog.js";

/**
 * Resolves once every `<dialog>` close already queued has been delivered. The browser reports a
 * close in a later task, which a zero-delay timer can run ahead of, so this closes a throwaway
 * dialog and waits for ITS report, queued behind the rest.
 */
async function closeReportsDelivered(): Promise<void> {
  const probe = document.createElement("dialog");
  document.body.append(probe);
  probe.show();
  const reported = new Promise((resolve) =>
    probe.addEventListener("close", resolve, { once: true }),
  );
  probe.close();
  await reported;
  probe.remove();
}

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
  const el = await mount('<wt-dialog heading="Void sale">body</wt-dialog>');
  expect(el.shadowRoot!.querySelector("h2")?.textContent?.trim()).toBe("Void sale");
});

test("associates the heading with the dialog so it has an accessible name", async () => {
  const el = await mount('<wt-dialog heading="Void sale">body</wt-dialog>');
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  const heading = el.shadowRoot!.querySelector("h2")!;
  expect(heading.id).not.toBe("");
  // The whole shape: uniqueId() appends "-N", so an emptied prefix still leaves a non-empty id.
  expect(heading.id).toMatch(/^wt-dialog-heading-\d+$/);
  expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
});

test("declares an explicit dialog role, not just the native element's implicit one", async () => {
  // axe's aria-dialog-name rule checks only an explicit role, so without it wt-dialog.a11y.test.ts
  // cannot see a dialog with no accessible name.
  const el = await mount('<wt-dialog heading="Void sale">body</wt-dialog>');
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  expect(dialog.getAttribute("role")).toBe("dialog");
});

test("falls back to a forwarded aria-label when there is no heading", async () => {
  const el = await mount('<wt-dialog aria-label="Log out">body</wt-dialog>');
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  expect(dialog.getAttribute("aria-label")).toBe("Log out");
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
  // ::backdrop exists only once the dialog is modal.
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;
  host.style.setProperty("--wt-color-scrim", "rgb(9, 10, 11)");
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  expect(getComputedStyle(dialog, "::backdrop").backgroundColor).toBe("rgb(9, 10, 11)");
});

test("closes on Escape by default", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  // A cancel that nobody prevents is what the browser turns into a close.
  const cancel = new Event("cancel", { cancelable: true });
  dialog.dispatchEvent(cancel);
  expect(cancel.defaultPrevented).toBe(false);
});

test("refuses Escape when dismissible is off", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable & { dismissible: boolean };
  el.dismissible = false;
  el.open = true;
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;
  const cancel = new Event("cancel", { cancelable: true });
  dialog.dispatchEvent(cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(el.open).toBe(true);
});

test("draws a divider above the footer only when there is footer content", async () => {
  const bare = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  bare.open = true;
  await bare.updateComplete;
  expect(getComputedStyle(bare.shadowRoot!.querySelector(".footer")!).borderTopWidth).toBe("0px");

  const withFooter = (await mount(
    '<wt-dialog><button slot="footer">OK</button></wt-dialog>',
  )) as Openable;
  withFooter.open = true;
  await withFooter.updateComplete;
  expect(getComputedStyle(withFooter.shadowRoot!.querySelector(".footer")!).borderTopWidth).toBe(
    "1px",
  );
});

test("starts drawing the divider when footer content arrives after the dialog is open", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;
  const footer = el.shadowRoot!.querySelector(".footer")!;
  expect(getComputedStyle(footer).borderTopWidth).toBe("0px");

  const button = document.createElement("button");
  button.slot = "footer";
  button.textContent = "OK";
  el.appendChild(button);

  await vi.waitFor(() => expect(getComputedStyle(footer).borderTopWidth).toBe("1px"));
});

test("ignores a forwarded footer slot that has nothing in it", async () => {
  // A wrapping component can hand its own <slot name="footer"> through to wt-dialog. What counts
  // is the content that reaches the footer, not the slot element carrying it: an empty forwarded
  // slot must leave the dialog with no bar across its bottom.
  const wrapper = await mount("<div></div>");
  const shadow = wrapper.attachShadow({ mode: "open" });
  shadow.innerHTML = '<wt-dialog><slot name="footer" slot="footer"></slot>body</wt-dialog>';
  const el = shadow.firstElementChild as Openable;
  await el.updateComplete;
  expect(getComputedStyle(el.shadowRoot!.querySelector(".footer")!).borderTopWidth).toBe("0px");

  const filled = await mount("<div></div>");
  filled.innerHTML = '<button slot="footer">OK</button>';
  const filledShadow = filled.attachShadow({ mode: "open" });
  filledShadow.innerHTML = '<wt-dialog><slot name="footer" slot="footer"></slot>body</wt-dialog>';
  const filledDialog = filledShadow.firstElementChild as Openable;
  await filledDialog.updateComplete;
  expect(getComputedStyle(filledDialog.shadowRoot!.querySelector(".footer")!).borderTopWidth).toBe(
    "1px",
  );
});

test("adds an aria-label only when there is a label to add and no heading", async () => {
  const plain = await mount("<wt-dialog>body</wt-dialog>");
  expect(plain.shadowRoot!.querySelector("dialog")!.hasAttribute("aria-label")).toBe(false);

  const headed = await mount('<wt-dialog heading="Void sale">body</wt-dialog>');
  expect(headed.shadowRoot!.querySelector("dialog")!.hasAttribute("aria-label")).toBe(false);

  const both = await mount('<wt-dialog heading="Void sale" aria-label="Log out">body</wt-dialog>');
  const dialog = both.shadowRoot!.querySelector("dialog")!;
  expect(dialog.hasAttribute("aria-label")).toBe(false);
  expect(dialog.getAttribute("aria-labelledby")).toBe(both.shadowRoot!.querySelector("h2")!.id);
});

test("emits wt-close once when the dialog is closed, not twice", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;
  const closes = vi.fn();
  el.addEventListener("wt-close", closes);

  const firstClose = new Promise<void>((resolve) => {
    el.addEventListener("wt-close", () => resolve(), { once: true });
  });
  el.shadowRoot!.querySelector("dialog")!.close();
  await firstClose;
  await el.updateComplete;
  // A dialog closed a second time reports it in a later task, so give the queue two turns before
  // counting.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(closes).toHaveBeenCalledTimes(1);
  expect(el.open).toBe(false);
});

test("stays open, and reports no close, when shut and reopened within one task", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;
  const closes = vi.fn();
  el.addEventListener("wt-close", closes);

  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  await closeReportsDelivered();

  expect(closes).not.toHaveBeenCalled();
  expect(el.open).toBe(true);
  expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(true);
});

test("stays shut when another property changes just after the dialog was closed", async () => {
  const el = (await mount('<wt-dialog heading="Void sale">body</wt-dialog>')) as Openable & {
    heading: string;
  };
  el.open = true;
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;

  // The native close event arrives in a later task, so for a moment the element still believes it
  // is open. A heading change in that window must not put the dialog back on screen.
  dialog.close();
  el.heading = "Void sale (2 items)";
  await el.updateComplete;

  expect(dialog.open).toBe(false);
  expect(dialog.matches(":modal")).toBe(false);
});
