import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, formMessageOf, host, mount } from "../test-helpers.js";
import { WtModal } from "./wt-modal.js";
import "./wt-form-actions.js";
import "./wt-button.js";
import "./wt-input.js";
import "./wt-combobox.js";
import "./wt-price-input.js";
import "./wt-number-stepper.js";
import "./wt-switch.js";
import "./wt-textarea.js";
import "./wt-data-table.js";
import type { WtDataTable } from "./wt-data-table.js";

afterEach(cleanup);

async function openModal(body = "Printer settings", attributes = "") {
  const modal = (await mount(`<wt-modal heading="Add printer" ${attributes}>
    ${body}
    <wt-form-actions slot="footer">
      <wt-button slot="cancel" variant="secondary">Cancel</wt-button>
      <wt-button>Save</wt-button>
    </wt-form-actions>
  </wt-modal>`)) as WtModal;
  modal.open = true;
  await modal.updateComplete;
  return modal;
}

/** Resolves a length token (or any CSS length) to pixels at the current viewport. */
function px(length: string): number {
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.width = length;
  host.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

test.each([
  [1280, 900],
  [390, 844],
  [844, 390],
  [360, 740],
  [320, 568],
])("fits a %i × %i viewport with clear, equal margins", async (width, height) => {
  await page.viewport(width, height);
  try {
    expect(window.innerWidth).toBe(width);
    const modal = await openModal();
    const dialog = modal.shadowRoot!.querySelector("dialog")!;
    const rect = dialog.getBoundingClientRect();
    expect(dialog.matches(":modal")).toBe(true);
    expect(rect.top).toBeGreaterThanOrEqual(16);
    expect(rect.top).toBeLessThanOrEqual(32);
    expect(height - rect.bottom).toBeCloseTo(rect.top, 0);
    expect(width - rect.right).toBeCloseTo(rect.left, 0);
    const margin = px("var(--wt-modal-inline-margin)");
    expect(margin).toBeGreaterThanOrEqual(px("var(--wt-space-1)"));
    expect(rect.left).toBeGreaterThanOrEqual(margin - 0.5);
    // No 90vw cap: below the token's width the viewport minus the two side margins is the bound.
    expect(rect.width).toBeCloseTo(
      Math.min(px("var(--wt-modal-max-width)"), width - 2 * margin),
      0,
    );
  } finally {
    await page.viewport(1280, 900);
  }
});

test.each([320, 360, 390])("gives its width to the content on a %ipx-wide phone", async (width) => {
  await page.viewport(width, 800);
  try {
    expect(window.innerWidth).toBe(width);
    const modal = await openModal();
    const dialog = modal.shadowRoot!.querySelector("dialog")!;
    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    const footer = modal.shadowRoot!.querySelector<HTMLElement>(".footer")!;
    expect(dialog.getBoundingClientRect().left).toBeCloseTo(px("var(--wt-space-1)"), 0);
    for (const part of [body, footer]) {
      const style = getComputedStyle(part);
      expect(parseFloat(style.paddingLeft)).toBe(px("var(--wt-space-3)"));
      expect(parseFloat(style.paddingRight)).toBe(px("var(--wt-space-3)"));
    }
  } finally {
    await page.viewport(1280, 900);
  }
});

test.each([800, 1280])("keeps its full margins and padding at %ipx wide", async (width) => {
  await page.viewport(width, 900);
  try {
    expect(window.innerWidth).toBe(width);
    const modal = await openModal();
    const dialog = modal.shadowRoot!.querySelector("dialog")!;
    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    const footer = modal.shadowRoot!.querySelector<HTMLElement>(".footer")!;
    const space5 = px("var(--wt-space-5)");
    expect(width - dialog.getBoundingClientRect().right).toBeGreaterThanOrEqual(space5 - 0.5);
    for (const part of [body, footer]) {
      expect(parseFloat(getComputedStyle(part).paddingLeft)).toBe(space5);
      expect(parseFloat(getComputedStyle(part).paddingRight)).toBe(space5);
    }
  } finally {
    await page.viewport(1280, 900);
  }
});

test.each([
  [1280, 300, 490],
  [360, 280, 40],
])(
  "follows its width, margin and padding tokens at %ipx wide",
  async (width, expectedWidth, expectedLeft) => {
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      const modal = await openModal();
      host.style.setProperty("--wt-modal-max-width", "300px");
      host.style.setProperty("--wt-modal-inline-margin", "40px");
      host.style.setProperty("--wt-modal-inline-padding", "7px");
      const rect = modal.shadowRoot!.querySelector("dialog")!.getBoundingClientRect();
      expect(rect.width).toBeCloseTo(expectedWidth, 0);
      expect(rect.left).toBeCloseTo(expectedLeft, 0);
      for (const selector of [".body", ".footer"]) {
        const style = getComputedStyle(modal.shadowRoot!.querySelector(selector)!);
        expect(parseFloat(style.paddingLeft)).toBe(7);
        expect(parseFloat(style.paddingRight)).toBe(7);
      }
    } finally {
      await page.viewport(1280, 900);
    }
  },
);

