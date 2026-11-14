import { afterEach, expect, onTestFinished, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-button.js";
import type { WtFormActions } from "./wt-form-actions.js";
import "./wt-form-actions.js";

afterEach(cleanup);

test("places cancel at the left and the primary action at the right", async () => {
  const el = await mount(
    '<wt-form-actions><wt-button slot="cancel">Cancel</wt-button><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  );
  const row = el.shadowRoot!.querySelector<HTMLElement>("[data-actions]")!;
  const cancel = el.querySelector<HTMLElement>('[slot="cancel"]')!;
  const primary = el.querySelector<HTMLElement>("wt-button:not([slot])")!;
  expect(cancel.getBoundingClientRect().left).toBe(row.getBoundingClientRect().left);
  expect(primary.getBoundingClientRect().right).toBe(row.getBoundingClientRect().right);
});

test("keeps a lone primary action on the right", async () => {
  const el = await mount(
    '<wt-form-actions><wt-button variant="primary">Continue</wt-button></wt-form-actions>',
  );
  const row = el.shadowRoot!.querySelector<HTMLElement>("[data-actions]")!;
  const primary = el.querySelector<HTMLElement>("wt-button")!;
  expect(primary.getBoundingClientRect().right).toBe(row.getBoundingClientRect().right);
});

test("shows no message until the form gives one", async () => {
  const el = await mount(
    '<wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  );
  expect(el.shadowRoot!.querySelector("[data-error]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
});

test("announces the form's message on its own line above the actions, from the left edge", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button slot="cancel">Cancel</wt-button><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  host.style.width = "800px";
  el.error = "Correct the highlighted fields to continue.";
  await el.updateComplete;

  const message = el.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  expect(message.getAttribute("role")).toBe("alert");
  expect(message.textContent).toBe("Correct the highlighted fields to continue.");
  const box = message.getBoundingClientRect();
  const primary = el.querySelector<HTMLElement>("wt-button:not([slot])")!.getBoundingClientRect();
  const cancel = el.querySelector<HTMLElement>('[slot="cancel"]')!.getBoundingClientRect();
  const own = el.getBoundingClientRect();
  expect(box.bottom).toBeLessThanOrEqual(primary.top);
  expect(box.bottom).toBeLessThanOrEqual(cancel.top);
  expect(box.left).toBe(own.left);
  expect(box.right).toBe(own.right);
  expect(getComputedStyle(message).textAlign).toBe("start");
});

test("holds its message to the field cap a container sets, while its actions keep the full row", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  host.style.width = "800px";
  host.style.setProperty("--wt-field-max-width", "300px");
  el.error = "Correct the highlighted fields to continue.";
  await el.updateComplete;
  const message = el
    .shadowRoot!.querySelector<HTMLElement>("[data-error]")!
    .getBoundingClientRect();
  const own = el.getBoundingClientRect();
  expect(message.left).toBe(own.left);
  expect(message.width).toBe(300);
  expect(el.querySelector<HTMLElement>("wt-button")!.getBoundingClientRect().right).toBe(own.right);
});

test("keeps the primary action on the right while a message shows", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  el.error = "Correct the highlighted fields to continue.";
  await el.updateComplete;
  const row = el.shadowRoot!.querySelector<HTMLElement>("[data-actions]")!;
  const primary = el.querySelector<HTMLElement>("wt-button")!;
  expect(primary.getBoundingClientRect().right).toBe(row.getBoundingClientRect().right);
});

test("on a narrow (320 px) row too, puts the message on its own line above the actions, within the row's width", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button slot="cancel">Cancel</wt-button><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  host.style.width = "320px";
  el.error = "Correct the highlighted fields to continue.";
  await el.updateComplete;

  const message = el
    .shadowRoot!.querySelector<HTMLElement>("[data-error]")!
    .getBoundingClientRect();
  const primary = el.querySelector<HTMLElement>("wt-button:not([slot])")!.getBoundingClientRect();
  const row = el.shadowRoot!.querySelector<HTMLElement>("[data-actions]")!.getBoundingClientRect();
  expect(message.bottom).toBeLessThanOrEqual(primary.top);
  expect(message.right).toBeLessThanOrEqual(row.right);
  expect(primary.right).toBe(row.right);
});

test("on a narrow (320 px) row, keeps cancel level with the primary action below the message", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button slot="cancel">Cancel</wt-button><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  host.style.width = "320px";
  el.error = "Correct the highlighted fields to continue.";
  await el.updateComplete;

  const message = el
    .shadowRoot!.querySelector<HTMLElement>("[data-error]")!
    .getBoundingClientRect();
  const cancel = el.querySelector<HTMLElement>('[slot="cancel"]')!.getBoundingClientRect();
  const primary = el.querySelector<HTMLElement>("wt-button:not([slot])")!.getBoundingClientRect();
  expect(message.bottom).toBeLessThanOrEqual(primary.top);
  expect(cancel.top).toBe(primary.top);
  expect(cancel.bottom).toBe(primary.bottom);
});

