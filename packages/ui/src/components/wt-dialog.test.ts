import { expect, test, afterEach, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { html, render } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { cleanup, formMessageOf, host, mount, mountInShadowRoot } from "../test-helpers.js";
import { setHelpMode } from "../help-mode.js";
import { WtDialog } from "./wt-dialog.js";
import type { WtHelpTooltip } from "./wt-help-tooltip.js";
import "./wt-button.js";
import "./wt-help-tooltip.js";
import "./wt-form-actions.js";
import "./wt-input.js";
import "./wt-modal.js";
import "./wt-row-actions.js";

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

/** The focused element, looked for through every shadow root on the way down. */
function deepActiveElement(): Element | null {
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  return focused;
}

/** Opens `el` with `focused` holding focus, runs `whileOpen`, closes it as `how` says, and resolves
 * once it reports the close. */
async function openAndClose(
  el: Openable,
  focused: HTMLElement,
  how: "Escape" | "open",
  whileOpen?: () => void,
): Promise<void> {
  focused.focus();
  expect(deepActiveElement()).toBe(focused);
  el.open = true;
  await el.updateComplete;
  expect(deepActiveElement()).not.toBe(focused);
  whileOpen?.();
  const closed = new Promise<void>((resolve) =>
    el.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  if (how === "Escape") await userEvent.keyboard("{Escape}");
  else el.open = false;
  await closed;
}

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

// The heading's --wt-space-3 below it collapses with the next block's top margin, as two touching
// vertical margins do, so the gap is the larger of the two.
test.each([
  ["a paragraph", "<p>This will create a corrective record.</p>"],
  ["a div", "<div>This will create a corrective record.</div>"],
])(
  "leaves the larger of --wt-space-3 and its top margin between the heading and a body starting with %s",
  async (_, body) => {
    const el = (await mount(`<wt-dialog heading="Void sale">${body}</wt-dialog>`)) as Openable;
    el.open = true;
    await el.updateComplete;
    const first = el.firstElementChild!;
    const expected = Math.max(
      parseFloat(getComputedStyle(el).getPropertyValue("--wt-space-3")),
      parseFloat(getComputedStyle(first).marginTop),
    );
    const heading = el.shadowRoot!.querySelector("h2")!.getBoundingClientRect();
    expect(first.getBoundingClientRect().top - heading.bottom).toBe(expected);
  },
);

test("leaves --wt-space-3 between the heading and its description, and the larger margin after it", async () => {
  const el = (await mount(
    '<wt-dialog heading="Leave" description="Your changes are unsaved."><p>Leave anyway?</p></wt-dialog>',
  )) as Openable;
  el.open = true;
  await el.updateComplete;
  const space3 = parseFloat(getComputedStyle(el).getPropertyValue("--wt-space-3"));
  const heading = el.shadowRoot!.querySelector("h2")!.getBoundingClientRect();
  const description = el.shadowRoot!.querySelector(".description")!.getBoundingClientRect();
  const first = el.firstElementChild!;
  expect(description.top - heading.bottom).toBe(space3);
  expect(first.getBoundingClientRect().top - description.bottom).toBe(
    Math.max(space3, parseFloat(getComputedStyle(first).marginTop)),
  );
});

test("wraps a long unbroken heading inside the dialog at phone width", async () => {
  await page.viewport(390, 844);
  try {
    const el = (await mount("<wt-dialog>body</wt-dialog>")) as Openable & { heading: string };
    el.heading = `Add variant to: ${"Tortilla".repeat(12)}`;
    el.open = true;
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector("dialog")!;
    const heading = el.shadowRoot!.querySelector("h2")!;
    expect(heading.textContent).toContain("TortillaTortilla");
    expect(dialog.getBoundingClientRect().width).toBeLessThanOrEqual(390);
    expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth);
  } finally {
    await page.viewport(1280, 900);
  }
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
  const closed = new Promise((resolve) => el.addEventListener("wt-close", resolve));

  await userEvent.keyboard("{Escape}");
  await closed;

  expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(false);
  expect(el.open).toBe(false);
  await closeReportsDelivered();
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
  const closed = new Promise((resolve) => el.addEventListener("wt-close", resolve));
  await userEvent.keyboard("{Escape}");
  await closed;
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
    expect(el.shadowRoot!.querySelector(".footer > [data-error]")?.textContent).toBe(
      "This device already holds a passkey for your account.",
    );
    await new Promise((resolve) => setTimeout(resolve));
    expect(updated).toHaveBeenCalledTimes(1);
  } finally {
    updated.mockRestore();
  }
});

test("shows its footer actions' message in the footer, on its own line above the buttons", async () => {
  const el = (await mount(`<wt-dialog heading="Add passkey">
    <label>Passkey name <input name="passkey-name" /></label>
    <wt-form-actions slot="footer"><button>Save</button></wt-form-actions>
  </wt-dialog>`)) as Openable;
  el.open = true;
  await el.updateComplete;
  const actions = el.querySelector("wt-form-actions")!;
  actions.error = "This device already holds a passkey for your account.";
  const message = (await formMessageOf(actions))!;

  const footer = el.shadowRoot!.querySelector(".footer")!;
  expect(message.textContent).toBe("This device already holds a passkey for your account.");
  expect(message.parentElement).toBe(footer);
  expect(footer.firstElementChild).toBe(message);
  expect(message.nextElementSibling!.querySelector('slot[name="footer"]')).not.toBeNull();
  const field = el.querySelector("input")!.getBoundingClientRect();
  const box = message.getBoundingClientRect();
  expect(box.top).toBeGreaterThanOrEqual(field.bottom);
  expect(box.bottom).toBeLessThanOrEqual(el.querySelector("button")!.getBoundingClientRect().top);
  expect(el.shadowRoot!.querySelector(".body [data-error]")).toBeNull();
  expect(actions.shadowRoot!.querySelector("[data-error]")).toBeNull();
});

test.each([
  ["a field", '<label>Passkey name <input name="passkey-name" /></label>'],
  ["a wt-input", '<wt-input name="passkey-name" label="Passkey name"></wt-input>'],
])(
  "shows a message it already carries in view when it opens, without scrolling the body, though %s first in it takes focus",
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
      expect(deepActiveElement()).toBeInstanceOf(HTMLInputElement);
      const body = el.shadowRoot!.querySelector(".body")!;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(body.scrollTop).toBe(0);
      const frame = el.shadowRoot!.querySelector("dialog")!.getBoundingClientRect();
      const box = message.getBoundingClientRect();
      expect(box.height).toBeGreaterThan(0);
      expect(box.top).toBeGreaterThanOrEqual(body.getBoundingClientRect().bottom);
      expect(box.bottom).toBeLessThanOrEqual(frame.bottom);
      expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
    } finally {
      await page.viewport(1280, 900);
    }
  },
);

const SAVE_OR_CANCEL = `<wt-form-actions slot="footer">
  <wt-button slot="cancel" variant="secondary">Cancel</wt-button>
  <wt-button>Save</wt-button>
</wt-form-actions>`;

/** Opens a dialog holding `body` above Cancel and Save, at a 390×700 window restored afterwards. */
async function openAtPhoneSize(body: string) {
  const before = [window.innerWidth, window.innerHeight] as const;
  await page.viewport(390, 700);
  onTestFinished(() => page.viewport(...before));
  const el = (await mount(
    `<wt-dialog heading="Edit order">${body}${SAVE_OR_CANCEL}</wt-dialog>`,
  )) as Openable;
  el.open = true;
  await el.updateComplete;
  const [cancel, save] = el.querySelectorAll("wt-button");
  await save!.updateComplete;
  const parts = el.shadowRoot!;
  return {
    el,
    dialog: parts.querySelector("dialog")!,
    body: parts.querySelector<HTMLElement>(".body")!,
    cancel: cancel!,
    save: save!,
  };
}

/** Whether Shift+Tab from Cancel lands on the body, the one place before the footer it could. */
async function bodyIsTabStop(el: HTMLElement, cancel: HTMLElement): Promise<boolean> {
  cancel.focus();
  expect(composedContainsFocus(cancel)).toBe(true);
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  return el.shadowRoot!.activeElement === el.shadowRoot!.querySelector(".body");
}

function composedContainsFocus(element: HTMLElement): boolean {
  const focused = deepActiveElement();
  for (let at: Node | null = focused; at; at = at instanceof ShadowRoot ? at.host : at.parentNode)
    if (at === element) return true;
  return false;
}

function frame(): Promise<unknown> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/** Cancel and Save lie inside the window and the dialog, and the dialog itself does not scroll. */
function expectFooterInView(dialog: HTMLDialogElement, cancel: HTMLElement, save: HTMLElement) {
  const frameBox = dialog.getBoundingClientRect();
  for (const [label, button] of [
    ["Cancel", cancel],
    ["Save", save],
  ] as const) {
    const box = button.getBoundingClientRect();
    expect(box.height, `${label} is drawn`).toBeGreaterThan(0);
    expect(box.bottom, `${label}: bottom in the window`).toBeLessThanOrEqual(window.innerHeight);
    expect(box.bottom, `${label}: bottom in the dialog`).toBeLessThanOrEqual(frameBox.bottom);
  }
  expect(dialog.scrollHeight, "the dialog itself scrolls").toBe(dialog.clientHeight);
}

test.each([
  ["a field", '<label>Note <input name="note" /></label>'],
  ["a wt-input", '<wt-input name="note" label="Note"></wt-input>'],
  ["nothing focusable", ""],
])(
  "scrolls a long body while the footer stays visible and stationary, with %s first",
  async (_, field) => {
    const { dialog, body, cancel, save } = await openAtPhoneSize(
      `${field}<div style="height: 1800px">Long order</div>`,
    );
    if (field) expect(deepActiveElement(), "opening focus").toBeInstanceOf(HTMLInputElement);
    else expect(deepActiveElement(), "opening focus").toBe(body);
    expectFooterInView(dialog, cancel, save);
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    const placed = () =>
      [cancel, save].flatMap((button) => {
        const box = button.getBoundingClientRect();
        return [box.top, box.bottom, box.left, box.right];
      });
    const before = placed();
    body.scrollTop = body.scrollHeight;
    await frame();
    expect(body.scrollTop).toBeGreaterThan(0);
    expect(placed()).toEqual(before);
    expect(dialog.scrollHeight).toBe(dialog.clientHeight);
  },
);

test("keeps hinted fields inside the body without scrolling the native dialog", async () => {
  const { el, dialog, body, cancel, save } = await openAtPhoneSize(
    '<div style="height: 1800px">Long order</div><wt-input name="note" label="Note" hint="Printed on the receipt"></wt-input>',
  );
  const field = el.querySelector("wt-input")!;
  await field.updateComplete;
  await frame();
  expectFooterInView(dialog, cancel, save);
  body.scrollTop = 0;
  const footer = el.shadowRoot!.querySelector(".footer")!;
  const before = footer.getBoundingClientRect().toJSON();
  field.shadowRoot!.querySelector(".hint")!.scrollIntoView({ block: "start" });
  await frame();
  expect(dialog.scrollTop).toBe(0);
  expect(footer.getBoundingClientRect().toJSON()).toEqual(before);
  expect(body.scrollTop).toBeGreaterThan(0);
  expectFooterInView(dialog, cancel, save);
});