function dialogOf(modal: WtModal): HTMLDialogElement {
  return modal.shadowRoot!.querySelector("dialog")!;
}

test.each([
  [1280, 900],
  [390, 600],
])("fits short compact content at %i × %i without empty space below it", async (width, height) => {
  await page.viewport(width, height);
  try {
    const modal = await openModal(
      '<div data-content style="height: 40px">Short notice</div>',
      'size="compact"',
    );
    const dialog = dialogOf(modal);
    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    const footer = modal.shadowRoot!.querySelector<HTMLElement>(".footer")!;
    const content = modal.querySelector<HTMLElement>("[data-content]")!;
    await modal.querySelector("wt-form-actions")!.updateComplete;
    const box = dialog.getBoundingClientRect();
    expect(window.innerWidth).toBe(width);
    expect(box.height).toBeLessThan(height / 2);
    expect(height - box.bottom).toBeCloseTo(box.top, 0);
    expect(footer.getBoundingClientRect().top - content.getBoundingClientRect().bottom).toBeCloseTo(
      parseFloat(getComputedStyle(body).paddingBottom),
      0,
    );
    expect(body.scrollHeight).toBe(body.clientHeight);
    expect(dialog.scrollHeight).toBe(dialog.clientHeight);
  } finally {
    await page.viewport(1280, 900);
  }
});

test.each([
  [1280, 900],
  [390, 600],
])("caps long compact content at %i × %i and scrolls only its body", async (width, height) => {
  await page.viewport(width, height);
  try {
    const modal = await openModal(
      '<div style="height: 1800px">Long notice</div>',
      'size="compact"',
    );
    const dialog = dialogOf(modal);
    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    const footer = modal.shadowRoot!.querySelector<HTMLElement>(".footer")!;
    const save = modal.querySelectorAll("wt-button")[1]!;
    await save.updateComplete;
    const box = dialog.getBoundingClientRect();
    expect(box.top).toBeCloseTo(24, 0);
    expect(height - box.bottom).toBeCloseTo(24, 0);
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    const buttons = footer.getBoundingClientRect();
    const saveBox = save.getBoundingClientRect();
    expect(saveBox.bottom).toBeLessThan(box.bottom);
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBeGreaterThan(0);
    expect(footer.getBoundingClientRect().top).toBe(buttons.top);
    expect(save.getBoundingClientRect().top).toBe(saveBox.top);
    expect(dialog.scrollHeight).toBe(dialog.clientHeight);
  } finally {
    await page.viewport(1280, 900);
  }
});

test.each(["standard", "wide", "huge", ""])(
  "keeps a steady height for %s content",
  async (size) => {
    await page.viewport(1280, 900);
    const modal = await openModal("<div data-content>Short notice</div>", `size="${size}"`);
    const dialog = dialogOf(modal);
    expect(dialog.getBoundingClientRect().height).toBeCloseTo(852, 0);
    modal.querySelector<HTMLElement>("[data-content]")!.style.height = "1800px";
    expect(dialog.getBoundingClientRect().height).toBeCloseTo(852, 0);
  },
);