test("puts the message above a lone cancel action", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button slot="cancel">Close</wt-button></wt-form-actions>',
  )) as WtFormActions;
  host.style.width = "800px";
  el.error = "That agent was already paired.";
  await el.updateComplete;

  const message = el
    .shadowRoot!.querySelector<HTMLElement>("[data-error]")!
    .getBoundingClientRect();
  const cancel = el.querySelector<HTMLElement>('[slot="cancel"]')!.getBoundingClientRect();
  expect(message.bottom).toBeLessThanOrEqual(cancel.top);
  expect(message.left).toBe(cancel.left);
});

test("shows no message of its own while its container shows it", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  el.showError = false;
  el.error = "Correct the highlighted fields to continue.";
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-error]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
});

test("reports each change of its message to its container", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  const seen: string[] = [];
  const composed: boolean[] = [];
  host.addEventListener("wt-form-error", (event) => {
    seen.push((event as CustomEvent<{ message: string }>).detail.message);
    composed.push(event.composed);
  });
  el.error = "Correct the highlighted fields to continue.";
  await el.updateComplete;
  el.error = "";
  await el.updateComplete;
  expect(seen).toEqual(["Correct the highlighted fields to continue.", ""]);
  expect(composed).toEqual([true, true]);
});

test("reports nothing when only whether it shows its message changes", async () => {
  const el = (await mount(
    '<wt-form-actions error="Check the name."><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  await el.updateComplete;
  const seen: string[] = [];
  host.addEventListener("wt-form-error", (event) => seen.push(event.detail.message));
  el.showError = false;
  await el.updateComplete;
  expect(seen).toEqual([]);
});

test("paints the message from the danger token", async () => {
  const el = (await mount(
    '<wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  el.error = "Correct the highlighted fields to continue.";
  await el.updateComplete;
  host.style.setProperty("--wt-color-danger", "rgb(1, 2, 3)");

  const message = getComputedStyle(el.shadowRoot!.querySelector<HTMLElement>("[data-error]")!);
  expect(message.color).toBe("rgb(1, 2, 3)");
});

test("spaces direct Cancel and Delete controls with the shared token and wraps them", async () => {
  const el = await mount(
    '<wt-form-actions><wt-button slot="cancel">Cancel</wt-button><wt-button slot="cancel" variant="danger">Delete</wt-button><wt-button>Save</wt-button></wt-form-actions>',
  );
  host.style.width = "320px";
  host.style.setProperty("--wt-space-2", "13px");
  const [cancel, remove, save] = [...el.querySelectorAll<HTMLElement>("wt-button")];
  const first = cancel!.getBoundingClientRect();
  const second = remove!.getBoundingClientRect();
  expect(second.left - first.right).toBe(13);
  expect(second.right).toBeLessThan(save!.getBoundingClientRect().left);
  host.style.width = "180px";
  const wrapped = remove!.getBoundingClientRect();
  expect(wrapped.left).toBe(cancel!.getBoundingClientRect().left);
  expect(wrapped.top - cancel!.getBoundingClientRect().bottom).toBe(13);
  expect(save!.getBoundingClientRect().right).toBe(el.getBoundingClientRect().right);
});

const TALL_FORM = `<div data-scroller style="height: 200px; overflow-y: auto">
  <div style="height: 1000px">Fields</div>
  <wt-form-actions error="Correct the highlighted fields to continue."><wt-button slot="cancel">Cancel</wt-button><wt-button variant="primary">Save</wt-button></wt-form-actions>
</div>`;

async function mountTallForm() {
  const scroller = (await mount(TALL_FORM)) as HTMLElement;
  const el = scroller.querySelector<WtFormActions>("wt-form-actions")!;
  await el.updateComplete;
  return { scroller, el };
}

const separatorColor = (el: WtFormActions) =>
  getComputedStyle(el.shadowRoot!.querySelector<HTMLElement>("[data-bar]")!).borderTopColor;

const UNPAINTED = "rgba(0, 0, 0, 0)";

test("stays at the bottom of whatever scrolls, message above its buttons, until the form's end", async () => {
  const { scroller, el } = await mountTallForm();
  const box = scroller.getBoundingClientRect();
  expect(el.getBoundingClientRect().bottom).toBe(box.bottom);
  const message = el
    .shadowRoot!.querySelector<HTMLElement>("[data-error]")!
    .getBoundingClientRect();
  const save = el.querySelector<HTMLElement>("wt-button:not([slot])")!.getBoundingClientRect();
  expect(message.top).toBeGreaterThanOrEqual(box.top);
  expect(message.bottom).toBeLessThanOrEqual(save.top);
  expect(save.bottom).toBeLessThanOrEqual(box.bottom);

  scroller.scrollTop = scroller.scrollHeight;
  const block = scroller.firstElementChild!.getBoundingClientRect();
  expect(el.getBoundingClientRect().top).toBe(block.bottom);
});

test("scrolled into view while held, brings its place at the form's end into view, with what is said just above it", async () => {
  const scroller = (await mount(`<div style="height: 200px; overflow-y: auto">
    <div style="height: 1000px">Fields</div>
    <p data-said style="margin: 0; height: 30px">Refused</p>
    <wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>
  </div>`)) as HTMLElement;
  const row = scroller.querySelector<WtFormActions>("wt-form-actions")!;
  await row.updateComplete;
  const said = scroller.querySelector<HTMLElement>("[data-said]")!;
  expect(row.getBoundingClientRect().bottom, "held at the scroller's foot").toBe(
    scroller.getBoundingClientRect().bottom,
  );

  row.scrollIntoView({ block: "nearest" });

  const view = scroller.getBoundingClientRect();
  const box = said.getBoundingClientRect();
  expect(box.top).toBeGreaterThanOrEqual(view.top);
  expect(box.bottom).toBe(row.getBoundingClientRect().top);
  expect(row.getBoundingClientRect().bottom).toBe(view.bottom);
  expect(getComputedStyle(row).position, "held again afterwards").toBe("sticky");
  expect(row.style.position).toBe("");
});

test("draws a line along its top edge only while it is held at the bottom", async () => {
  const { scroller, el } = await mountTallForm();
  const height = el.getBoundingClientRect().height;
  await vi.waitFor(() => expect(separatorColor(el)).not.toBe(UNPAINTED));
  expect(el.getBoundingClientRect().height, "being held keeps the row's height").toBe(height);
  const bar = el.shadowRoot!.querySelector<HTMLElement>("[data-bar]")!;
  expect(bar.getBoundingClientRect().top).toBe(el.getBoundingClientRect().top);
  scroller.scrollTop = scroller.scrollHeight;
  await vi.waitFor(() => expect(separatorColor(el)).toBe(UNPAINTED));

  const short = (await mount(
    '<wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(separatorColor(short)).toBe(UNPAINTED);
});

test("paints the line from the border token", async () => {
  const { el } = await mountTallForm();
  host.style.setProperty("--wt-color-border", "rgb(4, 5, 6)");
  await vi.waitFor(() => expect(separatorColor(el)).not.toBe(UNPAINTED));
  const bar = el.shadowRoot!.querySelector<HTMLElement>("[data-bar]")!;
  expect(getComputedStyle(bar).borderTopColor).toBe("rgb(4, 5, 6)");
});

test("paints the surface its container names, or the surface token", async () => {
  const el = await mount(
    '<wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  );
  host.style.setProperty("--wt-color-surface", "rgb(7, 8, 9)");
  expect(getComputedStyle(el).backgroundColor).toBe("rgb(7, 8, 9)");
  host.style.setProperty("--wt-form-actions-surface", "rgb(10, 11, 12)");
  expect(getComputedStyle(el).backgroundColor).toBe("rgb(10, 11, 12)");
});

test("pads its block ends with the shared space token", async () => {
  const el = await mount(
    '<wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  );
  host.style.setProperty("--wt-space-2", "13px");
  const style = getComputedStyle(el);
  const bar = getComputedStyle(el.shadowRoot!.querySelector<HTMLElement>("[data-bar]")!);
  expect([bar.paddingTop, style.paddingBottom, style.position]).toEqual(["13px", "13px", "sticky"]);
});

test("under an ancestor that marks the row as laid out in place (as a dialog's footer does), keeps its place: not held, no padding, line or background", async () => {
  const el = await mount(
    '<div><wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions></div>',
  );
  host.style.setProperty("--wt-space-2", "13px");
  host.style.setProperty("--wt-form-actions-in-place", "true");
  const row = el.querySelector("wt-form-actions")!;
  const style = getComputedStyle(row);
  const bar = getComputedStyle(row.shadowRoot!.querySelector<HTMLElement>("[data-bar]")!);
  expect(style.position).toBe("static");
  expect([bar.paddingTop, style.paddingBottom, bar.borderTopWidth]).toEqual(["0px", "0px", "0px"]);
  expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
});

/** A 200 px scroller: two fields, the second at 150–170 px, under the held row with its message. */
const FIELDS_ABOVE_ROW = `<div style="height: 200px; overflow-y: auto">
  <input aria-label="First" style="display: block; height: 20px; box-sizing: border-box" />
  <div style="height: 130px"></div>
  <input aria-label="Second" style="display: block; height: 20px; box-sizing: border-box" />
  <div style="height: 800px"></div>
  <input aria-label="Last" style="display: block; height: 20px; box-sizing: border-box" />
  <div style="height: 800px"></div>
  <wt-form-actions error="Correct the highlighted fields to continue."><wt-button variant="primary">Save</wt-button></wt-form-actions>
</div>`;

async function mountFieldsAboveRow() {
  const scroller = (await mount(FIELDS_ABOVE_ROW)) as HTMLElement;
  const row = scroller.querySelector<WtFormActions>("wt-form-actions")!;
  await row.updateComplete;
  const [first, second, last] = [...scroller.querySelectorAll("input")];
  return { scroller, row, first: first!, second: second!, last: last! };
}

/** Waits until `field` lies wholly inside `scroller`'s view and above `row`. */
async function expectClearOfRow(scroller: HTMLElement, row: HTMLElement, field: HTMLElement) {
  await vi.waitFor(() => {
    const box = field.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(scroller.getBoundingClientRect().top);
    expect(box.bottom).toBeLessThanOrEqual(row.getBoundingClientRect().top);
  });
}

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

test("scrolls a field Tab reaches under the held row until it is clear of the row", async () => {
  const { scroller, row, first, second } = await mountFieldsAboveRow();
  expect(second.getBoundingClientRect().bottom).toBeGreaterThan(row.getBoundingClientRect().top);
  first.focus();
  await userEvent.tab();
  expect(document.activeElement).toBe(second);
  await expectClearOfRow(scroller, row, second);
});

test("scrolls a field focused below the view clear of the held row, not just into the view", async () => {
  const { scroller, row, last } = await mountFieldsAboveRow();
  // The browser brings a focused field to the middle of a view this short, under the row.
  scroller.style.height = "120px";
  last.focus();
  await expectClearOfRow(scroller, row, last);
});

test("scrolls what scrolls under it, past a shadow root and an element between that lets its content overflow", async () => {
  const scroller = (await mount(
    '<div style="height: 200px; overflow-y: auto"><div style="height: 50px"></div></div>',
  )) as HTMLElement;
  const root = scroller.firstElementChild!.attachShadow({ mode: "open" });
  root.innerHTML = FIELDS_ABOVE_ROW.replace(/^<div[^>]*>|<\/div>$/g, "");
  const row = root.querySelector<WtFormActions>("wt-form-actions")!;
  await row.updateComplete;
  const [first, second] = root.querySelectorAll("input");
  expect(second!.getBoundingClientRect().bottom).toBeGreaterThan(row.getBoundingClientRect().top);
  first!.focus();
  await userEvent.tab();
  expect(root.activeElement).toBe(second);
  await expectClearOfRow(scroller, row, second!);
});

test("scrolls what scrolls under it, past an element between that clips its content and so cannot scroll", async () => {
  const scroller = (await mount(`<div style="height: 200px; overflow-y: auto">
    <div data-clip style="height: 200px; overflow-y: clip"></div>
    <div style="height: 1000px"></div>
  </div>`)) as HTMLElement;
  const clip = scroller.querySelector<HTMLElement>("[data-clip]")!;
  clip.innerHTML = FIELDS_ABOVE_ROW.replace(/^<div[^>]*>|<\/div>$/g, "");
  const row = clip.querySelector<WtFormActions>("wt-form-actions")!;
  await row.updateComplete;
  const [first, second] = clip.querySelectorAll("input");
  expect(clip.scrollHeight).toBeGreaterThan(clip.clientHeight);
  expect(second!.getBoundingClientRect().bottom).toBeGreaterThan(row.getBoundingClientRect().top);
  first!.focus();
  await userEvent.tab();
  expect(document.activeElement).toBe(second);
  await vi.waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0));
});

test.each([
  ["", ""],
  [", though the page's body names a scrolling overflow the page takes over", "auto"],
])("scrolls the page when nothing nearer scrolls under it%s", async (_, bodyOverflow) => {
  document.body.style.overflowY = bodyOverflow;
  document.body.style.paddingBottom = "24px";
  onTestFinished(() => {
    document.body.style.overflowY = "";
    document.body.style.paddingBottom = "";
  });
  await mount(`<div>
    <input aria-label="First" style="display: block; height: 20px; box-sizing: border-box" />
    <div data-gap></div>
    <input aria-label="Second" style="display: block; height: 20px; box-sizing: border-box" />
    <div style="height: 3000px"></div>
    <wt-form-actions error="Correct the highlighted fields to continue."><wt-button variant="primary">Save</wt-button></wt-form-actions>
  </div>`);
  const row = host.querySelector<WtFormActions>("wt-form-actions")!;
  await row.updateComplete;
  const [first, second] = host.querySelectorAll("input");
  const gap = host.querySelector<HTMLElement>("[data-gap]")!;
  gap.style.height = `${row.getBoundingClientRect().top + 5 - gap.getBoundingClientRect().top}px`;
  expect(second!.getBoundingClientRect().top).toBeGreaterThan(row.getBoundingClientRect().top);
  first!.focus();
  await userEvent.tab();
  expect(document.activeElement).toBe(second);
  await vi.waitFor(() =>
    expect(second!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      row.getBoundingClientRect().top,
    ),
  );
  expect(document.documentElement.scrollTop).toBeGreaterThan(0);
  const below = row.shadowRoot!.querySelector<HTMLElement>(".below")!;
  expect(getComputedStyle(below).height, "the body's padding is not the page's").toBe("0px");
});

test("does not scroll when focus moves to one of its own buttons", async () => {
  const { scroller, row } = await mountFieldsAboveRow();
  row.querySelector("wt-button")!.shadowRoot!.querySelector("button")!.focus();
  await nextFrame();
  expect(scroller.scrollTop).toBe(0);
});

const HOLDER_STYLE =
  "height: 200px; display: flex; flex-direction: column; justify-content: flex-end";
const ROW = '<wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>';

/** Each builds, in the scroller, a focusable element that holds the row, and returns it. */
const holders: [string, (scroller: HTMLElement) => HTMLElement][] = [
  [
    "as a child",
    (scroller) => {
      scroller.insertAdjacentHTML(
        "afterbegin",
        `<div tabindex="0" aria-label="Form" style="${HOLDER_STYLE}">${ROW}</div>`,
      );
      return scroller.firstElementChild as HTMLElement;
    },
  ],
  [
    "through a slot, as a dialog's body holds it",
    (scroller) => {
      scroller.insertAdjacentHTML("afterbegin", `<div>${ROW}</div>`);
      const outer = scroller.firstElementChild!.attachShadow({ mode: "open" });
      outer.innerHTML = `<div tabindex="0" aria-label="Form" style="${HOLDER_STYLE}"><slot></slot></div>`;
      return outer.firstElementChild as HTMLElement;
    },
  ],
  [
    "through a slot inside another element's shadow root",
    (scroller) => {
      scroller.insertAdjacentHTML("afterbegin", `<div>${ROW}</div>`);
      const outer = scroller.firstElementChild!.attachShadow({ mode: "open" });
      outer.innerHTML = `<div tabindex="0" aria-label="Form" style="${HOLDER_STYLE}"><div><slot></slot></div></div>`;
      outer.querySelector("div > div")!.attachShadow({ mode: "open" }).innerHTML = "<slot></slot>";
      return outer.firstElementChild as HTMLElement;
    },
  ],
];

test.each(holders)(
  "does not scroll when focus moves to an element that holds it %s",
  async (_, build) => {
    // The holder's bottom, with room for the row below it, lies past the view.
    const scroller = (await mount(`<div style="height: 300px; overflow-y: auto">
      <div style="height: 1000px"></div>
    </div>`)) as HTMLElement;
    const holder = build(scroller);
    scroller.insertAdjacentHTML("afterbegin", '<div style="height: 80px"></div>');
    await scroller.querySelector<WtFormActions>("wt-form-actions")!.updateComplete;
    holder.focus();
    expect(holder.matches(":focus")).toBe(true);
    await nextFrame();
    expect(scroller.scrollTop).toBe(0);
  },
);

test("scrolls nothing for a field above it", async () => {
  const { scroller, row, second } = await mountFieldsAboveRow();
  scroller.scrollTop = 100;
  expect(second.getBoundingClientRect().bottom).toBeLessThan(row.getBoundingClientRect().top);
  second.focus();
  await nextFrame();
  expect(scroller.scrollTop).toBe(100);
});

test("scrolls nothing for a field below it", async () => {
  const scroller = (await mount(`<div style="height: 200px; overflow-y: auto">
    <wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>
    <div style="height: 100px"></div>
    <input aria-label="Notes" style="display: block; height: 20px; box-sizing: border-box" />
    <div style="height: 1000px"></div>
  </div>`)) as HTMLElement;
  scroller.querySelector("input")!.focus();
  await nextFrame();
  expect(scroller.scrollTop).toBe(0);
});

/** FIELDS_ABOVE_ROW, with a second scroller laid over it whose own field, New, lies where the
 * second field does: a row moved into the second scroller is held over both fields. */
async function mountWithScrollerOver() {
  const frame = (await mount(`<div style="position: relative; height: 200px">
    ${FIELDS_ABOVE_ROW.replace("<div ", "<div data-old ")}
    <div data-new style="position: absolute; inset: 0; overflow-y: auto">
      <div style="height: 150px"></div>
      <input aria-label="New" style="display: block; height: 20px; box-sizing: border-box" />
      <div style="height: 1000px"></div>
    </div>
  </div>`)) as HTMLElement;
  const old = frame.querySelector<HTMLElement>("[data-old]")!;
  const over = frame.querySelector<HTMLElement>("[data-new]")!;
  const row = old.querySelector<WtFormActions>("wt-form-actions")!;
  await row.updateComplete;
  return {
    old,
    over,
    row,
    second: old.querySelectorAll("input")[1]!,
    fresh: over.querySelector("input")!,
  };
}

test("stops watching focus in a parent it has left, and watches its new one", async () => {
  const { old, over, row, second, fresh } = await mountWithScrollerOver();
  over.append(row);
  await nextFrame();
  const box = row.getBoundingClientRect();
  const under = second.getBoundingClientRect();
  expect(under.top, "the old field lies under the moved row").toBeLessThan(box.bottom);
  expect(under.bottom).toBeGreaterThan(box.top);
  second.focus();
  await nextFrame();
  expect([old.scrollTop, over.scrollTop]).toEqual([0, 0]);

  fresh.focus();
  await expectClearOfRow(over, row, fresh);
});

test("measures nothing for a field focused just before it moved to another parent", async () => {
  const { old, over, row, second } = await mountWithScrollerOver();
  second.focus();
  over.append(row);
  await nextFrame();
  expect([old.scrollTop, over.scrollTop]).toEqual([0, 0]);
});

test("measures only the field focused last", async () => {
  const { scroller, first, second } = await mountFieldsAboveRow();
  second.focus();
  first.focus();
  await nextFrame();
  expect(scroller.scrollTop).toBe(0);
});

test("does not scroll for a field its box overlaps while it is laid out in place", async () => {
  const scroller = (await mount(`<div style="height: 200px; overflow-y: auto">
    <div style="--wt-form-actions-in-place: true">
      <input aria-label="Host" style="display: block; height: 40px; box-sizing: border-box" />
      <wt-form-actions style="margin-top: -20px"><wt-button>Check</wt-button></wt-form-actions>
    </div>
    <div style="height: 1000px"></div>
  </div>`)) as HTMLElement;
  const row = scroller.querySelector<WtFormActions>("wt-form-actions")!;
  await row.updateComplete;
  const field = scroller.querySelector("input")!;
  expect(field.getBoundingClientRect().bottom).toBeGreaterThan(row.getBoundingClientRect().top);
  field.focus();
  await nextFrame();
  expect(scroller.scrollTop).toBe(0);
});

test.each([
  ["before", "width: 100px", "width: 50%; margin-inline-start: 50%"],
  ["after", "width: 100px; margin-inline-start: 300px", "width: 50%"],
])(
  "does not scroll for a field beside the held row (%s it) rather than under it",
  async (_, fieldStyle, rowStyle) => {
    const scroller = (await mount(`<div style="height: 200px; width: 400px; overflow-y: auto">
      <div data-gap></div>
      <input aria-label="Name" style="display: block; height: 20px; box-sizing: border-box; ${fieldStyle}" />
      <div style="height: 1000px"></div>
      <wt-form-actions error="Correct the highlighted fields to continue." style="${rowStyle}"><wt-button variant="primary">Save</wt-button></wt-form-actions>
    </div>`)) as HTMLElement;
    const row = scroller.querySelector<WtFormActions>("wt-form-actions")!;
    await row.updateComplete;
    const field = scroller.querySelector("input")!;
    const gap = scroller.querySelector<HTMLElement>("[data-gap]")!;
    gap.style.height = `${row.getBoundingClientRect().top + 5 - gap.getBoundingClientRect().top}px`;
    const box = field.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    expect(box.top).toBeGreaterThan(rowBox.top);
    expect(box.right <= rowBox.left || box.left >= rowBox.right, "side by side").toBe(true);
    field.focus();
    await nextFrame();
    expect(scroller.scrollTop).toBe(0);
  },
);

test("scrolls a field clear of a row whose parent draws them both in its own modal dialog", async () => {
  const holder = await mount(`<div>${FIELDS_ABOVE_ROW.replace(/^<div[^>]*>|<\/div>$/g, "")}</div>`);
  const root = holder.attachShadow({ mode: "open" });
  root.innerHTML =
    '<dialog style="padding: 0"><div style="height: 200px; width: 300px; overflow-y: auto"><slot></slot></div></dialog>';
  const dialog = root.querySelector("dialog")!;
  dialog.showModal();
  onTestFinished(() => dialog.close());
  const scroller = dialog.querySelector("div")!;
  const row = holder.querySelector<WtFormActions>("wt-form-actions")!;
  await row.updateComplete;
  const [first, second] = holder.querySelectorAll("input");
  expect(second!.getBoundingClientRect().bottom).toBeGreaterThan(row.getBoundingClientRect().top);
  first!.focus();
  await userEvent.tab();
  expect(document.activeElement).toBe(second);
  await expectClearOfRow(scroller, row, second!);
});

const overlays: [string, string, (overlay: HTMLElement) => void][] = [
  [
    "a modal dialog",
    "dialog",
    (overlay) => {
      (overlay as HTMLDialogElement).showModal();
      overlay.querySelector("input")!.focus();
    },
  ],
  [
    "an open popover",
    'div popover="manual"',
    (overlay) => {
      overlay.showPopover();
      overlay.querySelector("input")!.focus();
    },
  ],
];

test.each(overlays)(
  "does not scroll for a field in %s drawn over the held row",
  async (_, tag, open) => {
    const scroller = (await mount(`<div style="height: 200px; overflow-y: auto">
      <div style="height: 1000px"></div>
      <wt-form-actions error="Correct the highlighted fields to continue."><wt-button variant="primary">Save</wt-button></wt-form-actions>
      <${tag} data-overlay style="margin: 0; padding: 0; border: 0; inset: auto"><input aria-label="Editor" style="display: block; width: 300px; height: 20px; box-sizing: border-box" /></${tag.split(" ")[0]}>
    </div>`)) as HTMLElement;
    const row = scroller.querySelector<WtFormActions>("wt-form-actions")!;
    await row.updateComplete;
    const overlay = scroller.querySelector<HTMLElement>("[data-overlay]")!;
    const box = row.getBoundingClientRect();
    overlay.style.top = `${box.top + 5}px`;
    overlay.style.left = `${box.left}px`;
    open(overlay);
    onTestFinished(() => overlay.remove());
    const field = overlay.querySelector("input")!;
    expect(field.matches(":focus")).toBe(true);
    const at = field.getBoundingClientRect();
    expect(at.top).toBeGreaterThan(box.top);
    expect(at.top).toBeLessThan(box.bottom);
    await nextFrame();
    expect([scroller.scrollTop, document.documentElement.scrollTop]).toEqual([0, 0]);
  },
);

test("takes no room, paints nothing and takes no clicks with neither buttons nor a message", async () => {
  const scroller = (await mount(`<div style="height: 200px; overflow-y: auto">
    <div data-content style="height: 1000px">Grid</div>
    <wt-form-actions> </wt-form-actions>
  </div>`)) as HTMLElement;
  const row = scroller.querySelector<WtFormActions>("wt-form-actions")!;
  await row.updateComplete;
  expect(row.getBoundingClientRect().height).toBe(0);
  const box = scroller.getBoundingClientRect();
  expect(document.elementFromPoint(box.left + 20, box.bottom - 4)).toBe(
    scroller.querySelector("[data-content]"),
  );

  row.error = "The routing could not be saved.";
  await row.updateComplete;
  expect(row.getBoundingClientRect().height).toBeGreaterThan(0);
  expect(row.getBoundingClientRect().bottom).toBe(box.bottom);
  expect(row.shadowRoot!.querySelector("[role=alert]")!.textContent).toBe(
    "The routing could not be saved.",
  );

  row.error = "";
  await row.updateComplete;
  expect(row.getBoundingClientRect().height).toBe(0);
});

test("takes room once a button arrives, and gives it up when the last one leaves", async () => {
  const row = (await mount("<wt-form-actions></wt-form-actions>")) as WtFormActions;
  expect(row.getBoundingClientRect().height).toBe(0);
  for (const slot of ["cancel", "secondary", ""]) {
    const button = document.createElement("wt-button");
    if (slot) button.slot = slot;
    button.textContent = "Save";
    row.append(button);
    await vi.waitFor(() => expect(row.getBoundingClientRect().height, slot).toBeGreaterThan(0));
    button.remove();
    await vi.waitFor(() => expect(row.getBoundingClientRect().height, slot).toBe(0));
  }
});

test("takes no room for a message its container shows instead", async () => {
  const row = (await mount("<wt-form-actions></wt-form-actions>")) as WtFormActions;
  row.showError = false;
  row.error = "Correct the highlighted fields to continue.";
  await row.updateComplete;
  expect(row.getBoundingClientRect().height).toBe(0);
});

/** A 200 px scroller with 24 px of bottom padding. */
const PADDED_SCROLLER = `<div style="height: 200px; overflow-y: auto; padding-bottom: 24px; box-sizing: border-box">
  <input aria-label="First" style="display: block; height: 16px; box-sizing: border-box" />
  <div data-gap style="height: 120px"></div>
  <input aria-label="Second" style="display: block; height: 16px; box-sizing: border-box" />
  <div style="height: 800px">Lines</div>
  <wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>
</div>`;

test("while held, paints its scroller's bottom padding below it, so nothing shows through there", async () => {
  const scroller = await mount(PADDED_SCROLLER);
  const row = scroller.querySelector<WtFormActions>("wt-form-actions")!;
  await row.updateComplete;
  await nextFrame();
  const view = scroller.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  expect(box.bottom).toBeCloseTo(view.bottom - 24, 0);
  const x = box.left + box.width / 2;
  for (const y of [box.bottom + 1, view.bottom - 1])
    expect(document.elementFromPoint(x, y), `at ${y}`).toBe(row);

  scroller.scrollTop = scroller.scrollHeight;
  await nextFrame();
  const rested = row.getBoundingClientRect();
  expect(
    document.elementFromPoint(x, rested.bottom + 12),
    "nothing drawn below a row at rest",
  ).toBe(scroller);
});

test("scrolls a field that focus reaches under the painted padding below the held row", async () => {
  const scroller = await mount(PADDED_SCROLLER);
  const row = scroller.querySelector<WtFormActions>("wt-form-actions")!;
  await row.updateComplete;
  await nextFrame();
  const [first, second] = scroller.querySelectorAll("input");
  const gap = scroller.querySelector<HTMLElement>("[data-gap]")!;
  // The second field 4 px below the held row, in the padding it paints.
  gap.style.height = `${row.getBoundingClientRect().bottom + 4 - gap.getBoundingClientRect().top}px`;
  expect(second!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    scroller.getBoundingClientRect().bottom,
  );
  first!.focus();
  await userEvent.tab();
  expect(document.activeElement).toBe(second);
  await expectClearOfRow(scroller, row, second!);
});

test("paints nothing below a row held in an unpadded scroller inside a padded one", async () => {
  const outer =
    (await mount(`<div style="height: 300px; overflow-y: auto; padding-bottom: 24px; box-sizing: border-box">
    <div data-inner style="height: 200px; overflow-y: auto">
      <div style="height: 1000px">Lines</div>
      <wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>
    </div>
    <div style="height: 1000px">After</div>
  </div>`)) as HTMLElement;
  const inner = outer.querySelector<HTMLElement>("[data-inner]")!;
  const row = inner.querySelector<WtFormActions>("wt-form-actions")!;
  await row.updateComplete;
  await nextFrame();
  expect(row.getBoundingClientRect().bottom).toBe(inner.getBoundingClientRect().bottom);
  expect(row.shadowRoot!.querySelector(".below")!.getBoundingClientRect().height).toBe(0);
  expect(inner.scrollHeight).toBe(1000 + row.getBoundingClientRect().height);
});

test("in a dialog's footer slot, keeps its place even where no ancestor marks it in place", async () => {
  const row = await mount(
    '<wt-form-actions slot="footer"><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  );
  host.style.setProperty("--wt-space-2", "13px");
  const style = getComputedStyle(row);
  const bar = getComputedStyle(row.shadowRoot!.querySelector<HTMLElement>("[data-bar]")!);
  expect(style.position).toBe("static");
  expect([bar.paddingTop, style.paddingBottom, bar.borderTopWidth]).toEqual(["0px", "0px", "0px"]);
  expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
});

test("takes no room for slotted text with no element", async () => {
  const row = (await mount("<wt-form-actions>Save</wt-form-actions>")) as WtFormActions;
  await row.updateComplete;
  expect(row.getBoundingClientRect().height).toBe(0);
});

test("keeps its room when its only slotted element is hidden after it arrived", async () => {
  const row = (await mount(
    '<wt-form-actions><wt-button variant="primary">Save</wt-button></wt-form-actions>',
  )) as WtFormActions;
  await row.updateComplete;
  row.querySelector("wt-button")!.hidden = true;
  await nextFrame();
  expect(row.getBoundingClientRect().height).toBeGreaterThan(0);
});