test("paints a long dialog's surface and footer divider from their tokens", async () => {
  const { el, dialog } = await openAtPhoneSize('<div style="height: 1800px">Long order</div>');
  host.style.setProperty("--wt-color-surface-raised", "rgb(30, 31, 32)");
  host.style.setProperty("--wt-color-border", "rgb(20, 21, 22)");
  const footer = el.shadowRoot!.querySelector(".footer")!;
  expect(getComputedStyle(dialog).backgroundColor).toBe("rgb(30, 31, 32)");
  expect(getComputedStyle(footer).borderTopWidth).toBe("1px");
  expect(getComputedStyle(footer).borderTopColor).toBe("rgb(20, 21, 22)");
});

test("opens a long dialog that is open at its first render with focus on its first field", async () => {
  const before = [window.innerWidth, window.innerHeight] as const;
  await page.viewport(390, 700);
  onTestFinished(() => page.viewport(...before));
  const el = (await mount(
    `<wt-dialog heading="Edit order" open><label>Note <input name="note" /></label><div style="height: 1800px">Long order</div>${SAVE_OR_CANCEL}</wt-dialog>`,
  )) as Openable;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(deepActiveElement()).toBe(el.querySelector("input"));
});

test("keeps a short dialog fitted to its content", async () => {
  const el = (await mount(
    `<wt-dialog heading="Void sale">This will create a corrective record.${SAVE_OR_CANCEL}</wt-dialog>`,
  )) as Openable;
  el.open = true;
  await el.updateComplete;
  await el.querySelectorAll("wt-button")[1]!.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
  const footer = el.shadowRoot!.querySelector<HTMLElement>(".footer")!;
  const box = dialog.getBoundingClientRect();
  // A 1px border above and below.
  expect(box.height).toBeCloseTo(body.offsetHeight + footer.offsetHeight + 2, 0);
  expect(body.scrollHeight).toBe(body.clientHeight);
  expect(box.height).toBeLessThan(window.innerHeight / 2);
  expect(box.width).toBeLessThan(window.innerWidth / 2);
});

test("keeps the footer in view when the body outgrows the window after opening", async () => {
  const { el, dialog, body, cancel, save } = await openAtPhoneSize("<p>Loading lines</p>");
  expect(body.scrollHeight).toBe(body.clientHeight);
  expect(body.tabIndex, "a short body's tabIndex").toBe(-1);
  expect(await bodyIsTabStop(el, cancel), "a short body is a tab stop").toBe(false);
  const rows = Array.from({ length: 40 }, (_, index) => {
    const row = document.createElement("div");
    row.style.height = "48px";
    row.textContent = `Line ${index + 1}`;
    return row;
  });
  el.append(...rows);
  await frame();
  expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
  expectFooterInView(dialog, cancel, save);
  await vi.waitFor(() => expect(body.tabIndex, "an overflowing body's tabIndex").toBe(0));
  expect(await bodyIsTabStop(el, cancel), "an overflowing body is a tab stop").toBe(true);

  for (const row of rows) row.remove();
  await frame();
  expect(body.scrollHeight).toBe(body.clientHeight);
  await vi.waitFor(() => expect(body.tabIndex, "a body short again: tabIndex").toBe(-1));
  expect(await bodyIsTabStop(el, cancel), "a body short again is a tab stop").toBe(false);
});

/** Ways content inside a fixed-size wrapper grows and shrinks back, neither the body nor the
 * wrapper changing size. */
const insideWrapper = [
  [
    "a style change",
    (inner: HTMLElement) => (inner.style.height = "1800px"),
    (inner: HTMLElement) => (inner.style.height = ""),
  ],
  [
    "added content",
    (inner: HTMLElement) => {
      const added = document.createElement("div");
      added.style.height = "1800px";
      inner.append(added);
    },
    (inner: HTMLElement) => inner.lastElementChild!.remove(),
  ],
  [
    "a text change",
    (inner: HTMLElement) => (inner.firstChild!.textContent = "Line ".repeat(2000)),
    (inner: HTMLElement) => (inner.firstChild!.textContent = "Line"),
  ],
] as const;

test.each(insideWrapper)(
  "makes the body a tab stop when content grows by %s inside a fixed-height wrapper",
  async (_, grow, shrink) => {
    const { el, body } = await openAtPhoneSize(
      '<label>Note <input name="note" /></label><div style="height: 200px; width: 200px"><div style="min-height: 100px">Line</div></div>',
    );
    const field = el.querySelector("input")!;
    const inner = el.querySelector<HTMLElement>("div > div")!;
    expect(body.tabIndex, "before: tabIndex").toBe(-1);
    // The ResizeObserver's first reports, which arrive a frame after it starts watching, are past.
    await frame();
    await frame();
    grow(inner);
    await frame();
    expect(body.scrollHeight, "grown: scrollHeight").toBeGreaterThan(body.clientHeight);
    await vi.waitFor(() => expect(body.tabIndex, "grown: tabIndex").toBe(0));
    field.focus();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(el.shadowRoot!.activeElement, "Shift+Tab from the field").toBe(body);

    shrink(inner);
    await frame();
    expect(body.scrollHeight, "shrunk: scrollHeight").toBe(body.clientHeight);
    await vi.waitFor(() => expect(body.tabIndex, "shrunk: tabIndex").toBe(-1));
  },
);

test("still notices content growing inside a fixed-size wrapper after it is moved while open", async () => {
  const { el, body } = await openAtPhoneSize(
    '<div style="height: 200px; width: 200px"><div style="height: 100px">Line</div></div>',
  );
  const parent = el.parentNode!;
  el.remove();
  parent.append(el);
  await frame();
  await frame();
  expect(body.tabIndex, "before: tabIndex").toBe(-1);
  el.querySelector<HTMLElement>("div > div")!.style.height = "1800px";
  await frame();
  expect(body.scrollHeight, "grown: scrollHeight").toBeGreaterThan(body.clientHeight);
  await vi.waitFor(() => expect(body.tabIndex, "grown: tabIndex").toBe(0));
});

test.each(["Escape", "open", "removal"] as const)(
  "asks for one frame for many content changes while open, and none once closed by %s",
  async (how) => {
    const { el } = await openAtPhoneSize('<div style="height: 200px"><p>Line</p></div>');
    const inner = el.querySelector("p")!;
    const frames = vi.spyOn(window, "requestAnimationFrame");
    onTestFinished(() => frames.mockRestore());
    // Each awaited, so each reaches the observer in its own report.
    const change = async () => {
      inner.textContent = "Lines";
      await Promise.resolve();
      inner.style.color = "red";
      await Promise.resolve();
      inner.append(document.createElement("span"));
      await Promise.resolve();
    };
    await change();
    expect(frames, "while open").toHaveBeenCalledTimes(1);
    await frame();

    if (how === "removal") el.remove();
    else {
      const closed = new Promise((resolve) => el.addEventListener("wt-close", resolve));
      if (how === "Escape") await userEvent.keyboard("{Escape}");
      else el.open = false;
      await closed;
    }
    frames.mockClear();
    await change();
    expect(frames, "once closed").not.toHaveBeenCalled();
  },
);

test("names its body as a group after its heading only while the body is a tab stop", async () => {
  const { el, body } = await openAtPhoneSize("<p>Loading lines</p>");
  const located = page.elementLocator(body);
  for (const name of ["role", "aria-labelledby", "aria-label"])
    expect(body.getAttribute(name), `a short body's ${name}`).toBeNull();

  const long = document.createElement("div");
  long.style.height = "1800px";
  el.append(long);
  await vi.waitFor(() => expect(body.tabIndex, "an overflowing body's tabIndex").toBe(0));
  await expect.element(located).toHaveRole("group");
  await expect.element(located).toHaveAccessibleName("Edit order");

  long.remove();
  await vi.waitFor(() => expect(body.tabIndex, "a body short again: tabIndex").toBe(-1));
  for (const name of ["role", "aria-labelledby", "aria-label"])
    expect(body.getAttribute(name), `a body short again: ${name}`).toBeNull();
});

test("names an overflowing body after the dialog's own label when it has no heading", async () => {
  const before = [window.innerWidth, window.innerHeight] as const;
  await page.viewport(390, 700);
  onTestFinished(() => page.viewport(...before));
  const el = (await mount(
    '<wt-dialog aria-label="Edit order"><div style="height: 1800px">Long order</div></wt-dialog>',
  )) as Openable;
  el.open = true;
  await el.updateComplete;
  const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
  expect(body.tabIndex).toBe(0);
  await expect.element(page.elementLocator(body)).toHaveRole("group");
  await expect.element(page.elementLocator(body)).toHaveAccessibleName("Edit order");
});

test.each(["Escape", "open"] as const)(
  "closed by %s, hands focus back to what had it when it opened, not to the button that opened it",
  async (how) => {
    const el = (await mount(
      '<wt-dialog heading="Choose a unit"><button>Each</button></wt-dialog>',
    )) as Openable;
    const opener = document.createElement("button");
    opener.textContent = "Unit";
    const field = document.createElement("input");
    host.prepend(opener, field);
    // Pressed first, as a screen whose button opens the dialog only after focus has moved on.
    await userEvent.click(opener);
    await openAndClose(el, field, how);
    expect(deepActiveElement()).toBe(field);
  },
);

test.each(["Escape", "open"] as const)(
  "closed by %s, hands focus back into the shadow root that had it when it opened",
  async (how) => {
    const el = (await mount(
      '<wt-dialog heading="Choose a unit"><button>Each</button></wt-dialog>',
    )) as Openable;
    const screen = document.createElement("div");
    host.prepend(screen);
    const inner = document.createElement("button");
    screen.attachShadow({ mode: "open" }).append(inner);
    await openAndClose(el, inner, how);
    expect(deepActiveElement()).toBe(inner);
  },
);

type WithOpener = Openable & { opener: HTMLElement | null };

/** A dialog after a row of two buttons, the first to have focus at opening, with a button after the
 * dialog to name as its opener. */
async function scene() {
  const el = (await mount(
    '<wt-dialog heading="Choose a unit"><button>Each</button></wt-dialog>',
  )) as WithOpener;
  const row = document.createElement("div");
  row.innerHTML = "<button>Target</button><button>Nearby</button>";
  host.prepend(row);
  const opener = document.createElement("button");
  host.append(opener);
  const [target, nearby] = row.querySelectorAll("button");
  return { el, target: target!, nearby: nearby!, opener };
}

