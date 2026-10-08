import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { ShiftDialog, UpdateShiftDetail } from "./shift-dialog.js";
import "./shift-dialog.js";
import type { Shift } from "../api/client.js";
import { setLocale } from "../i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

// Every field holds something, with a non-zero offset, as the server lists a stored shift.
const stored: Shift = {
  id: "s1",
  personId: "p1",
  locationId: "loc-1",
  rosterVersionId: "v1",
  startsAt: "2027-01-04T07:00:00Z",
  startsOffsetMinutes: 120,
  endsAt: "2027-01-04T15:00:00Z",
  endsOffsetMinutes: 120,
  role: "bar",
};

async function mount(shift: Shift | null = stored) {
  setLocale("en-GB");
  const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
    open: true,
    day: "2027-01-04",
    personId: "p1",
    shift,
  });
  await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  const sent = vi.fn<(type: string, detail: unknown) => void>();
  for (const type of ["add-shift", "update-shift", "remove-shift"])
    el.addEventListener(type, (event) => sent(type, (event as CustomEvent).detail));
  return { el, sent };
}

const q = <T extends HTMLElement = HTMLElement>(el: ShiftDialog, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const button = (el: ShiftDialog, test: string) =>
  q<HTMLElementTagNameMap["wt-button"]>(el, `[data-test=${test}]`)!;

/** What the confirm button looks like and whether a person can press it: host and inner button. */
async function state(el: ShiftDialog, test = "confirm") {
  await el.updateComplete;
  const action = button(el, test);
  await action.updateComplete;
  return {
    variant: action.variant,
    disabled: action.disabled,
    innerDisabled: action.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const blocked = { variant: "primary", disabled: true, innerDisabled: true };

/** A real pointer press on the confirm button's inner button; `force` presses a disabled one too. */
async function press(el: ShiftDialog) {
  await userEvent.click(
    page.elementLocator(button(el, "confirm").shadowRoot!.querySelector("button")!),
    {
      force: true,
    },
  );
  await el.updateComplete;
}
function inner(el: ShiftDialog, field: string) {
  return q<HTMLElementTagNameMap["wt-input"]>(
    el,
    `[data-test=shift-${field}]`,
  )!.shadowRoot!.querySelector("input")!;
}
async function type(el: ShiftDialog, field: string, value: string) {
  await q<HTMLElementTagNameMap["wt-input"]>(el, `[data-test=shift-${field}]`)!.updateComplete;
  await userEvent.fill(page.elementLocator(inner(el, field)), value);
  await el.updateComplete;
}

for (const shift of [stored, null]) {
  const kind = shift ? "an existing shift" : "a new shift";
  it(`${kind} opens quiet, and neither a press, a host click nor Enter sends anything`, async () => {
    const { el, sent } = await mount(shift);
    expect(await state(el)).toEqual(quiet);
    await press(el);
    button(el, "confirm").click();
    await el.updateComplete;
    inner(el, "role").focus();
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    expect(sent).not.toHaveBeenCalled();
    expect(el.open).toBe(true);
  });
}

it.each([
  ["start", "10:00", "09:00"],
  ["end", "18:00", "17:00"],
  ["role", "kitchen", "bar"],
])(
  "changing %s wakes Save, and typing the stored value back quiets it",
  async (field, changed, original) => {
    const { el } = await mount();
    await type(el, field, changed);
    expect(await state(el)).toEqual(ready);
    await type(el, field, original);
    expect(await state(el)).toEqual(quiet);
  },
);

it("Remove is immediate: ready on an untouched shift and sent at once", async () => {
  const { el, sent } = await mount();
  expect((await state(el, "remove")).disabled).toBe(false);
  button(el, "remove").click();
  expect(sent).toHaveBeenCalledExactlyOnceWith("remove-shift", { shiftId: "s1" });
});

it("a new shift with only a role is changed but held disabled until it has a start and an end", async () => {
  const { el, sent } = await mount(null);
  await type(el, "role", "bar");
  expect(await state(el)).toEqual(blocked);
  await press(el);
  expect(sent).not.toHaveBeenCalled();
  await type(el, "start", "09:00");
  expect(await state(el)).toEqual(blocked);
  await type(el, "end", "13:00");
  expect(await state(el)).toEqual(ready);
  await press(el);
  expect(sent).toHaveBeenCalledExactlyOnceWith("add-shift", {
    personId: "p1",
    startsAt: "2027-01-04T09:00:00Z",
    startsOffsetMinutes: 0,
    endsAt: "2027-01-04T13:00:00Z",
    endsOffsetMinutes: 0,
    role: "bar",
  });
});

it("an edited shift sends what it holds, keeping the stored offsets", async () => {
  const { el, sent } = await mount();
  await type(el, "role", "kitchen");
  await press(el);
  expect(sent).toHaveBeenCalledExactlyOnceWith("update-shift", {
    shiftId: "s1",
    patch: {
      startsAt: "2027-01-04T07:00:00Z",
      startsOffsetMinutes: 120,
      endsAt: "2027-01-04T15:00:00Z",
      endsOffsetMinutes: 120,
      role: "kitchen",
    },
  } satisfies UpdateShiftDetail);
});

it("after a save the person kept editing through, Save is quiet once the sent value is typed back", async () => {
  const { el } = await mount();
  await type(el, "role", "kitchen");
  await press(el);
  const done = el.writeCompletion();
  await type(el, "role", "terrace");
  expect(done()).toBe(false);
  expect(await state(el)).toEqual(ready);
  await type(el, "role", "kitchen");
  expect(await state(el)).toEqual(quiet);
});

it("reopened after a save, the stored shift starts quiet again", async () => {
  const { el } = await mount();
  await type(el, "role", "kitchen");
  await press(el);
  expect(el.writeCompletion()()).toBe(true);
  await el.updateComplete;
  el.open = true;
  expect(await state(el)).toEqual(quiet);
  await type(el, "role", "terrace");
  expect(await state(el)).toEqual(ready);
});