// At 1280px wide the side margin is --wt-space-5 (24px), so the viewport allows 1232px.
test.each([
  ['size="compact"', 448],
  ['size="standard"', 672],
  ['size="wide"', 1024],
  ["no size", 1024],
  ['size="huge"', 1024],
])("is its size's width, with equal side margins, at 1280px wide (%s)", async (size, expected) => {
  await page.viewport(1280, 900);
  const modal = await openModal(undefined, size === "no size" ? "" : size);
  const rect = dialogOf(modal).getBoundingClientRect();
  expect(rect.width).toBeCloseTo(expected, 0);
  expect(1280 - rect.right).toBeCloseTo(rect.left, 0);
  expect(900 - rect.bottom).toBeCloseTo(rect.top, 0);
  if (size === 'size="compact"') expect(rect.height).toBeLessThan(450);
  else expect(rect.height).toBeCloseTo(852, 0);
});

// On a phone the side margin is --wt-space-1 (4px), so every size is the viewport less 8px.
test.each([
  [390, 844, 382],
  [320, 568, 312],
])("fills a %i × %i phone less its margins at every size", async (width, height, expected) => {
  await page.viewport(width, height);
  try {
    for (const size of ['size="compact"', 'size="standard"', 'size="wide"', ""]) {
      const modal = await openModal(undefined, size);
      const rect = dialogOf(modal).getBoundingClientRect();
      expect(rect.width, size || "no size").toBeCloseTo(expected, 0);
      expect(width - rect.right, size || "no size").toBeCloseTo(rect.left, 0);
      cleanup();
    }
  } finally {
    await page.viewport(1280, 900);
  }
});

test("reflects its size and re-sizes an open modal when the size changes", async () => {
  await page.viewport(1280, 900);
  const modal = await openModal();
  const dialog = dialogOf(modal);
  expect(modal.hasAttribute("size")).toBe(false);
  modal.size = "compact";
  await modal.updateComplete;
  expect(modal.getAttribute("size")).toBe("compact");
  expect(dialog.getBoundingClientRect().width).toBeCloseTo(448, 0);
  modal.size = "standard";
  await modal.updateComplete;
  expect(modal.getAttribute("size")).toBe("standard");
  expect(dialog.getBoundingClientRect().width).toBeCloseTo(672, 0);
  modal.size = undefined;
  await modal.updateComplete;
  expect(modal.hasAttribute("size")).toBe(false);
  expect(dialog.getBoundingClientRect().width).toBeCloseTo(1024, 0);
});

test.each([
  ['size="compact"', 448],
  ['size="standard"', 672],
  ['size="wide"', 300],
  ["", 300],
])(
  "lets an ancestor's --wt-modal-max-width size only an unsized or wide modal (%s)",
  async (size, expected) => {
    await page.viewport(1280, 900);
    const modal = await openModal(undefined, size);
    host.style.setProperty("--wt-modal-max-width", "300px");
    expect(dialogOf(modal).getBoundingClientRect().width).toBeCloseTo(expected, 0);
  },
);

test.each([
  ["compact", "--wt-modal-compact-width"],
  ["standard", "--wt-modal-standard-width"],
])("resizes one %s modal through its own size token", async (size, token) => {
  await page.viewport(1280, 900);
  const modal = await openModal(undefined, `size="${size}"`);
  modal.style.setProperty(token, "350px");
  expect(dialogOf(modal).getBoundingClientRect().width).toBeCloseTo(350, 0);
});

test.each(["compact", "standard"])(
  "keeps a wide and an unsized modal opened inside a %s modal at the wide width",
  async (size) => {
    await page.viewport(1280, 900);
    const outer = await openModal(
      `<wt-modal data-inner size="wide" heading="Choose an image">Images</wt-modal>
      <wt-modal data-inner heading="Notice">Text</wt-modal>`,
      `size="${size}"`,
    );
    for (const inner of outer.querySelectorAll<WtModal>("[data-inner]")) {
      inner.open = true;
      await inner.updateComplete;
      const label = inner.getAttribute("size") ?? "no size";
      expect(dialogOf(inner).matches(":modal"), label).toBe(true);
      expect(dialogOf(inner).getBoundingClientRect().width, label).toBeCloseTo(1024, 0);
      expect(dialogOf(inner).getBoundingClientRect().height, label).toBeCloseTo(852, 0);
    }
  },
);

/** One of every shared form field, in the grid a form lays its fields out in. */
const FIELDS = `<div style="display: grid">
  <wt-input label="Name"></wt-input>
  <wt-combobox label="Product"></wt-combobox>
  <wt-price-input label="Price" unit="€"></wt-price-input>
  <wt-number-stepper label="Guests"></wt-number-stepper>
  <wt-switch label="Active"></wt-switch>
  <wt-textarea label="Notes"></wt-textarea>
</div>`;