const lost = [
  ["removed", (button: HTMLButtonElement) => button.remove()],
  ["disabled", (button: HTMLButtonElement) => (button.disabled = true)],
  ["hidden", (button: HTMLButtonElement) => (button.hidden = true)],
] as const;
const closings = ["Escape", "open"] as const;
const lostByClosing = closings.flatMap((how) =>
  lost.map(([what, change]) => [how, what, change] as const),
);

test.each(lostByClosing)(
  "closed by %s with no opener, puts focus beside what had it at opening when that was %s",
  async (how, _, change) => {
    const { el, target, nearby } = await scene();
    await openAndClose(el, target, how, () => change(target));
    expect(deepActiveElement()).toBe(nearby);
  },
);

test.each(lostByClosing)(
  "closed by %s, puts focus on the opener when what had it at opening was %s",
  async (how, _, change) => {
    const { el, target, opener } = await scene();
    el.opener = opener;
    await openAndClose(el, target, how, () => change(target));
    expect(deepActiveElement()).toBe(opener);
  },
);

test.each(lostByClosing)(
  "closed by %s, puts focus beside what had it at opening when that and the opener were both %s",
  async (how, _, change) => {
    const { el, target, nearby, opener } = await scene();
    el.opener = opener;
    await openAndClose(el, target, how, () => {
      change(target);
      change(opener);
    });
    expect(deepActiveElement()).toBe(nearby);
  },
);

test.each(closings)(
  "closed by %s, hands focus back to what had it at opening, not to the opener, while that can take it",
  async (how) => {
    const { el, target, opener } = await scene();
    el.opener = opener;
    await openAndClose(el, target, how);
    expect(deepActiveElement()).toBe(target);
  },
);

test("looks beside what had focus at opening before looking further from it", async () => {
  const { el, target, nearby } = await scene();
  host.prepend(document.createElement("button"));
  await openAndClose(el, target, "open", () => (target.disabled = true));
  expect(deepActiveElement()).toBe(nearby);
});

test("looks beside what had focus at opening inside the shadow root that holds it", async () => {
  const { el } = await scene();
  const screen = document.createElement("div");
  host.prepend(screen);
  const [target, beside] = [document.createElement("button"), document.createElement("button")];
  screen.attachShadow({ mode: "open" }).append(target, beside);
  await openAndClose(el, target, "Escape", () => (target.disabled = true));
  expect(deepActiveElement()).toBe(beside);
});

test("accepts an opener that hands its focus on to an element in its shadow root", async () => {
  const { el, target } = await scene();
  const opener = document.createElement("div");
  const inner = document.createElement("button");
  opener.attachShadow({ mode: "open", delegatesFocus: true }).append(inner);
  host.append(opener);
  el.opener = opener;
  await openAndClose(el, target, "Escape", () => target.remove());
  expect(deepActiveElement()).toBe(inner);
});

test("puts focus near the dialog, inside a shadow root, when the page body had it at opening", async () => {
  const el = (await mount(
    '<wt-dialog heading="Choose a unit"><button>Each</button></wt-dialog>',
  )) as Openable;
  const screen = document.createElement("div");
  host.prepend(screen);
  const inner = document.createElement("button");
  screen.attachShadow({ mode: "open" }).append(inner);
  (document.activeElement as HTMLElement | null)?.blur();
  await openAndClose(el, document.body, "Escape");
  expect(deepActiveElement()).toBe(inner);
});

test("puts focus in the shadow root of the element the dialog is slotted into", async () => {
  const panel = await mount("<div></div>");
  panel.attachShadow({ mode: "open" }).innerHTML = "<button>Back</button><slot></slot>";
  panel.innerHTML = '<wt-dialog heading="Choose a unit"><button>Each</button></wt-dialog>';
  const el = panel.firstElementChild as Openable;
  const target = document.createElement("button");
  panel.after(target);
  await openAndClose(el, target, "Escape", () => target.remove());
  expect(deepActiveElement()).toBe(panel.shadowRoot!.querySelector("button"));
});

test("has put focus beside what had it once an update setting open false completes", async () => {
  // A screen that hands focus back once the dialog's update completes acts before the browser
  // reports the close, so it sees where focus will stay.
  const { el, target, nearby } = await scene();
  target.focus();
  el.open = true;
  await el.updateComplete;
  target.disabled = true;
  el.open = false;
  await el.updateComplete;
  expect(deepActiveElement()).toBe(nearby);
});

test("has put focus beside what had it before telling wt-close listeners", async () => {
  const { el, target, nearby } = await scene();
  let seen: Element | null = null;
  el.addEventListener("wt-close", () => (seen = deepActiveElement()));
  await openAndClose(el, target, "Escape", () => target.remove());
  expect(seen).toBe(nearby);
});

/** A dialog and the button that has focus at opening, both inside an element that can take focus
 * itself and holds nothing else that can. */
async function enclosedScene() {
  const enclosing = await mount(`<div tabindex="0">
    <button>Target</button>
    <wt-dialog heading="Choose a unit"><button>Each</button></wt-dialog>
  </div>`);
  const el = enclosing.querySelector("wt-dialog") as Openable;
  await el.updateComplete;
  return { el, enclosing, target: enclosing.querySelector("button")! };
}

test.each(lostByClosing)(
  "closed by %s, puts focus on the element enclosing what had it at opening when that was %s",
  async (how, _, change) => {
    const { el, enclosing, target } = await enclosedScene();
    await openAndClose(el, target, how, () => change(target));
    expect(deepActiveElement()).toBe(enclosing);
  },
);

test("prefers an element beside what had focus at opening to the element enclosing both", async () => {
  const { el, target } = await enclosedScene();
  const nearby = document.createElement("button");
  target.after(nearby);
  await openAndClose(el, target, "Escape", () => (target.disabled = true));
  expect(deepActiveElement()).toBe(nearby);
});

test.each(lost)(
  "has put focus on the element enclosing what had it, once an update setting open false completes, when that was %s",
  async (_, change) => {
    const { el, enclosing, target } = await enclosedScene();
    target.focus();
    el.open = true;
    await el.updateComplete;
    change(target);
    el.open = false;
    await el.updateComplete;
    expect(deepActiveElement()).toBe(enclosing);
  },
);

test("leaves focus where the browser left it when nothing outside the dialog can take it", async () => {
  const el = (await mount(
    '<wt-dialog heading="Choose a unit"><button>Each</button></wt-dialog>',
  )) as Openable;
  const button = document.createElement("button");
  host.prepend(button);
  await openAndClose(el, button, "Escape", () => button.remove());
  expect(document.activeElement).toBe(document.body);
});

test("leaves focus where a wt-close listener puts it", async () => {
  const { el, target, opener } = await scene();
  const other = document.createElement("input");
  host.append(other);
  el.addEventListener("wt-close", () => other.focus());
  el.opener = opener;
  await openAndClose(el, target, "Escape", () => target.remove());
  expect(deepActiveElement()).toBe(other);
});

test("keeps the edited native dialog open through repeated Escape while a close decision is pending", async () => {
  const el = (await mount(
    '<wt-dialog heading="Edit"><wt-input value="draft"></wt-input></wt-dialog>',
  )) as WtDialog;
  let answer!: (allow: boolean) => void;
  const decide = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
  el.beforeClose = decide;
  el.open = true;
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  const closes = vi.fn();
  el.addEventListener("wt-close", closes);

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(decide).toHaveBeenCalledExactlyOnceWith("escape"));
  expect(dialog.open).toBe(true);
  await userEvent.keyboard("{Escape}");
  await closeReportsDelivered();
  expect(dialog.open).toBe(true);
  expect(decide).toHaveBeenCalledOnce();
  answer(false);
  await closeReportsDelivered();
  expect(dialog.open).toBe(true);
  expect(el.querySelector("wt-input")!.value).toBe("draft");
  expect(closes).not.toHaveBeenCalled();
});

test("a late close approval cannot close a reopened editor or release its newer pending request", async () => {
  const el = (await mount('<wt-dialog heading="Edit">draft</wt-dialog>')) as WtDialog;
  const answers: ((allow: boolean) => void)[] = [];
  el.beforeClose = vi.fn(() => new Promise<boolean>((resolve) => answers.push(resolve)));
  el.open = true;
  await el.updateComplete;
  const first = el.requestClose("cancel");
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  const second = el.requestClose("cancel");
  expect(answers).toHaveLength(2);
  answers[0]!(true);
  expect(await first).toBe(false);
  expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(await el.requestClose("cancel")).toBe(false);
  expect(answers).toHaveLength(2);
  answers[1]!(false);
  expect(await second).toBe(false);
});

test.each(["saved", "security"] as const)(
  "%s closes immediately and invalidates an outstanding dismissal decision",
  async (reason) => {
    const el = (await mount('<wt-dialog heading="Edit">draft</wt-dialog>')) as WtDialog;
    let answer!: (allow: boolean) => void;
    el.beforeClose = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    el.open = true;
    await el.updateComplete;
    const request = el.requestClose("cancel");
    el.closeAfter(reason);
    await el.updateComplete;
    await closeReportsDelivered();
    expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(false);
    el.open = true;
    await el.updateComplete;
    answer(true);
    expect(await request).toBe(false);
    expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  },
);

test("keeps a guarded owner open when its native dialog is closed while asking", async () => {
  const el = (await mount('<wt-dialog heading="Edit">draft</wt-dialog>')) as WtDialog;
  let answer!: (allow: boolean) => void;
  el.beforeClose = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
  el.open = true;
  await el.updateComplete;
  const request = el.requestClose("cancel");
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  const closes = vi.fn();
  el.addEventListener("wt-close", closes);
  dialog.close();
  await closeReportsDelivered();
  expect(dialog.open).toBe(true);
  expect(closes).not.toHaveBeenCalled();
  answer(false);
  expect(await request).toBe(false);
});

test("a close approval from before disconnect cannot dismiss a reconnected editor", async () => {
  const el = (await mount('<wt-dialog heading="Edit">draft</wt-dialog>')) as WtDialog;
  let answer!: (allow: boolean) => void;
  el.beforeClose = () => new Promise<boolean>((resolve) => (answer = resolve));
  el.open = true;
  await el.updateComplete;
  const request = el.requestClose("cancel");
  el.remove();
  host.append(el);
  await el.updateComplete;
  answer(true);
  expect(await request).toBe(false);
  expect(el.open).toBe(true);
});

test("an approved request closes once after a harmless owner rerender and returns focus to its opener", async () => {
  const el = (await mount('<wt-dialog heading="Edit">draft</wt-dialog>')) as WtDialog;
  const opener = document.createElement("button");
  host.append(opener);
  opener.focus();
  el.opener = opener;
  let answer!: (allow: boolean) => void;
  el.beforeClose = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
  el.open = true;
  await el.updateComplete;
  const closes = vi.fn();
  el.addEventListener("wt-close", closes);
  const request = el.requestClose("backdrop");
  el.heading = "Edited name";
  await el.updateComplete;
  expect(await el.requestClose("cancel")).toBe(false);
  answer(true);
  expect(await request).toBe(true);
  await closeReportsDelivered();
  expect(closes).toHaveBeenCalledOnce();
  expect(deepActiveElement()).toBe(opener);
  expect(el.beforeClose).toHaveBeenCalledExactlyOnceWith("backdrop");
  expect(await el.requestClose("cancel")).toBe(false);
});

