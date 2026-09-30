import { expect, test, afterEach, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, formMessageOf, host, mount, mountInShadowRoot } from "../test-helpers.js";
import { WtDialog } from "./wt-dialog.js";
import "./wt-form-actions.js";
import "./wt-input.js";

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

/**
 * A real key press, then a timer rather than `closeReportsDelivered`: with that helper's throwaway
 * dialog between presses, Chromium 153 let every Escape be refused and a dialog without `closedby`
 * passed the repeated-Escape tests below.
 */
async function pressEscape(): Promise<void> {
  await userEvent.keyboard("{Escape}");
  await new Promise((resolve) => setTimeout(resolve, 50));
}

test("closes on a real Escape press when dismissible", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable;
  el.open = true;
  await el.updateComplete;
  const closes = vi.fn();
  el.addEventListener("wt-close", closes);

  await pressEscape();

  expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(false);
  expect(el.open).toBe(false);
  expect(closes).toHaveBeenCalledOnce();
});

test("stays open through repeated Escape presses when dismissible is off", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable & { dismissible: boolean };
  el.dismissible = false;
  el.open = true;
  await el.updateComplete;
  const closes = vi.fn();
  el.addEventListener("wt-close", closes);
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  // Never shut, rather than shut and shown again.
  const nativeCloses = vi.fn();
  dialog.addEventListener("close", nativeCloses);

  for (let press = 1; press <= 3; press += 1) {
    await pressEscape();
    expect(dialog.open, `after Escape ${press}`).toBe(true);
  }
  expect(el.open).toBe(true);
  expect(closes).not.toHaveBeenCalled();
  expect(nativeCloses).not.toHaveBeenCalled();
});

test("stays open through repeated Escape presses once dismissible is turned off while open", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable & { dismissible: boolean };
  el.open = true;
  await el.updateComplete;
  el.dismissible = false;
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  const nativeCloses = vi.fn();
  dialog.addEventListener("close", nativeCloses);

  for (let press = 1; press <= 3; press += 1) {
    await pressEscape();
    expect(dialog.open, `after Escape ${press}`).toBe(true);
  }
  expect(nativeCloses).not.toHaveBeenCalled();

  el.dismissible = true;
  await el.updateComplete;
  await pressEscape();
  expect(dialog.open).toBe(false);
});

test("closes, and reports it, when its caller shuts it while dismissible is off", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable & { dismissible: boolean };
  el.dismissible = false;
  el.open = true;
  await el.updateComplete;
  const closes = vi.fn();
  el.addEventListener("wt-close", closes);

  el.open = false;
  await el.updateComplete;
  await closeReportsDelivered();

  expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(false);
  expect(closes).toHaveBeenCalledOnce();
});

test("reopens, and reports no close, when shut behind its back while dismissible is off", async () => {
  const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable & { dismissible: boolean };
  el.dismissible = false;
  el.open = true;
  await el.updateComplete;
  const closes = vi.fn();
  el.addEventListener("wt-close", closes);
  const dialog = el.shadowRoot!.querySelector("dialog")!;

  dialog.close();
  await closeReportsDelivered();
  await el.updateComplete;

  expect(dialog.open).toBe(true);
  expect(dialog.matches(":modal")).toBe(true);
  expect(el.open).toBe(true);
  expect(closes).not.toHaveBeenCalled();
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

test("shows a message its footer actions already carry in its first render, not a second", async () => {
  const updated = vi.spyOn(WtDialog.prototype, "updated");
  try {
    const el = await mount(`<wt-dialog heading="Add passkey">
      <wt-form-actions slot="footer" error="This device already holds a passkey for your account.">
        <button>Save</button>
      </wt-form-actions>
    </wt-dialog>`);
    expect(el.shadowRoot!.querySelector(".body > [data-error]")?.textContent).toBe(
      "This device already holds a passkey for your account.",
    );
    await new Promise((resolve) => setTimeout(resolve));
    expect(updated).toHaveBeenCalledTimes(1);
  } finally {
    updated.mockRestore();
  }
});

test("shows its footer actions' message at the end of the body, below the last field", async () => {
  const el = (await mount(`<wt-dialog heading="Add passkey">
    <label>Passkey name <input name="passkey-name" /></label>
    <wt-form-actions slot="footer"><button>Save</button></wt-form-actions>
  </wt-dialog>`)) as Openable;
  el.open = true;
  await el.updateComplete;
  const actions = el.querySelector("wt-form-actions")!;
  actions.error = "This device already holds a passkey for your account.";
  const message = (await formMessageOf(actions))!;

  const body = el.shadowRoot!.querySelector(".body")!;
  expect(message.textContent).toBe("This device already holds a passkey for your account.");
  expect(message.parentElement).toBe(body);
  expect(body.lastElementChild).toBe(message);
  const field = el.querySelector("input")!.getBoundingClientRect();
  expect(message.getBoundingClientRect().top).toBeGreaterThanOrEqual(field.bottom);
  expect(el.shadowRoot!.querySelector(".footer [data-error]")).toBeNull();
  expect(actions.shadowRoot!.querySelector("[data-error]")).toBeNull();
});

test.each([
  ["a field", '<label>Passkey name <input name="passkey-name" /></label>'],
  ["a wt-input", '<wt-input name="passkey-name" label="Passkey name"></wt-input>'],
])(
  "brings a message it already carries into view when it opens, though %s first in it takes focus",
  async (_, field) => {
    await page.viewport(390, 500);
    try {
      const el = (await mount(`<wt-dialog heading="Add passkey">
        ${field}
        <div style="height: 2000px">Long settings</div>
        <wt-form-actions slot="footer" error="This device already holds a passkey for your account.">
          <button>Save</button>
        </wt-form-actions>
      </wt-dialog>`)) as Openable;
      const message = (await formMessageOf(el.querySelector("wt-form-actions")!))!;
      el.open = true;
      await el.updateComplete;
      let focused = document.activeElement;
      while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
      expect(focused).toBeInstanceOf(HTMLInputElement);
      const dialog = el.shadowRoot!.querySelector("dialog")!;
      await vi.waitFor(() => expect(dialog.scrollTop).toBeGreaterThan(0));
      const frame = dialog.getBoundingClientRect();
      const box = message.getBoundingClientRect();
      expect(box.top).toBeGreaterThanOrEqual(frame.top - 1);
      expect(box.bottom).toBeLessThanOrEqual(frame.bottom + 1);
    } finally {
      await page.viewport(1280, 900);
    }
  },
);
