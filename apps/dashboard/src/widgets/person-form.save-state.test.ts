import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { PersonForm } from "./person-form.js";
import "./person-form.js";
import { setLocale, t } from "../i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

type Created = Parameters<PersonForm["closeSaved"]>[0];

async function mount() {
  setLocale("en-GB");
  const { el } = await mountWidget<PersonForm>("dashboard-person-form", { open: true });
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  const creates = vi.fn<(detail: Created) => void>();
  el.addEventListener("create-person", (event) => creates((event as CustomEvent<Created>).detail));
  return { el, creates };
}

const q = <T extends HTMLElement = HTMLElement>(el: PersonForm, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const confirm = (el: PersonForm) =>
  q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=confirm]")!;

/** What Create looks like and whether a person can press it: the host's state and its inner button's. */
async function state(el: PersonForm) {
  await el.updateComplete;
  const action = confirm(el);
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

/** A real pointer press on Create's inner button; `force` presses a disabled one too. */
async function press(el: PersonForm) {
  await userEvent.click(page.elementLocator(confirm(el).shadowRoot!.querySelector("button")!), {
    force: true,
  });
  await el.updateComplete;
}
function inner(el: PersonForm, name: string) {
  return q<HTMLElementTagNameMap["wt-input"]>(
    el,
    `wt-input[name="${name}"]`,
  )!.shadowRoot!.querySelector("input")!;
}
async function type(el: PersonForm, name: string, value: string) {
  await q<HTMLElementTagNameMap["wt-input"]>(el, `wt-input[name="${name}"]`)!.updateComplete;
  await userEvent.fill(page.elementLocator(inner(el, name)), value);
  await el.updateComplete;
}
function errors(el: PersonForm): string[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-input"]>("wt-input")]
    .map((input) => input.error)
    .filter((error) => error !== "");
}
async function fillValid(el: PersonForm) {
  await type(el, "given-name", "Ada");
  await type(el, "family-name", "Lovelace");
  await type(el, "email", "ada@example.com");
}

it("opens with Create quiet, and neither a press, a host click nor Enter sends or marks anything", async () => {
  const { el, creates } = await mount();
  expect(await state(el)).toEqual(quiet);
  await press(el);
  confirm(el).click();
  await el.updateComplete;
  inner(el, "given-name").focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(creates).not.toHaveBeenCalled();
  expect(errors(el)).toEqual([]);
  expect(q<HTMLElementTagNameMap["wt-modal"]>(el, "wt-modal")!.open).toBe(true);
});

it.each(["given-name", "family-name", "nickname", "email", "tel"])(
  "typing into %s wakes Create, and clearing it quiets Create again",
  async (name) => {
    const { el } = await mount();
    await type(el, name, name === "email" ? "ada@example.com" : "Ada");
    expect((await state(el)).variant).toBe("primary");
    await type(el, name, "");
    expect(await state(el)).toEqual(quiet);
  },
);

it("choosing a role other than staff wakes Create, and choosing staff again quiets it", async () => {
  const { el } = await mount();
  const role = q(el, "wt-combobox[name=role]")!;
  await chooseOption(role, "manager");
  expect(await state(el)).toEqual(ready);
  await chooseOption(role, "staff");
  expect(await state(el)).toEqual(quiet);
});

it("a filled form is ready and sends what was typed", async () => {
  const { el, creates } = await mount();
  await fillValid(el);
  expect(await state(el)).toEqual(ready);
  await press(el);
  expect(creates).toHaveBeenCalledExactlyOnceWith({
    firstNames: "Ada",
    lastNames: "Lovelace",
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    telephone: null,
    role: "staff",
  });
});

it("a changed form its own checks refuse shows its errors and holds Create primary and disabled", async () => {
  const { el, creates } = await mount();
  await type(el, "given-name", "Ada");
  expect(await state(el)).toEqual(ready);
  await press(el);
  expect(creates).not.toHaveBeenCalled();
  expect(errors(el)).toContain(t("form.last_names_required"));
  expect(await state(el)).toEqual(blocked);
  await type(el, "family-name", "Lovelace");
  await type(el, "email", "ada@example.com");
  expect(await state(el)).toEqual(ready);
});

it("after a create the person kept editing through, Create is quiet once the sent value is typed back", async () => {
  const { el, creates } = await mount();
  await fillValid(el);
  await press(el);
  const sent = creates.mock.calls[0]![0];
  await type(el, "tel", "+34 600 000 000");
  expect(el.closeSaved(sent)).toBe(false);
  expect(await state(el)).toEqual(ready);
  await type(el, "tel", "");
  expect(await state(el)).toEqual(quiet);
});

it("reopened after a create, the empty form starts quiet again", async () => {
  const { el, creates } = await mount();
  await fillValid(el);
  await press(el);
  expect(el.closeSaved(creates.mock.calls[0]![0])).toBe(true);
  await el.updateComplete;
  el.open = true;
  expect(await state(el)).toEqual(quiet);
  await type(el, "given-name", "Grace");
  expect(await state(el)).toEqual(ready);
});