test("a refused close returns focus to the original field after the question closes", async () => {
  const el = (await mount(
    '<wt-dialog heading="Edit"><wt-input value="draft"></wt-input></wt-dialog>',
  )) as WtDialog;
  el.open = true;
  await el.updateComplete;
  const input = el.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
  input.focus();
  el.beforeClose = async () => {
    const question = document.createElement("dialog");
    const keep = document.createElement("button");
    question.append(keep);
    host.append(question);
    question.showModal();
    keep.focus();
    const closed = new Promise<void>((resolve) =>
      question.addEventListener("close", () => resolve(), { once: true }),
    );
    question.close();
    await closed;
    question.remove();
    return false;
  };
  expect(await el.requestClose("cancel")).toBe(false);
  expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(deepActiveElement()).toBe(input);
});

test("refuses a pending approval if the owner becomes busy or replaces its guard", async () => {
  const el = (await mount('<wt-dialog heading="Edit">draft</wt-dialog>')) as WtDialog;
  el.open = true;
  await el.updateComplete;
  for (const change of [
    () => (el.dismissible = false),
    () => (el.beforeClose = async () => true),
  ]) {
    el.dismissible = true;
    let answer!: (allow: boolean) => void;
    el.beforeClose = () => new Promise<boolean>((resolve) => (answer = resolve));
    const request = el.requestClose("cancel");
    change();
    answer(true);
    expect(await request).toBe(false);
    expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  }
});

test("a busy guarded dialog never asks and success can still close it", async () => {
  const el = (await mount('<wt-dialog heading="Edit">draft</wt-dialog>')) as WtDialog;
  el.open = true;
  el.dismissible = false;
  el.beforeClose = vi.fn(async () => true);
  await el.updateComplete;
  await pressEscape();
  expect(await el.requestClose("cancel")).toBe(false);
  expect(el.beforeClose).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  el.closeAfter("saved");
  await el.updateComplete;
  await closeReportsDelivered();
  expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(false);
});

test("a rejected decision preserves the editor and releases its request gate", async () => {
  const el = (await mount('<wt-dialog heading="Edit">draft</wt-dialog>')) as WtDialog;
  el.open = true;
  await el.updateComplete;
  const failure = new Error("renderer failed");
  el.beforeClose = async () => {
    throw failure;
  };
  await expect(el.requestClose("cancel")).rejects.toBe(failure);
  expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  el.beforeClose = async () => true;
  expect(await el.requestClose("cancel")).toBe(true);
  await closeReportsDelivered();
  expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(false);
});

test("associates an optional description inside the native dialog's shadow root", async () => {
  const el = (await mount(
    '<wt-dialog heading="Leave" description="Your changes are unsaved."></wt-dialog>',
  )) as WtDialog;
  el.open = true;
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  const id = dialog.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  expect(el.shadowRoot!.getElementById(id!)?.textContent?.trim()).toBe("Your changes are unsaved.");
});

test("a user-dismissal reason cannot use the successful-write or security bypass", async () => {
  const el = (await mount('<wt-dialog heading="Edit">draft</wt-dialog>')) as WtDialog;
  el.open = true;
  await el.updateComplete;
  el.closeAfter("cancel" as "saved");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(true);
});

test("delayed native reports from two consecutive openings report only the current close", async () => {
  const el = (await mount('<wt-dialog heading="Edit">draft</wt-dialog>')) as WtDialog;
  el.open = true;
  await el.updateComplete;
  const closes = vi.fn();
  el.addEventListener("wt-close", closes);
  expect(await el.requestClose("cancel")).toBe(true);
  el.open = true;
  await el.updateComplete;
  expect(await el.requestClose("cancel")).toBe(true);
  await closeReportsDelivered();
  expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(false);
  expect(closes).toHaveBeenCalledOnce();
});

test("an approved close still closes after its owner sets open to true again while asking", async () => {
  const el = (await mount('<wt-dialog heading="Edit">draft</wt-dialog>')) as WtDialog;
  let answer!: (allow: boolean) => void;
  const decide = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
  el.beforeClose = decide;
  el.open = true;
  await el.updateComplete;
  const closing = el.requestClose("cancel");
  el.open = true;
  await el.updateComplete;
  expect(await el.requestClose("cancel"), "a second request while the first is asking").toBe(false);
  expect(decide).toHaveBeenCalledOnce();
  answer(true);
  expect(await closing).toBe(true);
  expect(el.shadowRoot!.querySelector("dialog")!.open).toBe(false);
});

test("describes nothing when it is given no description", async () => {
  const el = (await mount('<wt-dialog heading="Void sale">body</wt-dialog>')) as Openable;
  el.open = true;
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  await expect.element(page.elementLocator(dialog)).toHaveAccessibleDescription("");
  expect(el.shadowRoot!.querySelector(".body")!.textContent!.trim()).toBe("Void sale");
});

test("makes the body a tab stop when the window shrinks below its content", async () => {
  const { body } = await openAtPhoneSize('<div style="height: 400px">Order</div>');
  await frame();
  await frame();
  expect(body.scrollHeight, "before: scrollHeight").toBe(body.clientHeight);
  expect(body.tabIndex, "before: tabIndex").toBe(-1);
  await page.viewport(390, 300);
  expect(body.scrollHeight, "shrunk: scrollHeight").toBeGreaterThan(body.clientHeight);
  await vi.waitFor(() => expect(body.tabIndex, "shrunk: tabIndex").toBe(0));
});

test.each([
  ["", "here"],
  [", after it is moved while open", "moved"],
  [", forwarded through a slot", "forwarded"],
] as const)(
  "makes the body a tab stop when a narrower window wraps content out of a fixed-height wrapper%s",
  async (_, how) => {
    const before = [window.innerWidth, window.innerHeight] as const;
    await page.viewport(1000, 700);
    onTestFinished(() => page.viewport(...before));
    const tile = '<span style="display: inline-block; width: 100px; height: 40px"></span>';
    const content = `<div style="width: 320px; height: 1px"></div><div style="width: 30vw; height: 200px">${tile.repeat(6)}</div>`;
    let el: Openable;
    if (how === "forwarded") {
      const panel = await mount(`<div>${content}</div>`);
      panel.attachShadow({ mode: "open" }).innerHTML =
        '<wt-dialog heading="Edit order"><slot></slot></wt-dialog>';
      el = panel.shadowRoot!.querySelector("wt-dialog") as Openable;
      await el.updateComplete;
    } else el = (await mount(`<wt-dialog heading="Edit order">${content}</wt-dialog>`)) as Openable;
    el.open = true;
    await el.updateComplete;
    if (how === "moved") {
      const parent = el.parentNode!;
      el.remove();
      parent.append(el);
    }
    const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
    await frame();
    await frame();
    expect(body.scrollHeight, "before: scrollHeight").toBe(body.clientHeight);
    expect(body.tabIndex, "before: tabIndex").toBe(-1);
    await page.viewport(500, 700);
    expect(body.scrollHeight, "narrowed: scrollHeight").toBeGreaterThan(body.clientHeight);
    await vi.waitFor(() => expect(body.tabIndex, "narrowed: tabIndex").toBe(0));
  },
);

test("asks for no frame for content changes after it is moved while closed", async () => {
  const el = await mount(
    '<wt-dialog heading="Edit order"><div style="height: 200px"><p>Line</p></div></wt-dialog>',
  );
  const parent = el.parentNode!;
  el.remove();
  parent.append(el);
  const frames = vi.spyOn(window, "requestAnimationFrame");
  onTestFinished(() => frames.mockRestore());
  const inner = el.querySelector("p")!;
  inner.textContent = "Lines";
  await Promise.resolve();
  inner.style.color = "red";
  await Promise.resolve();
  expect(frames).not.toHaveBeenCalled();
});

test("shows in its first render the messages of the action rows in its footer and no others", async () => {
  const updated = vi.spyOn(WtDialog.prototype, "updated");
  try {
    const el = await mount(`<wt-dialog heading="Edit">
      <wt-form-actions error="Check the name."><button>Check</button></wt-form-actions>
      <span slot="footer">Draft</span>
      <wt-form-actions slot="footer" error="Could not save."><button>Save</button></wt-form-actions>
    </wt-dialog>`);
    expect(el.shadowRoot!.querySelector(".footer > [data-error]")?.textContent).toBe(
      "Could not save.",
    );
    await new Promise((resolve) => setTimeout(resolve));
    expect(updated).toHaveBeenCalledTimes(1);
  } finally {
    updated.mockRestore();
  }
});

test("puts focus beside the dialog, not at the top of the page, when the page body had it at opening", async () => {
  const section = await mount(
    '<div><wt-dialog heading="Choose a unit"><button>Each</button></wt-dialog><button>Near</button></div>',
  );
  const far = document.createElement("button");
  far.textContent = "Far";
  host.prepend(far);
  const el = section.querySelector("wt-dialog") as Openable;
  await el.updateComplete;
  (document.activeElement as HTMLElement | null)?.blur();
  await openAndClose(el, document.body, "Escape");
  expect(deepActiveElement()).toBe(section.lastElementChild);
});

test("leaves opening focus on a short dialog's autofocus field", async () => {
  const el = (await mount(
    '<wt-dialog heading="Rename"><input name="first" /><input name="second" autofocus /></wt-dialog>',
  )) as Openable;
  el.open = true;
  await el.updateComplete;
  expect(deepActiveElement()).toBe(el.querySelector('[name="second"]'));
});

test("names an overflowing body after the dialog's label once its heading is removed", async () => {
  const { el, body } = await openAtPhoneSize('<div style="height: 1800px">Long order</div>');
  await vi.waitFor(() => expect(body.tabIndex).toBe(0));
  const dialog = el as Openable & { heading: string };
  dialog.heading = "";
  el.setAttribute("aria-label", "Order notes");
  await dialog.updateComplete;
  await expect.element(page.elementLocator(body)).toHaveAccessibleName("Order notes");
});

test("gives an overflowing body no name when the dialog has neither a heading nor a label", async () => {
  const before = [window.innerWidth, window.innerHeight] as const;
  await page.viewport(390, 700);
  onTestFinished(() => page.viewport(...before));
  const el = (await mount(
    '<wt-dialog><div style="height: 1800px">Long order</div></wt-dialog>',
  )) as Openable;
  el.open = true;
  await el.updateComplete;
  const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
  expect(body.tabIndex).toBe(0);
  await expect.element(page.elementLocator(body)).toHaveAccessibleName("");
});

