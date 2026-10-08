import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { PersonEdit } from "./person-edit.js";
import "./person-edit.js";
import type { PersonEditDetails, PersonSummary } from "../api/client.js";
import { setLocale } from "../i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

// Every field holds something, in the spelling the server lists it in, so a field that rewrites
// its value on first draw shows as a change. Pending, so the immediate Resend invitation is drawn.
const ada: PersonSummary = {
  personId: "p1",
  displayName: "Ada",
  firstNames: "Ada Augusta",
  lastNames: "Lovelace",
  telephone: "+44 20 7946 0000",
  role: "manager",
  status: "pending",
  hasPassword: false,
  hasTotp: false,
  email: "ada@example.com",
};
const sparse: PersonSummary = {
  personId: "p2",
  displayName: "Grace",
  role: "staff",
  status: "active",
  hasPassword: true,
  hasTotp: false,
  email: null,
  telephone: null,
};

async function mount(person = ada) {
  setLocale("en-GB");
  const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", { person, open: true });
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  const saves = vi.fn<(detail: PersonEditDetails) => void>();
  el.addEventListener("save-person", (event) =>
    saves((event as CustomEvent<PersonEditDetails>).detail),
  );
  return { el, saves };
}

const q = <T extends HTMLElement = HTMLElement>(el: PersonEdit, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const save = (el: PersonEdit) => q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=save]")!;

/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function state(el: PersonEdit) {
  await el.updateComplete;
  const action = save(el);
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

/** A real pointer press on Save's inner button; `force` presses a disabled one too. */
async function press(el: PersonEdit) {
  await userEvent.click(page.elementLocator(save(el).shadowRoot!.querySelector("button")!), {
    force: true,
  });
  await el.updateComplete;
}
function inner(el: PersonEdit, name: string) {
  return q<HTMLElementTagNameMap["wt-input"]>(
    el,
    `wt-input[name="${name}"]`,
  )!.shadowRoot!.querySelector("input")!;
}
async function type(el: PersonEdit, name: string, value: string) {
  await q<HTMLElementTagNameMap["wt-input"]>(el, `wt-input[name="${name}"]`)!.updateComplete;
  await userEvent.fill(page.elementLocator(inner(el, name)), value);
  await el.updateComplete;
}
function errors(el: PersonEdit): string[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-input"]>("wt-input")]
    .map((input) => input.error)
    .filter((error) => error !== "");
}

it.each([
  ["every detail filled", ada],
  ["no email or telephone stored", sparse],
])(
  "a person with %s opens with Save quiet, and neither a press, a host click nor Enter sends or marks anything",
  async (_, person) => {
    const { el, saves } = await mount(person);
    expect(await state(el)).toEqual(quiet);
    await press(el);
    save(el).click();
    await el.updateComplete;
    inner(el, "given-name").focus();
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    expect(saves).not.toHaveBeenCalled();
    expect(errors(el)).toEqual([]);
    expect(q<HTMLElementTagNameMap["wt-modal"]>(el, "wt-modal")!.open).toBe(true);
  },
);

it.each([
  ["given-name", "Ada Augusta", "Augusta"],
  ["family-name", "Lovelace", "King"],
  ["nickname", "Ada", "Countess"],
  ["email", "ada@example.com", "ada@example.org"],
  ["telephone", "+44 20 7946 0000", "+44 20 7946 0001"],
])(
  "an edit of %s wakes Save, and typing the stored value back quiets it",
  async (name, stored, edit) => {
    const { el } = await mount();
    await type(el, name, edit);
    expect(await state(el)).toEqual(ready);
    await type(el, name, stored);
    expect(await state(el)).toEqual(quiet);
  },
);

it.each([
  ["role", "staff", "manager"],
  ["status", "suspended", "pending"],
] as const)(
  "choosing another %s wakes Save, and choosing the stored one again quiets it",
  async (name, other, stored) => {
    const { el } = await mount();
    const box = q(el, `wt-combobox[name="${name}"]`)!;
    await chooseOption(box, other);
    expect(await state(el)).toEqual(ready);
    await chooseOption(box, stored);
    expect(await state(el)).toEqual(quiet);
  },
);

it("an edited person is ready and sends the stored details beside the edit", async () => {
  const { el, saves } = await mount();
  await type(el, "telephone", "+44 20 7946 0001");
  expect(await state(el)).toEqual(ready);
  await press(el);
  expect(saves).toHaveBeenCalledExactlyOnceWith({
    displayName: "Ada",
    firstNames: "Ada Augusta",
    lastNames: "Lovelace",
    telephone: "+44 20 7946 0001",
    email: "ada@example.com",
    role: "manager",
    status: "pending",
  });
});

it("a changed form its own checks refuse stays primary and disabled until it is fixed", async () => {
  const { el, saves } = await mount();
  await type(el, "email", "not-an-email");
  expect(await state(el)).toEqual(ready);
  await press(el);
  expect(saves).not.toHaveBeenCalled();
  expect(errors(el).length).toBeGreaterThan(0);
  expect(await state(el)).toEqual(blocked);
  await type(el, "email", "ada@example.org");
  expect(await state(el)).toEqual(ready);
});

it("Resend invitation is not held back by an unchanged form", async () => {
  const { el } = await mount();
  const resent = vi.fn();
  el.addEventListener("resend-invitation", resent);
  const resend = q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=resend-invitation]")!;
  await resend.updateComplete;
  expect(resend.shadowRoot!.querySelector("button")!.disabled).toBe(false);
  await userEvent.click(page.elementLocator(resend.shadowRoot!.querySelector("button")!));
  expect(resent).toHaveBeenCalledOnce();
});

it("after a save the person kept editing through, Save is quiet once the sent value is typed back", async () => {
  const { el, saves } = await mount();
  await type(el, "telephone", "+44 20 7946 0001");
  await press(el);
  const sent = saves.mock.calls[0]![0];
  await type(el, "telephone", "+44 20 7946 0002");
  expect(el.closeSaved(sent)).toBe(false);
  expect(await state(el)).toEqual(ready);
  await type(el, "telephone", "+44 20 7946 0001");
  expect(await state(el)).toEqual(quiet);
});

it("a different person opens with Save quiet, measured against their own details", async () => {
  const { el } = await mount();
  await type(el, "telephone", "+44 20 7946 0001");
  expect(await state(el)).toEqual(ready);
  el.person = sparse;
  await el.updateComplete;
  expect(await state(el)).toEqual(quiet);
  await type(el, "given-name", "Grace");
  expect(await state(el)).toEqual(ready);
});