type TableRow = { id: string; name: string };

async function fieldsIn(root: ParentNode): Promise<HTMLElement[]> {
  const fields = [
    ...root.querySelectorAll<HTMLElement>(
      "wt-input, wt-combobox, wt-price-input, wt-number-stepper, wt-switch, wt-textarea",
    ),
  ];
  for (const field of fields) await (field as WtModal).updateComplete;
  return fields;
}

/** A modal holding every form field, a wide block, a table and a footer row carrying a message. */
async function openForm(attributes = ""): Promise<{ modal: WtModal; fields: HTMLElement[] }> {
  const modal = await openModal(
    `${FIELDS}
    <div data-wide style="height: 1px"></div>
    <wt-data-table aria-label="Rows"></wt-data-table>`,
    attributes,
  );
  const table = modal.querySelector<WtDataTable<TableRow>>("wt-data-table")!;
  table.columns = [{ key: "name", label: "Name", cell: (row) => row.name }];
  table.rows = [{ id: "a", name: "Ada" }];
  table.rowKey = (row) => row.id;
  await table.updateComplete;
  const actions = modal.querySelector<HTMLElement & { error: string }>("wt-form-actions")!;
  actions.error = "Correct the highlighted fields to continue.";
  await modal.updateComplete;
  return { modal, fields: await fieldsIn(modal) };
}