test("drops an overflowing body's name when the dialog's label is removed, and its label when it is short again", async () => {
  const before = [window.innerWidth, window.innerHeight] as const;
  await page.viewport(390, 700);
  onTestFinished(() => page.viewport(...before));
  const el = (await mount(
    '<wt-dialog aria-label="Edit order"><div style="height: 1800px">Long order</div></wt-dialog>',
  )) as Openable;
  el.open = true;
  await el.updateComplete;
  const body = el.shadowRoot!.querySelector<HTMLElement>(".body")!;
  await expect.element(page.elementLocator(body)).toHaveAccessibleName("Edit order");
  el.removeAttribute("aria-label");
  await el.updateComplete;
  await expect.element(page.elementLocator(body)).toHaveAccessibleName("");

  el.setAttribute("aria-label", "Edit order");
  await el.updateComplete;
  await expect.element(page.elementLocator(body)).toHaveAccessibleName("Edit order");
  el.querySelector("div")!.remove();
  await vi.waitFor(() => expect(body.tabIndex, "a body short again: tabIndex").toBe(-1));
  for (const name of ["role", "aria-labelledby", "aria-label"])
    expect(body.getAttribute(name), `a body short again: ${name}`).toBeNull();
});

test.each([
  ["a bare field", '<input name="note" />'],
  [
    "a field inside a wrapper that takes focus only from script",
    '<div tabindex="-1"><label>Note <input name="note" /></label></div>',
  ],
])("opens a long dialog with focus on its first field when that is %s", async (_, field) => {
  await openAtPhoneSize(`${field}<div style="height: 1800px">Long order</div>`);
  expect(deepActiveElement()).toBe(document.querySelector('input[name="note"]'));
});

test("opens a long dialog with focus on its first field when its content is forwarded through a slot", async () => {
  const before = [window.innerWidth, window.innerHeight] as const;
  await page.viewport(390, 700);
  onTestFinished(() => page.viewport(...before));
  const panel = await mount(
    '<div><input name="note" /><div style="height: 1800px">Long order</div></div>',
  );
  panel.attachShadow({ mode: "open" }).innerHTML =
    '<wt-dialog heading="Edit order"><slot></slot></wt-dialog>';
  const el = panel.shadowRoot!.querySelector("wt-dialog") as Openable;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  expect(deepActiveElement()).toBe(panel.querySelector("input"));
});

test("asks its guard before a close request that comes without a key press, such as a back gesture", async () => {
  const el = (await mount('<wt-dialog heading="Edit">draft</wt-dialog>')) as WtDialog;
  let answer!: (allow: boolean) => void;
  const decide = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
  el.beforeClose = decide;
  el.open = true;
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("dialog")!;
  const closes = vi.fn();
  el.addEventListener("wt-close", closes);

  dialog.requestClose();
  await closeReportsDelivered();
  expect(dialog.open).toBe(true);
  expect(decide).toHaveBeenCalledExactlyOnceWith("escape");
  answer(true);
  await vi.waitFor(() => expect(closes).toHaveBeenCalledOnce());
  expect(dialog.open).toBe(false);
});

test("in a guarded dialog, types keys other than Escape and keeps its Escape from the page", async () => {
  const el = (await mount(
    '<wt-dialog heading="Edit"><input name="note" /></wt-dialog>',
  )) as WtDialog;
  const decide = vi.fn(async () => false);
  el.beforeClose = decide;
  el.open = true;
  await el.updateComplete;
  const seen: string[] = [];
  const listen = (event: KeyboardEvent) => seen.push(event.key);
  document.addEventListener("keydown", listen);
  onTestFinished(() => document.removeEventListener("keydown", listen));
  const field = el.querySelector("input")!;
  field.focus();

  await userEvent.keyboard("ab{Escape}");
  expect(field.value).toBe("ab");
  expect(decide).toHaveBeenCalledExactlyOnceWith("escape");
  expect(seen).toEqual(["a", "b"]);
});

/** Opens `tag` holding a focused field, then disables the field and waits for the browser to drop
 * focus from it to the page body. */
async function openThenDisableFocusedField(tag: "wt-dialog" | "wt-modal", guarded: boolean) {
  const el = (await mount(
    `<${tag} heading="Edit"><input name="note" /><button>Other</button></${tag}>`,
  )) as WtDialog;
  const decide = vi.fn(async () => false);
  if (guarded) el.beforeClose = decide;
  el.open = true;
  await el.updateComplete;
  const field = el.querySelector("input")!;
  field.focus();
  field.disabled = true;
  await vi.waitFor(() => expect(document.activeElement).toBe(document.body));
  return { el, decide };
}

test.each(["wt-dialog", "wt-modal"] as const)(
  "%s, guarded, still asks its guard on Escape once its focused field is disabled, and keeps it from the page",
  async (tag) => {
    const { decide } = await openThenDisableFocusedField(tag, true);
    const seen: string[] = [];
    const listen = (event: KeyboardEvent) => seen.push(event.key);
    document.addEventListener("keydown", listen);
    onTestFinished(() => document.removeEventListener("keydown", listen));
    await userEvent.keyboard("a");
    expect(decide).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(decide).toHaveBeenCalledExactlyOnceWith("escape");
    expect(seen).toEqual(["a"]);
  },
);

test("asks only the top guarded dialog on Escape once focus has fallen to the page body", async () => {
  const below = (await mount('<wt-modal heading="Below">draft</wt-modal>')) as WtDialog;
  const belowDecide = vi.fn(async () => false);
  below.beforeClose = belowDecide;
  below.open = true;
  await below.updateComplete;
  const { decide } = await openThenDisableFocusedField("wt-modal", true);
  await userEvent.keyboard("{Escape}");
  expect(decide).toHaveBeenCalledExactlyOnceWith("escape");
  expect(belowDecide).not.toHaveBeenCalled();
});

test("an Escape inside a plain native dialog opened over a guarded one is not its to answer", async () => {
  const { decide } = await openThenDisableFocusedField("wt-modal", true);
  const above = document.createElement("dialog");
  above.innerHTML = "<button>Inside</button>";
  host.append(above);
  above.showModal();
  above.querySelector("button")!.focus();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(above.open).toBe(false));
  expect(decide).not.toHaveBeenCalled();
});

test.each(["wt-dialog", "wt-modal"] as const)(
  "%s, unguarded, still closes on Escape once its focused field is disabled, and the page sees it",
  async (tag) => {
    const { el } = await openThenDisableFocusedField(tag, false);
    const closes = vi.fn();
    el.addEventListener("wt-close", closes);
    const seen: string[] = [];
    const listen = (event: KeyboardEvent) => seen.push(event.key);
    document.addEventListener("keydown", listen);
    onTestFinished(() => document.removeEventListener("keydown", listen));
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(closes).toHaveBeenCalledOnce());
    expect(seen).toEqual(["Escape"]);
  },
);

/** Puts focus back on the page body, wherever opening a surface moved it. */
async function focusPageBody(): Promise<void> {
  (deepActiveElement() as HTMLElement | null)?.blur();
  await vi.waitFor(() => expect(document.activeElement).toBe(document.body));
}

test("leaves a page-body Escape to a native popover opened over a guarded dialog", async () => {
  const { decide } = await openThenDisableFocusedField("wt-modal", true);
  const above = document.createElement("div");
  above.popover = "auto";
  above.textContent = "Above";
  host.append(above);
  above.showPopover();
  await focusPageBody();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(above.matches(":popover-open")).toBe(false));
  expect(decide).not.toHaveBeenCalled();
});

test("leaves a page-body Escape to a row menu opened inside a guarded dialog", async () => {
  const { el, decide } = await openThenDisableFocusedField("wt-modal", true);
  const menu = document.createElement("wt-row-actions");
  menu.label = "Actions";
  menu.innerHTML = "<button>Edit</button>";
  el.append(menu);
  await menu.updateComplete;
  menu.show();
  const popup = menu.shadowRoot!.querySelector("[popover]")!;
  expect(popup.matches(":popover-open")).toBe(true);
  await focusPageBody();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
  expect(decide).not.toHaveBeenCalled();
});

test("leaves a page-body Escape to a plain native modal dialog opened over a guarded one", async () => {
  const { decide } = await openThenDisableFocusedField("wt-modal", true);
  const above = document.createElement("dialog");
  above.textContent = "Above";
  host.append(above);
  above.showModal();
  await focusPageBody();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(above.open).toBe(false));
  expect(decide).not.toHaveBeenCalled();
});

test("still asks a guarded dialog on a page-body Escape when it sits inside a native modal dialog", async () => {
  const outer = (await mount(
    '<dialog><wt-modal heading="Edit"><input name="note" /></wt-modal></dialog>',
  )) as HTMLDialogElement;
  outer.showModal();
  const el = outer.querySelector("wt-modal")!;
  const decide = vi.fn(async () => false);
  el.beforeClose = decide;
  el.open = true;
  await el.updateComplete;
  const field = el.querySelector("input")!;
  field.focus();
  field.disabled = true;
  await vi.waitFor(() => expect(document.activeElement).toBe(document.body));
  await userEvent.keyboard("{Escape}");
  expect(decide).toHaveBeenCalledExactlyOnceWith("escape");
  expect(outer.open).toBe(true);
});

test("still asks a guarded dialog on a page-body Escape over a manual popover, which Escape does not close", async () => {
  const { decide } = await openThenDisableFocusedField("wt-modal", true);
  const above = document.createElement("div");
  above.popover = "manual";
  above.textContent = "Above";
  host.append(above);
  above.showPopover();
  await focusPageBody();
  await userEvent.keyboard("{Escape}");
  expect(decide).toHaveBeenCalledExactlyOnceWith("escape");
  expect(above.matches(":popover-open")).toBe(true);
});

test("does not ask a guarded dialog on a page-body Escape the page has already handled", async () => {
  const { decide } = await openThenDisableFocusedField("wt-modal", true);
  const handled = (event: KeyboardEvent) => event.preventDefault();
  document.body.addEventListener("keydown", handled);
  onTestFinished(() => document.body.removeEventListener("keydown", handled));
  await userEvent.keyboard("{Escape}");
  expect(decide).not.toHaveBeenCalled();
});

test("does not ask a guarded dialog on a page-body Escape that ends a text composition", async () => {
  const { decide } = await openThenDisableFocusedField("wt-modal", true);
  const escape = (isComposing: boolean) =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", isComposing, bubbles: true, cancelable: true }),
    );
  escape(true);
  expect(decide).not.toHaveBeenCalled();
  escape(false);
  expect(decide).toHaveBeenCalledExactlyOnceWith("escape");
});

/** The keydown listeners added to the document from now on and not yet removed. */
function documentKeydownListeners(): Set<unknown> {
  const live = new Set<unknown>();
  const add = vi.spyOn(document, "addEventListener");
  const remove = vi.spyOn(document, "removeEventListener");
  onTestFinished(() => {
    add.mockRestore();
    remove.mockRestore();
  });
  add.mockImplementation(function (
    this: Document,
    ...args: Parameters<Document["addEventListener"]>
  ) {
    if (args[0] === "keydown") live.add(args[1]);
    EventTarget.prototype.addEventListener.apply(this, args);
  });
  remove.mockImplementation(function (
    this: Document,
    ...args: Parameters<Document["removeEventListener"]>
  ) {
    if (args[0] === "keydown") live.delete(args[1]);
    EventTarget.prototype.removeEventListener.apply(this, args);
  });
  return live;
}

