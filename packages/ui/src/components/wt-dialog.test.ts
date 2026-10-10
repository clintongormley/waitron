import { expect, test, afterEach, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, formMessageOf, host, mount, mountInShadowRoot } from "../test-helpers.js";
import { WtDialog } from "./wt-dialog.js";
import "./wt-button.js";
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
      expect(deepActiveElement()).toBeInstanceOf(HTMLInputElement);
      const body = el.shadowRoot!.querySelector(".body")!;
      await vi.waitFor(() => expect(body.scrollTop).toBeGreaterThan(0));
      const frame = body.getBoundingClientRect();
      const box = message.getBoundingClientRect();
      expect(box.top).toBeGreaterThanOrEqual(frame.top - 1);
      expect(box.bottom).toBeLessThanOrEqual(frame.bottom + 1);
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

  await pressEscape();
  expect(dialog.open).toBe(true);
  expect(decide).toHaveBeenCalledExactlyOnceWith("escape");
  await pressEscape();
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