/** The width the modal's body gives its content: the body less its inline padding. */
function contentWidth(modal: WtModal): number {
  const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
  const style = getComputedStyle(body);
  return body.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

test("holds every form field and the form's message to the form width on a wide window", async () => {
  await page.viewport(1280, 900);
  const { modal, fields } = await openForm();
  const form = px("var(--wt-form-max-width)");
  expect(contentWidth(modal)).toBeGreaterThan(form);
  for (const field of fields) {
    expect(field.getBoundingClientRect().width, field.localName).toBeCloseTo(form, 0);
  }
  const message = modal.shadowRoot!.querySelector<HTMLElement>(".body > [data-error]")!;
  expect(message.getBoundingClientRect().width).toBeCloseTo(form, 0);
});

test("leaves wide content, and the footer's actions, the modal's full width on a wide window", async () => {
  await page.viewport(1280, 900);
  const { modal } = await openForm();
  const width = contentWidth(modal);
  expect(modal.querySelector<HTMLElement>("[data-wide]")!.getBoundingClientRect().width).toBe(
    width,
  );
  expect(modal.querySelector("wt-data-table")!.getBoundingClientRect().width).toBe(width);
  expect(modal.querySelector("wt-form-actions")!.getBoundingClientRect().width).toBe(width);
});

test("gives a field the body's whole width on a 390px-wide phone", async () => {
  await page.viewport(390, 844);
  try {
    const { modal, fields } = await openForm();
    const width = contentWidth(modal);
    expect(width).toBeLessThan(px("var(--wt-form-max-width)"));
    for (const field of fields) {
      expect(field.getBoundingClientRect().width, field.localName).toBeCloseTo(width, 0);
    }
  } finally {
    await page.viewport(1280, 900);
  }
});

test.each([
  ['size="compact"', "body"],
  ['size="standard"', "form"],
  ['size="wide"', "form"],
  ["", "form"],
])(
  "bounds every field by the narrower of the form width and the body at 1280px wide (%s)",
  async (size, bound) => {
    await page.viewport(1280, 900);
    const { modal, fields } = await openForm(size);
    const form = px("var(--wt-form-max-width)");
    const content = contentWidth(modal);
    if (bound === "body") expect(content).toBeLessThan(form);
    else expect(content).toBeGreaterThan(form);
    const expected = bound === "body" ? content : form;
    for (const field of fields) {
      expect(field.getBoundingClientRect().width, field.localName).toBeCloseTo(expected, 0);
    }
    const message = modal.shadowRoot!.querySelector<HTMLElement>(".body > [data-error]")!;
    expect(message.getBoundingClientRect().width).toBeCloseTo(expected, 0);
  },
);

test("holds every field at the form width in a standard modal beside a classic scrollbar", async () => {
  await page.viewport(1280, 900);
  const modal = await openModal(FIELDS, 'size="standard"');
  const fields = await fieldsIn(modal);
  // This headless Chromium hides scrollbars, so the room a classic one takes from the body (a 17px
  // allowance) is stood in as extra end padding.
  const scrollbar = new CSSStyleSheet();
  scrollbar.replaceSync(
    ".body { padding-inline-end: calc(var(--wt-modal-inline-padding) + 17px); }",
  );
  modal.shadowRoot!.adoptedStyleSheets = [...modal.shadowRoot!.adoptedStyleSheets, scrollbar];
  // 672px less a 1px border and 24px of padding each side, less 17px.
  expect(contentWidth(modal)).toBeCloseTo(605, 0);
  const form = px("var(--wt-form-max-width)");
  for (const field of fields) {
    expect(field.getBoundingClientRect().width, field.localName).toBeCloseTo(form, 0);
  }
});

test("leaves a field outside a modal as wide as its container", async () => {
  await page.viewport(1280, 900);
  await mount(FIELDS);
  host.style.width = "1000px";
  const fields = await fieldsIn(host);
  expect(px("var(--wt-form-max-width)")).toBeLessThan(1000);
  for (const field of fields) {
    expect(field.getBoundingClientRect().width, field.localName).toBe(1000);
  }
});

test("scrolls long content while both footer actions stay visible and stationary", async () => {
  await page.viewport(390, 600);
  try {
    const modal = await openModal('<div style="height: 1800px">Long form</div>');
    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    const dialog = modal.shadowRoot!.querySelector("dialog")!;
    const cancel = modal.querySelector("wt-button")!;
    const save = modal.querySelectorAll("wt-button")[1]!;
    await save.updateComplete;
    const before = save.getBoundingClientRect();
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBeGreaterThan(0);
    expect(save.getBoundingClientRect().top).toBe(before.top);
    expect(before.bottom).toBeLessThan(dialog.getBoundingClientRect().bottom);
    expect(cancel.getBoundingClientRect().top).toBe(before.top);
    expect(cancel.getBoundingClientRect().right).toBeLessThan(before.left);
    expect(dialog.scrollHeight).toBe(dialog.clientHeight);
  } finally {
    await page.viewport(1280, 900);
  }
});

test("uses a white surface and a soft shadow in the light theme", async () => {
  const modal = await openModal();
  host.dataset.theme = "light";
  const style = getComputedStyle(modal.shadowRoot!.querySelector("dialog")!);
  expect(style.backgroundColor).toBe("rgb(255, 255, 255)");
  expect(style.boxShadow).not.toBe("none");
});

test("Escape closes the modal, emits wt-close and returns focus to what had it when it opened", async () => {
  const modal = await openModal();
  const initiallyClosed = new Promise<void>((resolve) =>
    modal.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  modal.open = false;
  await modal.updateComplete;
  await initiallyClosed;
  const trigger = document.createElement("button");
  host.prepend(trigger);
  trigger.focus();
  modal.open = true;
  await modal.updateComplete;
  expect(document.activeElement).not.toBe(trigger);
  const closed = new Promise<void>((resolve) =>
    modal.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  await userEvent.keyboard("{Escape}");
  await closed;
  expect(modal.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

test("keeps the body in the tab order, whether or not there is anything to scroll", async () => {
  // A reader who cannot focus the body cannot scroll it from the keyboard. Chromium makes a scrolling
  // text box focusable by itself, so the short modal is the case that shows the component doing it.
  // `tabIndex` is asserted because `.focus()` and showModal()'s initial focus both work at -1 too.
  const short = await openModal();
  const shortBody = short.shadowRoot!.querySelector<HTMLElement>(".body")!;
  expect(shortBody.tabIndex).toBe(0);
  expect(short.shadowRoot!.activeElement).toBe(shortBody);
  short.open = false;
  await short.updateComplete;

  const long = await openModal('<div style="height: 1800px">Long notice</div>');
  const longBody = long.shadowRoot!.querySelector<HTMLElement>(".body")!;
  expect(longBody.tabIndex).toBe(0);
  expect(long.shadowRoot!.activeElement).toBe(longBody);
  await userEvent.keyboard("{PageDown}");
  // The browser lands the scroll several frames after the key press, not on the next one.
  await vi.waitFor(() => expect(longBody.scrollTop).toBeGreaterThan(0));
});

async function openModalWithMessage(body: string, footer: string) {
  const modal = (await mount(`<wt-modal heading="Add printer">
    ${body}
    <wt-form-actions slot="footer">${footer}<wt-button>Save</wt-button></wt-form-actions>
  </wt-modal>`)) as WtModal;
  modal.open = true;
  await modal.updateComplete;
  const actions = modal.querySelector("wt-form-actions")!;
  actions.error = "This device already holds a passkey for your account.";
  await actions.updateComplete;
  await modal.updateComplete;
  return { modal, actions };
}

test.each([
  ["with Cancel", '<wt-button slot="cancel" variant="secondary">Cancel</wt-button>'],
  ["without Cancel", ""],
])(
  "shows the footer actions' message in the body, below the last field, not in the footer (%s)",
  async (_, cancel) => {
    const { modal, actions } = await openModalWithMessage(
      '<wt-input name="name" label="Name"></wt-input>',
      cancel,
    );
    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    const footer = modal.shadowRoot!.querySelector<HTMLElement>(".footer")!;
    const message = body.querySelector<HTMLElement>("[data-error]")!;
    expect(message.textContent).toBe("This device already holds a passkey for your account.");
    expect(message.getAttribute("role")).toBe("alert");
    expect(footer.querySelector("[data-error]")).toBeNull();
    expect(actions.shadowRoot!.querySelector("[data-error]")).toBeNull();
    const field = modal.querySelector("wt-input")!.getBoundingClientRect();
    const box = message.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(field.bottom);
    expect(box.bottom).toBeLessThanOrEqual(footer.getBoundingClientRect().top);
    expect(getComputedStyle(message).textAlign).toBe("start");
  },
);

test("clears the body's message when the footer actions' message is cleared", async () => {
  const { modal, actions } = await openModalWithMessage("Printer settings", "");
  expect(modal.shadowRoot!.querySelector("[data-error]")).not.toBeNull();
  actions.error = "";
  await actions.updateComplete;
  await modal.updateComplete;
  expect(modal.shadowRoot!.querySelector("[data-error]")).toBeNull();
});

test("brings the message into view at the end of a long body", async () => {
  await page.viewport(390, 500);
  try {
    const { modal } = await openModalWithMessage(
      `<div style="height: 2000px">Long settings</div>`,
      "",
    );
    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    await vi.waitFor(() => expect(body.scrollTop).toBeGreaterThan(0));
    const message = body.querySelector<HTMLElement>("[data-error]")!.getBoundingClientRect();
    expect(message.bottom).toBeLessThanOrEqual(body.getBoundingClientRect().bottom + 1);
  } finally {
    await page.viewport(1280, 900);
  }
});

test("leaves actions placed in the body showing their own message", async () => {
  const modal = (await mount(`<wt-modal heading="Pay">
    <wt-form-actions><wt-button>Pay</wt-button></wt-form-actions>
  </wt-modal>`)) as WtModal;
  modal.open = true;
  await modal.updateComplete;
  const actions = modal.querySelector("wt-form-actions")!;
  actions.error = "Choose a payment method.";
  await actions.updateComplete;
  await modal.updateComplete;
  expect(actions.shadowRoot!.querySelector("[data-error]")!.textContent).toBe(
    "Choose a payment method.",
  );
  expect(modal.shadowRoot!.querySelector("[data-error]")).toBeNull();
});

test("gives actions moved out of the footer their own message back", async () => {
  const { modal, actions } = await openModalWithMessage("Printer settings", "");
  actions.removeAttribute("slot");
  await vi.waitFor(() =>
    expect(actions.shadowRoot!.querySelector("[data-error]")?.textContent).toBe(
      "This device already holds a passkey for your account.",
    ),
  );
  await modal.updateComplete;
  expect(modal.shadowRoot!.querySelector("[data-error]")).toBeNull();
});

test("paints the body's message from the danger token", async () => {
  const { modal } = await openModalWithMessage("Printer settings", "");
  host.style.setProperty("--wt-color-danger", "rgb(1, 2, 3)");
  const message = modal.shadowRoot!.querySelector<HTMLElement>(".body [data-error]")!;
  expect(getComputedStyle(message).color).toBe("rgb(1, 2, 3)");
});

test("opens with a message its footer actions already carry, and shows it in the body", async () => {
  const errors: unknown[] = [];
  const onError = (event: PromiseRejectionEvent) => errors.push(event.reason);
  window.addEventListener("unhandledrejection", onError);
  try {
    const modal = (await mount(`<wt-modal heading="Add printer" open>
      <wt-input name="name" label="Name"></wt-input>
      <wt-form-actions slot="footer" error="Check the form and try again">
        <wt-button>Save</wt-button>
      </wt-form-actions>
    </wt-modal>`)) as WtModal;
    await vi.waitFor(() =>
      expect(modal.shadowRoot!.querySelector(".body [data-error]")?.textContent).toBe(
        "Check the form and try again",
      ),
    );
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await new Promise((resolve) => setTimeout(resolve));
    expect(errors).toEqual([]);
  } finally {
    window.removeEventListener("unhandledrejection", onError);
  }
});

async function mountTwoRows(first: string, second: string) {
  const modal = (await mount(`<wt-modal heading="Add printer" open>
    <wt-input name="name" label="Name"></wt-input>
    <wt-form-actions slot="footer" error="${first}"><wt-button>Test</wt-button></wt-form-actions>
    <wt-form-actions slot="footer" error="${second}"><wt-button>Save</wt-button></wt-form-actions>
  </wt-modal>`)) as WtModal;
  const [one, two] = modal.querySelectorAll("wt-form-actions");
  await one!.updateComplete;
  await two!.updateComplete;
  await modal.updateComplete;
  return { modal, one: one!, two: two! };
}

function bodyMessage(modal: WtModal): string | undefined {
  return modal.shadowRoot!.querySelector(".body > [data-error]")?.textContent;
}

test("shows the first footer row's message when a second, empty row follows it", async () => {
  const { modal, one, two } = await mountTwoRows("The printer did not answer.", "");
  expect(bodyMessage(modal)).toBe("The printer did not answer.");
  expect(one.shadowRoot!.querySelector("[data-error]")).toBeNull();
  expect(two.shadowRoot!.querySelector("[data-error]")).toBeNull();
});

test("keeps one footer row's message when another row's message is cleared", async () => {
  const { modal, two } = await mountTwoRows("The printer did not answer.", "Enter a name.");
  expect(bodyMessage(modal)).toBe("The printer did not answer. Enter a name.");
  two.error = "";
  await two.updateComplete;
  await modal.updateComplete;
  expect(bodyMessage(modal)).toBe("The printer did not answer.");
});

/** A body taller than the dialog, so a message at its end starts out of view. */
const LONG_BODY = `<div style="height: 2000px">Long settings</div>`;

function expectInsideBody(modal: WtModal, message: Element): void {
  const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!.getBoundingClientRect();
  const box = message.getBoundingClientRect();
  expect(box.top).toBeGreaterThanOrEqual(body.top - 1);
  expect(box.bottom).toBeLessThanOrEqual(body.bottom + 1);
}

test("brings a message it already carries into view when it opens", async () => {
  await page.viewport(390, 500);
  try {
    const modal = (await mount(`<wt-modal heading="Add printer">
      ${LONG_BODY}
      <wt-form-actions slot="footer" error="The printer did not answer.">
        <wt-button>Save</wt-button>
      </wt-form-actions>
    </wt-modal>`)) as WtModal;
    const actions = modal.querySelector("wt-form-actions")!;
    const message = (await formMessageOf(actions))!;
    expect(message.textContent).toBe("The printer did not answer.");
    modal.open = true;
    await modal.updateComplete;
    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    await vi.waitFor(() => expect(body.scrollTop).toBeGreaterThan(0));
    expectInsideBody(modal, message);
  } finally {
    await page.viewport(1280, 900);
  }
});

test("brings the message of actions placed in the body into view when it appears", async () => {
  await page.viewport(390, 500);
  try {
    const modal = (await mount(`<wt-modal heading="Pay">
      ${LONG_BODY}
      <wt-form-actions><wt-button>Pay</wt-button></wt-form-actions>
    </wt-modal>`)) as WtModal;
    modal.open = true;
    await modal.updateComplete;
    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    body.scrollTop = 0;
    const actions = modal.querySelector("wt-form-actions")!;
    actions.error = "Choose a payment method.";
    const message = (await formMessageOf(actions))!;
    expect(message.textContent).toBe("Choose a payment method.");
    await vi.waitFor(() => expect(body.scrollTop).toBeGreaterThan(0));
    expectInsideBody(modal, message);
  } finally {
    await page.viewport(1280, 900);
  }
});

const REFUSAL = "Correct the highlighted fields to continue.";

/** A modal with a name field at the top of a long body, and actions placed by `slot`. */
async function openUnitForm(slot: string) {
  const modal = (await mount(`<wt-modal heading="Add unit">
    <wt-input name="name" label="Name"></wt-input>
    ${LONG_BODY}
    <wt-form-actions ${slot}><wt-button>Save</wt-button></wt-form-actions>
  </wt-modal>`)) as WtModal;
  modal.open = true;
  await modal.updateComplete;
  const input = modal.querySelector("wt-input")!;
  await input.updateComplete;
  return {
    modal,
    body: modal.shadowRoot!.querySelector<HTMLElement>(".body")!,
    actions: modal.querySelector("wt-form-actions")!,
    input,
    field: input.shadowRoot!.querySelector("input")!,
  };
}

test.each([
  ["in the footer", 'slot="footer"'],
  ["in the body", ""],
])(
  "does not scroll away from a field being typed in when the message of actions %s reappears",
  async (_, slot) => {
    await page.viewport(390, 500);
    try {
      const { modal, body, actions, input, field } = await openUnitForm(slot);
      // A form that re-checks its fields on every keystroke, as the unit form does after a failed save.
      input.addEventListener("wt-change", () => (actions.error = REFUSAL));
      field.focus();
      body.scrollTop = 0;
      await userEvent.keyboard("k");
      expect((await formMessageOf(actions))?.textContent).toBe(REFUSAL);
      await modal.updateComplete;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(body.scrollTop).toBe(0);
    } finally {
      await page.viewport(1280, 900);
    }
  },
);

test.each([
  ["a text area", '<textarea name="notes" aria-label="Notes"></textarea>', "keyboard"],
  [
    "a list",
    '<select name="unit" aria-label="Unit"><option>kg</option><option>g</option></select>',
    "select",
  ],
])("does not scroll away from %s in focus when the message reappears", async (_, field, how) => {
  await page.viewport(390, 500);
  try {
    const modal = (await mount(`<wt-modal heading="Add unit">
      ${field}
      ${LONG_BODY}
      <wt-form-actions slot="footer"><wt-button>Save</wt-button></wt-form-actions>
    </wt-modal>`)) as WtModal;
    modal.open = true;
    await modal.updateComplete;
    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    const actions = modal.querySelector("wt-form-actions")!;
    const control = modal.querySelector<HTMLTextAreaElement | HTMLSelectElement>(
      "textarea, select",
    )!;
    control.addEventListener("input", () => (actions.error = REFUSAL));
    control.focus();
    body.scrollTop = 0;
    if (how === "keyboard") await userEvent.keyboard("k");
    else await userEvent.selectOptions(control as HTMLSelectElement, "g");
    expect((await formMessageOf(actions))?.textContent).toBe(REFUSAL);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(body.scrollTop).toBe(0);
  } finally {
    await page.viewport(1280, 900);
  }
});

test.each([
  ["in the footer", 'slot="footer"'],
  ["in the body", ""],
])(
  "brings a refused save's message for actions %s into view when Enter submitted it from a field",
  async (_, slot) => {
    await page.viewport(390, 500);
    try {
      const { modal, body, actions, input, field } = await openUnitForm(slot);
      // The save request answers in a later task, as a network response does.
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") setTimeout(() => (actions.error = REFUSAL));
      });
      field.focus();
      body.scrollTop = 0;
      await userEvent.keyboard("k");
      await userEvent.keyboard("{Enter}");
      await vi.waitFor(() => expect(body.scrollTop).toBeGreaterThan(0));
      const message = (await formMessageOf(actions))!;
      expect(message.textContent).toBe(REFUSAL);
      expectInsideBody(modal, message);
      expect(input.shadowRoot!.activeElement).toBe(field);
    } finally {
      await page.viewport(1280, 900);
    }
  },
);