test("listens on the document for a page-body Escape only while a dialog is open", async () => {
  const listening = documentKeydownListeners();
  const first = (await mount(
    '<wt-dialog heading="First">One</wt-dialog><wt-dialog heading="Second">Two</wt-dialog>',
  )) as WtDialog;
  const second = host.querySelectorAll("wt-dialog")[1]!;
  await second.updateComplete;
  expect(listening.size).toBe(0);
  first.open = true;
  await first.updateComplete;
  expect(listening.size).toBe(1);
  second.open = true;
  await second.updateComplete;
  expect(listening.size).toBe(1);
  first.open = false;
  await first.updateComplete;
  expect(listening.size).toBe(1);
  second.remove();
  expect(listening.size).toBe(0);
  host.append(second);
  expect(listening.size).toBe(1);
  second.open = false;
  await second.updateComplete;
  expect(listening.size).toBe(0);
});

test("scrolls a body row's new message only just into view", async () => {
  const { el, body } = await openAtPhoneSize(
    '<input name="note" /><div style="height: 1800px">Lines</div><wt-form-actions><button>Check</button></wt-form-actions><div style="height: 1800px">More lines</div>',
  );
  const row = el.querySelector("wt-form-actions")!;
  expect(body.scrollTop).toBe(0);
  row.error = "Check the name.";
  const message = (await formMessageOf(row))!;
  await vi.waitFor(() => expect(body.scrollTop).toBeGreaterThan(0));
  const frameBox = body.getBoundingClientRect();
  const box = message.getBoundingClientRect();
  expect(box.bottom).toBeLessThanOrEqual(frameBox.bottom + 1);
  expect(box.top, "in the lower half of the body").toBeGreaterThan(
    frameBox.top + frameBox.height / 2,
  );
});

test.each(closings)(
  "closed by %s, puts focus beside what had it at opening when that and the dialog's focused field were both removed",
  async (how) => {
    const { el, target, nearby } = await scene();
    await openAndClose(el, target, how, () => {
      target.remove();
      const focused = deepActiveElement() as HTMLElement;
      expect(el.contains(focused), "focus is in the dialog").toBe(true);
      focused.remove();
      expect(document.activeElement, "focus has fallen to the page body").toBe(document.body);
    });
    expect(deepActiveElement()).toBe(nearby);
  },
);

/** A refusal far taller than the room a short window leaves the footer. */
const LONG_REFUSAL = "The printer at the bar did not answer, so nothing was saved. "
  .repeat(30)
  .trim();

test.each([
  [500, "Printer settings", LONG_REFUSAL],
  [500, '<div style="height: 2000px">Long settings</div>', LONG_REFUSAL],
  [200, "Printer settings", LONG_REFUSAL],
  [500, '<div style="height: 2000px">Long settings</div>', "Enter a name."],
])(
  "keeps its buttons in view below its footer actions' message, %ipx tall (%s)",
  async (height, body, refusal) => {
    await page.viewport(390, height);
    try {
      const el = (await mount(`<wt-dialog heading="Add printer">
        ${body}
        ${SAVE_OR_CANCEL}
      </wt-dialog>`)) as Openable;
      el.open = true;
      await el.updateComplete;
      const actions = el.querySelector("wt-form-actions")!;
      actions.error = refusal;
      const message = (await formMessageOf(actions))!;
      expect(message.textContent).toBe(refusal);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(el.shadowRoot!.querySelector(".footer")!.firstElementChild).toBe(message);
      const frame = el.shadowRoot!.querySelector("dialog")!.getBoundingClientRect();
      const box = message.getBoundingClientRect();
      expect(box.height).toBeGreaterThan(0);
      for (const button of el.querySelectorAll("wt-button")) {
        const name = button.textContent!.trim();
        const at = button.getBoundingClientRect();
        expect(at.top, name).toBeGreaterThanOrEqual(box.bottom);
        expect(at.bottom, name).toBeLessThanOrEqual(Math.min(frame.bottom, window.innerHeight));
        expect(at.left, name).toBeGreaterThanOrEqual(Math.max(frame.left, 0));
        expect(at.right, name).toBeLessThanOrEqual(Math.min(frame.right, window.innerWidth));
      }
      if (refusal === LONG_REFUSAL) {
        expect(message.scrollHeight).toBeGreaterThan(message.clientHeight);
      } else {
        expect(message.scrollHeight, "a one-line message is shown whole").toBe(
          message.clientHeight,
        );
      }
    } finally {
      await page.viewport(1280, 900);
    }
  },
);

const nativeOf = (el: HTMLElement) => el.shadowRoot!.querySelector("dialog") as HTMLDialogElement;

test.each([
  ["wt-dialog", false],
  ["wt-dialog", true],
  ["wt-modal", false],
  ["wt-modal", true],
] as const)(
  "%s opens on attachment after a detached update (previously opened: %s)",
  async (tag, previouslyOpened) => {
    const el = (await mount(`<${tag} heading="Edit"><input name="note" /></${tag}>`)) as WtDialog;
    if (previouslyOpened) {
      el.open = true;
      await el.updateComplete;
      el.open = false;
      await el.updateComplete;
      await closeReportsDelivered();
    }
    const putBack = takeOut(el);
    el.open = true;
    await expect(el.updateComplete).resolves.toBeDefined();
    expect(nativeOf(el).open).toBe(false);
    const target = document.createElement("button");
    host.append(target);
    target.focus();
    putBack();
    await el.updateComplete;
    expect(nativeOf(el).matches(":modal")).toBe(true);
    expect(takesFocus(el.querySelector("input")!)).toBe(true);
    el.open = false;
    await el.updateComplete;
    await closeReportsDelivered();
    expect(deepActiveElement()).toBe(target);
  },
);

test("an opening cancelled off-page stays closed on attachment", async () => {
  const el = (await mount('<wt-dialog heading="Edit">Draft</wt-dialog>')) as WtDialog;
  const putBack = takeOut(el);
  el.open = true;
  await expect(el.updateComplete).resolves.toBeDefined();
  el.open = false;
  await el.updateComplete;
  putBack();
  await el.updateComplete;
  expect(nativeOf(el).open).toBe(false);
});

test.each([false, true])(
  "a late close report preserves a newer off-page opening (guarded: %s)",
  async (guarded) => {
    const errors: unknown[] = [];
    const recordError = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener("error", recordError);
    onTestFinished(() => window.removeEventListener("error", recordError));
    const el = (await mount(
      '<wt-dialog heading="Edit"><input name="note" /></wt-dialog>',
    )) as WtDialog;
    if (guarded) el.beforeClose = async () => true;
    const closes = vi.fn();
    el.addEventListener("wt-close", closes);
    el.open = true;
    await el.updateComplete;
    el.open = false;
    await el.updateComplete;
    const putBack = takeOut(el);
    el.open = true;
    await el.updateComplete;
    await closeReportsDelivered();
    expect(errors).toEqual([]);
    expect(el.open).toBe(true);
    expect(closes).not.toHaveBeenCalled();
    expect(nativeOf(el).open).toBe(false);
    putBack();
    await el.updateComplete;
    expect(nativeOf(el).matches(":modal")).toBe(true);
    expect(takesFocus(el.querySelector("input")!)).toBe(true);
  },
);

function takeOut(el: HTMLElement): () => void {
  const parent = el.parentNode!;
  const next = el.nextSibling;
  el.remove();
  return () => parent.insertBefore(el, next);
}

/** Whether focus can reach `input`, which it cannot while a modal dialog above it makes it inert. */
function takesFocus(input: HTMLElement): boolean {
  input.focus();
  return input.matches(":focus");
}

for (const tag of ["wt-dialog", "wt-modal"] as const) {
  for (const how of ["at once", "after a detached update"] as const) {
    test(`${tag}: open and put back ${how}, it is modal again, takes typing and reports no close`, async () => {
      const el = (await mount(
        `<${tag} heading="Edit"><input aria-label="Name" /></${tag}>`,
      )) as WtDialog;
      const closes = vi.fn();
      el.addEventListener("wt-close", closes);
      el.open = true;
      await el.updateComplete;
      const putBack = takeOut(el);
      if (how === "after a detached update") {
        el.heading = "Edit again";
        await el.updateComplete;
      }
      putBack();
      await el.updateComplete;
      const native = nativeOf(el);
      expect(el.open).toBe(true);
      expect(native.open).toBe(true);
      expect(native.matches(":modal")).toBe(true);
      await closeReportsDelivered();
      expect(closes).not.toHaveBeenCalled();
      expect(el.open).toBe(true);
      const input = el.querySelector("input")!;
      expect(takesFocus(input)).toBe(true);
      await userEvent.type(page.elementLocator(input), "typed");
      expect(input.value).toBe("typed");
    });

    test(`${tag}: open and put back ${how}, Escape closes it through its own path, once`, async () => {
      const el = (await mount(
        `<${tag} heading="Edit"><input aria-label="Name" /></${tag}>`,
      )) as WtDialog;
      const closes = vi.fn();
      el.addEventListener("wt-close", closes);
      el.open = true;
      await el.updateComplete;
      const putBack = takeOut(el);
      if (how === "after a detached update") {
        el.heading = "Edit again";
        await el.updateComplete;
      }
      putBack();
      await el.updateComplete;
      const closed = new Promise((resolve) => el.addEventListener("wt-close", resolve));
      await userEvent.keyboard("{Escape}");
      await closed;
      expect(el.open).toBe(false);
      expect(nativeOf(el).open).toBe(false);
      await closeReportsDelivered();
      expect(closes).toHaveBeenCalledTimes(1);
    });

    test(`${tag}: open and put back ${how}, Escape asks its guard and a refusal keeps it modal`, async () => {
      const el = (await mount(
        `<${tag} heading="Edit"><input aria-label="Name" /></${tag}>`,
      )) as WtDialog;
      const closes = vi.fn();
      el.addEventListener("wt-close", closes);
      const guard = vi.fn(async () => false);
      el.beforeClose = guard;
      el.open = true;
      await el.updateComplete;
      const putBack = takeOut(el);
      if (how === "after a detached update") {
        el.heading = "Edit again";
        await el.updateComplete;
      }
      putBack();
      await el.updateComplete;
      el.querySelector("input")!.focus();
      await userEvent.keyboard("{Escape}");
      await vi.waitFor(() => expect(guard).toHaveBeenCalledTimes(1));
      expect(guard).toHaveBeenCalledWith("escape");
      await closeReportsDelivered();
      expect(el.open).toBe(true);
      expect(nativeOf(el).matches(":modal")).toBe(true);
      expect(closes).not.toHaveBeenCalled();
    });

    test(`${tag}: closed and put back ${how}, it stays closed`, async () => {
      const el = (await mount(`<${tag} heading="Edit">body</${tag}>`)) as WtDialog;
      const closes = vi.fn();
      el.addEventListener("wt-close", closes);
      const putBack = takeOut(el);
      if (how === "after a detached update") {
        el.heading = "Edit again";
        await el.updateComplete;
      }
      putBack();
      await el.updateComplete;
      await closeReportsDelivered();
      expect(el.open).toBe(false);
      expect(nativeOf(el).open).toBe(false);
      expect(closes).not.toHaveBeenCalled();
    });

    test(`${tag}: open set false while out and put back ${how}, it stays closed and is never shown`, async () => {
      const el = (await mount(`<${tag} heading="Edit">body</${tag}>`)) as WtDialog;
      el.open = true;
      await el.updateComplete;
      const putBack = takeOut(el);
      el.open = false;
      if (how === "after a detached update") await el.updateComplete;
      putBack();
      expect(nativeOf(el).matches(":modal")).toBe(false);
      await el.updateComplete;
      await closeReportsDelivered();
      expect(el.open).toBe(false);
      expect(nativeOf(el).open).toBe(false);
    });
  }

  test(`${tag}: closed by the browser and put back before that close is reported, it stays closed and reports it`, async () => {
    const el = (await mount(`<${tag} heading="Edit">body</${tag}>`)) as WtDialog;
    const closes = vi.fn();
    el.addEventListener("wt-close", closes);
    el.open = true;
    await el.updateComplete;
    const native = nativeOf(el);
    native.close();
    takeOut(el)();
    expect(el.open).toBe(true);
    expect(native.open).toBe(false);
    await closeReportsDelivered();
    expect(native.open).toBe(false);
    expect(el.open).toBe(false);
    expect(closes).toHaveBeenCalledTimes(1);
  });

  test(`${tag}: moved without leaving the top layer, it is not shown again and keeps focus`, async () => {
    const el = (await mount(
      `<${tag} heading="Edit"><button>First</button><input aria-label="Name" /></${tag}>`,
    )) as WtDialog;
    el.open = true;
    await el.updateComplete;
    const input = el.querySelector("input")!;
    input.focus();
    const parent = el.parentNode as ParentNode & {
      moveBefore(node: Node, child: Node | null): void;
    };
    const shown = vi.spyOn(nativeOf(el), "showModal");
    parent.moveBefore(el, null);
    expect(shown).not.toHaveBeenCalled();
    expect(nativeOf(el).matches(":modal")).toBe(true);
    expect(input.matches(":focus")).toBe(true);
  });
}

