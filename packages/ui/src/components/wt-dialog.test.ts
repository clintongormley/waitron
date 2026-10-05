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