test.each([
  ["wt-dialog", "ltr", "Calibrate printer: Kitchen"],
  ["wt-modal", "ltr", "Calibrate printer: Kitchen"],
  ["wt-modal", "ltr", "Calibrate printer: the receipt printer beside the back door of the kitchen"],
  ["wt-dialog", "rtl", "Calibrate printer: Kitchen"],
])(
  "%s (%s): with help on, the heading «%s» ends before its help badge",
  async (tag, dir, heading) => {
    onTestFinished(() => setHelpMode(false));
    const el = (await mount(
      `<${tag} dir="${dir}" heading="${heading}">` +
        '<wt-help-tooltip slot="help" mode="help-mode" aria-label="Help: Calibrate printer">How calibration works.</wt-help-tooltip>' +
        `<p>Print the width test.</p></${tag}>`,
    )) as Openable;
    el.open = true;
    await el.updateComplete;
    const tooltip = el.querySelector<WtHelpTooltip>("wt-help-tooltip")!;
    setHelpMode(true);
    await tooltip.updateComplete;
    await el.updateComplete;
    const badge = tooltip.shadowRoot!.querySelector("button")!.getBoundingClientRect();
    expect(badge.width).toBeGreaterThan(0);
    const text = document.createRange();
    text.selectNodeContents(el.shadowRoot!.querySelector("h2")!);
    const lines = [...text.getClientRects()];
    expect(lines.length).toBeGreaterThan(0);
    if (dir === "rtl") {
      const textLeft = Math.min(...lines.map((line) => line.left));
      expect(textLeft, JSON.stringify({ textLeft, badge })).toBeGreaterThanOrEqual(
        badge.right - 0.5,
      );
    } else {
      const textRight = Math.max(...lines.map((line) => line.right));
      expect(textRight, JSON.stringify({ textRight, badge })).toBeLessThanOrEqual(badge.left + 0.5);
    }
  },
);

test("an open dialog put back with help on does not open on the help badge", async () => {
  const el = (await mount(
    `<wt-dialog heading="Edit"><button slot="help">?</button><input aria-label="Name" /></wt-dialog>`,
  )) as WtDialog;
  el.open = true;
  await el.updateComplete;
  takeOut(el)();
  await el.updateComplete;
  expect(deepActiveElement()).toBe(el.querySelector("input"));
  expect(el.shadowRoot!.querySelector('slot[name="help"]')!.hasAttribute("inert")).toBe(false);
});

test("an open dialog put back with the page body focused leaves its opener as where focus goes on close", async () => {
  const el = (await mount(
    `<wt-dialog heading="Edit"><input aria-label="Name" /></wt-dialog>`,
  )) as WtDialog;
  const opener = document.createElement("button");
  host.append(opener);
  el.opener = opener;
  el.open = true;
  await el.updateComplete;
  takeOut(el)();
  await el.updateComplete;
  const closed = new Promise((resolve) => el.addEventListener("wt-close", resolve));
  await userEvent.keyboard("{Escape}");
  await closed;
  expect(deepActiveElement()).toBe(opener);
});

/** Two dialogs, the second opened over the first: inside it, after it in the page, or before it. */
async function stacked(arrangement: "inside" | "beside" | "before") {
  const inner = `<wt-modal class="child" heading="Child"><input class="in-child" aria-label="Child" /></wt-modal>`;
  const outer = (content: string) =>
    `<wt-modal class="parent" heading="Parent"><input class="first-in-parent" aria-label="First" /><input class="in-parent" aria-label="Parent" />${content}</wt-modal>`;
  await mount("<div></div>");
  host.innerHTML = `<div class="around">${
    arrangement === "inside"
      ? outer(inner)
      : arrangement === "beside"
        ? outer("") + inner
        : inner + outer("")
  }</div>`;
  const parent = host.querySelector<WtDialog>(".parent")!;
  const child = host.querySelector<WtDialog>(".child")!;
  await parent.updateComplete;
  await child.updateComplete;
  parent.open = true;
  await parent.updateComplete;
  const inParent = host.querySelector<HTMLInputElement>(".in-parent")!;
  inParent.focus();
  child.open = true;
  await child.updateComplete;
  return {
    around: host.querySelector<HTMLElement>(".around")!,
    parent,
    child,
    inParent,
    inChild: host.querySelector<HTMLInputElement>(".in-child")!,
  };
}

async function settledBoth(parent: WtDialog, child: WtDialog) {
  await parent.updateComplete;
  await child.updateComplete;
}

function expectChildOnTop(parent: WtDialog, child: WtDialog, inChild: HTMLInputElement) {
  expect(nativeOf(parent).matches(":modal")).toBe(true);
  expect(nativeOf(child).matches(":modal")).toBe(true);
  expect(takesFocus(inChild)).toBe(true);
  const inParent = parent.querySelector("input")!;
  inParent.focus();
  expect(inParent.matches(":focus"), "the dialog underneath is inert").toBe(false);
}

for (const arrangement of ["inside", "beside", "before"] as const) {
  test(`a dialog opened over another, drawn ${arrangement} it, ends on top when both are put back`, async () => {
    const { around, parent, child, inChild } = await stacked(arrangement);
    takeOut(around)();
    await settledBoth(parent, child);
    expectChildOnTop(parent, child, inChild);
  });

  test(`a dialog opened over another, drawn ${arrangement} it, ends on top when it alone is put back`, async () => {
    const { parent, child, inChild } = await stacked(arrangement);
    takeOut(child)();
    await settledBoth(parent, child);
    expectChildOnTop(parent, child, inChild);
  });
}

for (const arrangement of ["inside", "beside", "before"] as const) {
  test(`the lower of two dialogs, the other drawn ${arrangement} it, put back alone stays under it`, async () => {
    const { parent, child, inChild } = await stacked(arrangement);
    takeOut(parent)();
    await settledBoth(parent, child);
    expectChildOnTop(parent, child, inChild);
  });
}

test("the dialog above one put back keeps its focused field, caret and selection, and reports no close", async () => {
  const { parent, child, inChild } = await stacked("beside");
  const closes = vi.fn();
  child.addEventListener("wt-close", closes);
  inChild.focus();
  await userEvent.keyboard("abcdef");
  inChild.setSelectionRange(1, 3);
  takeOut(parent)();
  await settledBoth(parent, child);
  expect(deepActiveElement()).toBe(inChild);
  expect([inChild.selectionStart, inChild.selectionEnd]).toEqual([1, 3]);
  await userEvent.keyboard("Z");
  expect(inChild.value).toBe("aZdef");
  await closeReportsDelivered();
  expect(closes).not.toHaveBeenCalled();
  expect(child.open).toBe(true);
  expect(nativeOf(child).matches(":modal")).toBe(true);
});

test("the dialog above one put back keeps where its long body was scrolled to", async () => {
  const { parent, child, inChild } = await stacked("beside");
  const long = document.createElement("div");
  long.style.height = "3000px";
  child.append(long);
  await settledBoth(parent, child);
  inChild.focus();
  const body = child.shadowRoot!.querySelector<HTMLElement>(".body")!;
  body.scrollTop = 200;
  takeOut(parent)();
  await settledBoth(parent, child);
  expect(deepActiveElement()).toBe(inChild);
  expect(body.scrollTop).toBe(200);
});

test("Escape goes to the dialog above one put back, and focus then lands in the one underneath", async () => {
  const { parent, child, inParent } = await stacked("beside");
  const parentCloses = vi.fn();
  parent.addEventListener("wt-close", parentCloses);
  takeOut(parent)();
  await settledBoth(parent, child);
  const closed = new Promise((resolve) => child.addEventListener("wt-close", resolve));
  await userEvent.keyboard("{Escape}");
  await closed;
  expect(child.open).toBe(false);
  expect(parent.open).toBe(true);
  expect(nativeOf(parent).matches(":modal")).toBe(true);
  expect(parentCloses).not.toHaveBeenCalled();
  expect(deepActiveElement()).toBe(inParent);
});

test("a dialog above one put back, closed by the browser but not yet reported, is not shown again", async () => {
  const { parent, child } = await stacked("beside");
  const closes = vi.fn();
  child.addEventListener("wt-close", closes);
  nativeOf(child).close();
  takeOut(parent)();
  expect(nativeOf(child).open).toBe(false);
  await closeReportsDelivered();
  expect(nativeOf(child).open).toBe(false);
  expect(child.open).toBe(false);
  expect(closes).toHaveBeenCalledTimes(1);
});

test("a dialog above one put back, removed by its own focusout handler meanwhile, is left off the page", async () => {
  const { parent, child, inParent, inChild } = await stacked("beside");
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => {
    errors.push(event.error);
    event.preventDefault();
  };
  window.addEventListener("error", onError);
  onTestFinished(() => window.removeEventListener("error", onError));
  inChild.focus();
  inChild.addEventListener("focusout", () => child.remove(), { once: true });
  takeOut(parent)();
  await parent.updateComplete;
  expect(errors).toEqual([]);
  expect(child.isConnected).toBe(false);
  expect(nativeOf(parent).matches(":modal")).toBe(true);
  expect(takesFocus(inParent)).toBe(true);
});

test("a dialog put back after the lower one moved goes back above it", async () => {
  const { parent, child, inChild } = await stacked("beside");
  const putChildBack = takeOut(child);
  takeOut(parent)();
  await parent.updateComplete;
  putChildBack();
  await settledBoth(parent, child);
  expectChildOnTop(parent, child, inChild);
});

test("three dialogs keep their opening order when the lowest is put back", async () => {
  const { parent, child, inChild } = await stacked("beside");
  const top = document.createElement("wt-modal");
  top.innerHTML = `<input aria-label="Top" />`;
  host.append(top);
  await top.updateComplete;
  top.open = true;
  await top.updateComplete;
  const inTop = top.querySelector("input")!;
  takeOut(parent)();
  await settledBoth(parent, child);
  await top.updateComplete;
  expect(takesFocus(inChild)).toBe(false);
  expect(takesFocus(inTop)).toBe(true);
  top.open = false;
  await top.updateComplete;
  expectChildOnTop(parent, child, inChild);
});

test("dialogs above one put back go back in opening order, whatever moved before", async () => {
  const { parent, child, inChild } = await stacked("beside");
  const top = document.createElement("wt-modal");
  top.innerHTML = `<input aria-label="Top" />`;
  host.append(top);
  await top.updateComplete;
  top.open = true;
  await top.updateComplete;
  takeOut(child)();
  takeOut(parent)();
  await settledBoth(parent, child);
  await top.updateComplete;
  const inTop = top.querySelector("input")!;
  expect(takesFocus(inChild)).toBe(false);
  expect(takesFocus(inTop)).toBe(true);
});

for (const how of ["taken out and put back", "moved by a keyed list"] as const) {
  test(`an open dialog ${how} gives focus back to the field being edited, caret and selection kept`, async () => {
    await mount("<div></div>");
    const draw = (ids: string[]) =>
      render(
        html`${repeat(
          ids,
          (id) => id,
          (id) =>
            html`<section>
              ${
                id === "a"
                  ? html`<wt-dialog
                      ><input aria-label="First" /><input aria-label="Editing"
                    /></wt-dialog>`
                  : "other"
              }
            </section>`,
        )}`,
        host,
      );
    draw(["a", "b"]);
    const el = host.querySelector<WtDialog>("wt-dialog")!;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;
    const editing = el.querySelectorAll("input")[1]!;
    editing.focus();
    await userEvent.keyboard("abcdef");
    editing.setSelectionRange(2, 4);
    if (how === "moved by a keyed list") draw(["b", "a"]);
    else takeOut(el)();
    await el.updateComplete;
    expect(nativeOf(el).matches(":modal")).toBe(true);
    expect(deepActiveElement()).toBe(editing);
    expect([editing.selectionStart, editing.selectionEnd]).toEqual([2, 4]);
    await userEvent.keyboard("Z");
    expect(editing.value).toBe("abZef");
  });
}

for (const [change, leaveField] of [
  ["removed", (field: HTMLInputElement) => field.remove()],
  ["disabled", (field: HTMLInputElement) => (field.disabled = true)],
] as const) {
  test(`a field ${change} while its dialog was out takes no focus back, and focus lands as at opening`, async () => {
    const el = (await mount(
      `<wt-dialog heading="Edit"><input aria-label="First" /><input aria-label="Second" /></wt-dialog>`,
    )) as WtDialog;
    el.open = true;
    await el.updateComplete;
    const [first, second] = el.querySelectorAll("input");
    second!.focus();
    const putBack = takeOut(el);
    leaveField(second!);
    putBack();
    await el.updateComplete;
    expect(deepActiveElement()).toBe(first);
  });
}

test("a closed dialog clears the field it had, and one reopened takes opening focus", async () => {
  const el = (await mount(
    `<wt-dialog heading="Edit"><input aria-label="First" /><input aria-label="Second" /></wt-dialog>`,
  )) as WtDialog;
  el.open = true;
  await el.updateComplete;
  const [first, second] = el.querySelectorAll("input");
  second!.focus();
  takeOut(el)();
  await el.updateComplete;
  expect(deepActiveElement()).toBe(second);
  expect(el["lastFocused"], "kept across a put-back").toBe(second);

  const closed = new Promise((resolve) => el.addEventListener("wt-close", resolve));
  el.open = false;
  await el.updateComplete;
  expect(el["lastFocused"]).toBeNull();
  await closed;

  el.open = true;
  await el.updateComplete;
  expect(deepActiveElement()).toBe(first);
  takeOut(el)();
  await el.updateComplete;
  expect(deepActiveElement()).toBe(first);
});

test("moving a dialog while its close waits on a question keeps the question answerable", async () => {
  const { parent, child, inChild } = await stacked("beside");
  let answer!: (allow: boolean) => void;
  parent.beforeClose = () => new Promise<boolean>((resolve) => (answer = resolve));
  const request = parent.requestClose("cancel");
  inChild.focus();
  takeOut(parent)();
  await settledBoth(parent, child);
  expect(deepActiveElement()).toBe(inChild);
  answer(false);
  expect(await request).toBe(false);
  expect(parent.open).toBe(true);
});

test("what records opening order holds only dialogs shown on the page, and drops one the browser shut once its open update runs", async () => {
  const openDialogs = WtDialog["openDialogs"];
  const before = openDialogs.size;
  const el = (await mount(`<wt-dialog heading="Edit"><input /></wt-dialog>`)) as WtDialog;
  expect(openDialogs.size).toBe(before);
  el.open = true;
  await el.updateComplete;
  expect(openDialogs.has(el)).toBe(true);

  const putBack = takeOut(el);
  expect(openDialogs.has(el)).toBe(false);
  putBack();
  expect(openDialogs.has(el)).toBe(true);

  const closed = new Promise((resolve) => el.addEventListener("wt-close", resolve));
  el.open = false;
  await el.updateComplete;
  expect(openDialogs.has(el)).toBe(false);
  await closed;

  el.open = true;
  await el.updateComplete;
  const dismissed = new Promise((resolve) => el.addEventListener("wt-close", resolve));
  await userEvent.keyboard("{Escape}");
  await dismissed;
  await el.updateComplete;
  expect(openDialogs.has(el)).toBe(false);

  el.open = true;
  await el.updateComplete;
  el.remove();
  expect(openDialogs.has(el)).toBe(false);
  expect(openDialogs.size).toBe(before);
});

test("an open long dialog put back stays within the screen", async () => {
  const el = (await mount(
    `<wt-dialog><div style="height: 5000px">Long body</div></wt-dialog>`,
  )) as WtDialog;
  el.open = true;
  await el.updateComplete;
  takeOut(el)();
  await el.updateComplete;
  expect(nativeOf(el).getBoundingClientRect().height).toBeLessThanOrEqual(innerHeight);
});

test("a close asked for before a put-back cannot close it or release a later request", async () => {
  const el = (await mount(`<wt-dialog><input /></wt-dialog>`)) as WtDialog;
  const closes = vi.fn();
  el.addEventListener("wt-close", closes);
  const answers: ((allow: boolean) => void)[] = [];
  const guard = vi.fn(() => new Promise<boolean>((resolve) => answers.push(resolve)));
  el.beforeClose = guard;
  el.open = true;
  await el.updateComplete;
  const old = el.requestClose("cancel");
  takeOut(el)();
  const current = el.requestClose("cancel");
  answers[0]!(true);
  expect(await old).toBe(false);
  expect(await el.requestClose("cancel")).toBe(false);
  expect(guard).toHaveBeenCalledTimes(2);
  expect(nativeOf(el).matches(":modal")).toBe(true);
  answers[1]!(false);
  expect(await current).toBe(false);
  await closeReportsDelivered();
  expect(closes).not.toHaveBeenCalled();
});

test("with something outside focused as it is put back, closing hands focus to that, ahead of any opener", async () => {
  await mount("<div></div>");
  const opened = document.createElement("button");
  const outside = document.createElement("button");
  const opener = document.createElement("button");
  host.append(opened, outside, opener);
  const el = document.createElement("wt-dialog");
  el.innerHTML = `<input aria-label="Name" />`;
  host.append(el);
  await el.updateComplete;
  el.opener = opener;
  opened.focus();
  el.open = true;
  await el.updateComplete;
  const putBack = takeOut(el);
  outside.focus();
  putBack();
  await el.updateComplete;
  expect(deepActiveElement()).toBe(el.querySelector("input"));
  const closed = new Promise((resolve) => el.addEventListener("wt-close", resolve));
  await userEvent.keyboard("{Escape}");
  await closed;
  expect(deepActiveElement()).toBe(outside);
});

test("what had focus as it was put back, removed before closing, leaves focus to the opener", async () => {
  await mount("<div></div>");
  const opened = document.createElement("button");
  const outside = document.createElement("button");
  const opener = document.createElement("button");
  host.append(opened, outside, opener);
  const el = document.createElement("wt-dialog");
  el.innerHTML = `<input aria-label="Name" />`;
  host.append(el);
  await el.updateComplete;
  el.opener = opener;
  opened.focus();
  el.open = true;
  await el.updateComplete;
  const putBack = takeOut(el);
  outside.focus();
  putBack();
  await el.updateComplete;
  outside.remove();
  const closed = new Promise((resolve) => el.addEventListener("wt-close", resolve));
  await userEvent.keyboard("{Escape}");
  await closed;
  expect(deepActiveElement()).toBe(opener);
});

for (const [where, sibling] of [
  ["alone in its box", false],
  ["after another button in its box", true],
] as const) {
  test(`with no opener and the page body focused as it is put back, focus on closing goes to the first thing near what had it at opening: a button ${where}`, async () => {
    await mount("<div></div>");
    const box = document.createElement("div");
    host.append(box);
    const earlier = document.createElement("button");
    if (sibling) box.append(earlier);
    const button = document.createElement("button");
    box.append(button);
    const el = document.createElement("wt-dialog");
    el.innerHTML = `<input aria-label="Name" />`;
    host.append(el);
    await el.updateComplete;
    button.focus();
    el.open = true;
    await el.updateComplete;
    takeOut(el)();
    await el.updateComplete;
    const closed = new Promise((resolve) => el.addEventListener("wt-close", resolve));
    await userEvent.keyboard("{Escape}");
    await closed;
    expect(deepActiveElement()).toBe(sibling ? earlier : button);
  });
}
