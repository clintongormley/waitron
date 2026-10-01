import { LitElement } from "lit";
import { expect, test, afterEach } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import { focusFirstInvalid } from "../interactive.js";
import "./wt-input.js";
import "./wt-textarea.js";

afterEach(cleanup);

function parts(el: HTMLElement) {
  const root = el.shadowRoot!;
  return {
    field: root.querySelector<HTMLElement>(".field")!,
    label: root.querySelector<HTMLLabelElement>("label")!,
    textarea: root.querySelector<HTMLTextAreaElement>("textarea")!,
  };
}

type Textarea = HTMLElement & { value: string; spellcheck: boolean; error: string };

test("renders its label, associated with the textarea so a click on it focuses the textarea", async () => {
  const el = await mount('<wt-textarea label="Note"></wt-textarea>');
  const { label, textarea } = parts(el);
  expect(label.textContent?.trim()).toBe("Note");
  expect(textarea.id).toMatch(/^wt-textarea-\d+$/);
  expect(label.htmlFor).toBe(textarea.id);
  label.click();
  expect(el.shadowRoot!.activeElement).toBe(textarea);
});

test("a named textarea uses its name as its id and native name", async () => {
  const el = await mount('<wt-textarea label="Note" name="note"></wt-textarea>');
  const { textarea } = parts(el);
  expect(textarea.name).toBe("note");
  expect(textarea.id).toBe("note");
});

test("an unnamed textarea carries no name attribute, and two of them get different ids", async () => {
  const a = await mount('<wt-textarea label="A"></wt-textarea>');
  const b = await mount('<wt-textarea label="B"></wt-textarea>');
  expect(parts(a).textarea.hasAttribute("name")).toBe(false);
  expect(parts(a).textarea.id).not.toBe(parts(b).textarea.id);
});

test("the textarea is the control part, so a screen can style it from outside", async () => {
  const el = await mount('<wt-textarea label="Note"></wt-textarea>');
  expect(parts(el).textarea.getAttribute("part")).toBe("control");
  expect(parts(el).field.getAttribute("part")).toBe("field");
});

test("rows sets the native rows, three by default", async () => {
  const plain = await mount('<wt-textarea label="Note"></wt-textarea>');
  const tall = await mount('<wt-textarea label="Note" rows="6"></wt-textarea>');
  expect(parts(plain).textarea.rows).toBe(3);
  expect(parts(tall).textarea.rows).toBe(6);
});

test("the field box is at least the field height tall and grows with its rows", async () => {
  const one = await mount('<wt-textarea label="Note" rows="1"></wt-textarea>');
  host.style.setProperty("--wt-field-height", "70px");
  const three = await mount('<wt-textarea label="Note" rows="3"></wt-textarea>');
  const six = await mount('<wt-textarea label="Note" rows="6"></wt-textarea>');
  const height = (el: HTMLElement) => parts(el).field.getBoundingClientRect().height;
  expect(height(one)).toBe(70);
  expect(height(three)).toBeGreaterThan(56);
  expect(height(six)).toBeGreaterThan(height(three));
});

test("a short labelled textarea is still a full tap target, and its field box grows to hold it", async () => {
  const el = await mount('<wt-textarea label="Note" rows="1"></wt-textarea>');
  host.style.setProperty("--wt-tap-min", "47px");
  const fieldHeight = parseFloat(getComputedStyle(host).getPropertyValue("--wt-field-height"));
  const { field, textarea } = parts(el);
  expect(textarea.getBoundingClientRect().height).toBe(47);
  expect(field.getBoundingClientRect().height).toBeGreaterThan(fieldHeight);
});

test("the textarea fills the box under the label, so text it scrolls never runs under the label", async () => {
  const el = await mount(
    `<wt-textarea label="Note" rows="2" value="${"una línea\n".repeat(12)}"></wt-textarea>`,
  );
  const { field, label, textarea } = parts(el);
  textarea.scrollTop = textarea.scrollHeight;
  expect(textarea.scrollTop).toBeGreaterThan(0);
  expect(textarea.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    label.getBoundingClientRect().bottom,
  );
  expect(textarea.getBoundingClientRect().bottom).toBe(field.getBoundingClientRect().bottom);
});

test("the value starts where a one-line field's value does", async () => {
  const area = await mount('<wt-textarea label="Note" value="Sin cebolla"></wt-textarea>');
  const line = await mount('<wt-input label="Note" value="Sin cebolla"></wt-input>');
  const areaTop =
    parts(area).textarea.getBoundingClientRect().top +
    parseFloat(getComputedStyle(parts(area).textarea).paddingTop) -
    parts(area).field.getBoundingClientRect().top;
  const input = line.shadowRoot!.querySelector("input")!;
  const lineTop =
    input.getBoundingClientRect().top +
    parseFloat(getComputedStyle(input).paddingTop) -
    line.shadowRoot!.querySelector(".field")!.getBoundingClientRect().top;
  expect(areaTop).toBe(lineTop);
});

test("a labelled empty textarea rests its label large, centred on the first field-height band", async () => {
  const el = await mount('<wt-textarea label="Note" rows="6"></wt-textarea>');
  host.style.setProperty("--wt-field-label-rest-size", "17px");
  host.style.setProperty("--wt-field-height", "70px");
  const { field, label } = parts(el);
  expect(field.getAttribute("data-label")).toBe("rest");
  expect(field.hasAttribute("data-compact")).toBe(false);
  expect(getComputedStyle(label).fontSize).toBe("17px");
  const fieldTop = field.getBoundingClientRect().top;
  const labelBox = label.getBoundingClientRect();
  expect(field.getBoundingClientRect().height).toBeGreaterThan(100);
  expect(Math.abs(labelBox.top + labelBox.height / 2 - (fieldTop + 35))).toBeLessThanOrEqual(1);
});

for (const [what, attrs] of [
  ["a value", 'value="x"'],
  ["a hint", 'hint="h"'],
  ["a placeholder", 'placeholder="p"'],
] as const) {
  test(`with ${what}, the label floats small at the top`, async () => {
    const el = await mount(`<wt-textarea label="Note" ${attrs}></wt-textarea>`);
    host.style.setProperty("--wt-font-size-sm", "11px");
    const { field, label } = parts(el);
    expect(field.getAttribute("data-label")).toBe("float");
    expect(getComputedStyle(label).fontSize).toBe("11px");
    expect(label.getBoundingClientRect().top - field.getBoundingClientRect().top).toBe(8);
  });
}

test("a value set from code after the first render floats the label", async () => {
  const el = await mount('<wt-textarea label="Note"></wt-textarea>');
  const { field } = parts(el);
  expect(field.getAttribute("data-label")).toBe("rest");
  (el as Textarea).value = "Sin gluten";
  await (el as LitElement).updateComplete;
  expect(field.getAttribute("data-label")).toBe("float");
  expect(parts(el).textarea.value).toBe("Sin gluten");
});

test("focusing an empty textarea floats its label and draws the focus line and label colour", async () => {
  const el = await mount('<wt-textarea label="Note"></wt-textarea>');
  host.style.setProperty("--wt-field-label-rest-size", "17px");
  host.style.setProperty("--wt-font-size-sm", "11px");
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-field-label-focus", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-field-line-width-active", "3px");
  const { field, label, textarea } = parts(el);
  expect(getComputedStyle(label).fontSize).toBe("17px");
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(textarea);
  expect(getComputedStyle(label).fontSize).toBe("11px");
  expect(getComputedStyle(field).boxShadow).toBe("rgb(1, 2, 3) 0px -3px 0px 0px inset");
  expect(getComputedStyle(label).color).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(textarea).outlineStyle).toBe("none");
});

test("at rest the box paints its fill and bottom line from the field tokens, and the value from the value token", async () => {
  const el = await mount('<wt-textarea label="Note" value="x"></wt-textarea>');
  host.style.setProperty("--wt-color-field-line", "rgb(7, 7, 7)");
  host.style.setProperty("--wt-field-line-width", "1px");
  host.style.setProperty("--wt-color-field-fill", "rgb(8, 8, 8)");
  host.style.setProperty("--wt-color-field-value", "rgb(31, 32, 33)");
  const { field, textarea } = parts(el);
  expect(getComputedStyle(field).boxShadow).toBe("rgb(7, 7, 7) 0px -1px 0px 0px inset");
  expect(getComputedStyle(field).backgroundColor).toBe("rgb(8, 8, 8)");
  expect(getComputedStyle(textarea).color).toBe("rgb(31, 32, 33)");
});

test("the user can resize it only vertically", async () => {
  const el = await mount('<wt-textarea label="Note"></wt-textarea>');
  expect(getComputedStyle(parts(el).textarea).resize).toBe("vertical");
});

test("invalid marks the field and the textarea, and paints the line and label from the danger token", async () => {
  const valid = await mount('<wt-textarea label="Note"></wt-textarea>');
  const el = await mount('<wt-textarea label="Note" invalid></wt-textarea>');
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-field-line-width-active", "3px");
  const { field, label, textarea } = parts(el);
  expect(el.hasAttribute("invalid")).toBe(true);
  expect(textarea.getAttribute("aria-invalid")).toBe("true");
  expect(parts(valid).textarea.getAttribute("aria-invalid")).toBe("false");
  expect(parts(valid).field.hasAttribute("data-invalid")).toBe(false);
  expect(field.hasAttribute("data-invalid")).toBe(true);
  expect(getComputedStyle(field).boxShadow).toBe("rgb(13, 14, 15) 0px -3px 0px 0px inset");
  expect(getComputedStyle(label).color).toBe("rgb(13, 14, 15)");
});

test("an error is shown under the field, marks it invalid and describes the textarea after the hint", async () => {
  const el = await mount(
    '<wt-textarea label="Note" hint="For the kitchen" error="Too long"></wt-textarea>',
  );
  const { field, textarea } = parts(el);
  const hint = el.shadowRoot!.querySelector<HTMLElement>("[data-hint]")!;
  const error = el.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  expect(error.textContent).toBe("Too long");
  expect(error.id).toMatch(/^wt-textarea-error-\d+$/);
  expect(hint.id).toMatch(/^wt-textarea-hint-\d+$/);
  expect(field.contains(error)).toBe(false);
  expect(field.hasAttribute("data-invalid")).toBe(true);
  expect(textarea.getAttribute("aria-invalid")).toBe("true");
  expect(textarea.getAttribute("aria-describedby")).toBe(`${hint.id} ${error.id}`);
});

test("a textarea with no hint or error is described by nothing", async () => {
  const el = await mount('<wt-textarea label="Note"></wt-textarea>');
  expect(el.shadowRoot!.querySelector("[data-hint]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-error]")).toBeNull();
  expect(parts(el).textarea.hasAttribute("aria-describedby")).toBe(false);
});

test("the hint is the placeholder, italic and muted, and stays the textarea's hidden description", async () => {
  const el = await mount('<wt-textarea label="Note" hint="For the kitchen"></wt-textarea>');
  host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  const { textarea } = parts(el);
  const hint = el.shadowRoot!.querySelector<HTMLElement>("[data-hint]")!;
  expect(textarea.getAttribute("placeholder")).toBe("For the kitchen");
  expect(textarea.getAttribute("aria-describedby")).toBe(hint.id);
  expect(hint.textContent).toBe("For the kitchen");
  expect(getComputedStyle(hint).position).toBe("absolute");
  expect(getComputedStyle(textarea, "::placeholder").fontStyle).toBe("italic");
  expect(getComputedStyle(textarea, "::placeholder").color).toBe("rgb(7, 8, 9)");
});

test("an explicit placeholder wins over the hint", async () => {
  const el = await mount(
    '<wt-textarea label="Note" placeholder="Sin cebolla" hint="For the kitchen"></wt-textarea>',
  );
  expect(parts(el).textarea.getAttribute("placeholder")).toBe("Sin cebolla");
});

test("a required textarea is marked visibly and in the native contract", async () => {
  const el = await mount('<wt-textarea label="Note" required></wt-textarea>');
  const { textarea } = parts(el);
  expect(textarea.required).toBe(true);
  expect(textarea.checkValidity()).toBe(false);
  const star = el.shadowRoot!.querySelector("[data-required]")!;
  expect(star.textContent).toBe("*");
  expect(star.getAttribute("aria-hidden")).toBe("true");
  const optional = await mount('<wt-textarea label="Note"></wt-textarea>');
  expect(optional.shadowRoot!.querySelector("[data-required]")).toBeNull();
  expect(parts(optional).textarea.required).toBe(false);
});

test("a disabled textarea paints its own paler fill, a dashed line and muted text, at full opacity", async () => {
  const el = await mount('<wt-textarea label="Note" value="x" disabled></wt-textarea>');
  host.style.setProperty("--wt-color-field-fill-disabled", "rgb(21, 22, 23)");
  host.style.setProperty("--wt-color-text-muted", "rgb(24, 25, 26)");
  const { field, textarea } = parts(el);
  expect(el.hasAttribute("disabled")).toBe(true);
  expect(textarea.disabled).toBe(true);
  expect(field.hasAttribute("data-disabled")).toBe(true);
  expect(getComputedStyle(field).backgroundColor).toBe("rgb(21, 22, 23)");
  expect(getComputedStyle(field, "::after").borderBottomStyle).toBe("dashed");
  expect(getComputedStyle(textarea).color).toBe("rgb(24, 25, 26)");
  expect(getComputedStyle(field).opacity).toBe("1");
});

test("hide-label draws no label, names the textarea by its label, and makes the field compact", async () => {
  const el = await mount('<wt-textarea label="Note" hide-label rows="1"></wt-textarea>');
  host.style.setProperty("--wt-tap-min", "47px");
  const { field, textarea } = parts(el);
  expect(el.shadowRoot!.querySelector("label")).toBeNull();
  expect(textarea.getAttribute("aria-label")).toBe("Note");
  expect(field.hasAttribute("data-compact")).toBe(true);
  expect(field.getBoundingClientRect().height).toBe(47);
});

test("a textarea with no label at all is compact and carries no accessible-name override", async () => {
  const el = await mount("<wt-textarea></wt-textarea>");
  const { field, textarea } = parts(el);
  expect(field.hasAttribute("data-compact")).toBe(true);
  expect(textarea.hasAttribute("aria-label")).toBe(false);
  expect(getComputedStyle(field).paddingTop).toBe("0px");
});

test("a labelled textarea is not compact and names itself through its label alone", async () => {
  const el = await mount('<wt-textarea label="Note"></wt-textarea>');
  expect(parts(el).textarea.hasAttribute("aria-label")).toBe(false);
});

test("maxlength passes through, and none is set by default", async () => {
  const limited = await mount('<wt-textarea label="Note" maxlength="200"></wt-textarea>');
  const open = await mount('<wt-textarea label="Note"></wt-textarea>');
  expect(parts(limited).textarea.maxLength).toBe(200);
  expect(parts(open).textarea.hasAttribute("maxlength")).toBe(false);
});

test('spellcheck="false" as an attribute reaches the textarea as false', async () => {
  const el = await mount('<wt-textarea label="Kit" spellcheck="false"></wt-textarea>');
  expect(parts(el).textarea.spellcheck).toBe(false);
  expect(parts(el).textarea.getAttribute("spellcheck")).toBe("false");
});

test("spellcheck set to false as a property reaches the textarea as false", async () => {
  const el = await mount('<wt-textarea label="Kit"></wt-textarea>');
  (el as Textarea).spellcheck = false;
  await (el as LitElement).updateComplete;
  expect(parts(el).textarea.spellcheck).toBe(false);
});

test("spellcheck is on by default, and an attribute other than false leaves it on", async () => {
  const plain = await mount('<wt-textarea label="Note"></wt-textarea>');
  const on = await mount('<wt-textarea label="Note" spellcheck="true"></wt-textarea>');
  const bare = await mount('<wt-textarea label="Note" spellcheck></wt-textarea>');
  for (const el of [plain, on, bare]) {
    expect(parts(el).textarea.spellcheck).toBe(true);
    expect(parts(el).textarea.getAttribute("spellcheck")).toBe("true");
  }
});

test("autocapitalize passes through, and none is set by default", async () => {
  const off = await mount('<wt-textarea label="Kit" autocapitalize="off"></wt-textarea>');
  const plain = await mount('<wt-textarea label="Note"></wt-textarea>');
  expect(parts(off).textarea.getAttribute("autocapitalize")).toBe("off");
  expect(parts(plain).textarea.hasAttribute("autocapitalize")).toBe(false);
});

test("sends wt-change once per input with the new value, and updates its own value", async () => {
  const el = await mount('<wt-textarea label="Note"></wt-textarea>');
  const received: string[] = [];
  el.addEventListener("wt-change", (e) => {
    received.push((e as CustomEvent<{ value: string }>).detail.value);
  });
  const { textarea, field } = parts(el);
  textarea.value = "Sin";
  textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  textarea.value = "Sin sal";
  textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  expect(received).toEqual(["Sin", "Sin sal"]);
  expect((el as Textarea).value).toBe("Sin sal");
  await (el as LitElement).updateComplete;
  expect(field.getAttribute("data-label")).toBe("float");
});

test("wt-change bubbles and crosses shadow boundaries", async () => {
  const el = await mountInShadowRoot('<wt-textarea label="Note"></wt-textarea>');
  let received: CustomEvent<{ value: string }> | undefined;
  document.addEventListener(
    "wt-change",
    (e) => {
      received = e as CustomEvent<{ value: string }>;
    },
    { once: true },
  );
  const textarea = el.shadowRoot!.querySelector("textarea")!;
  textarea.value = "Hola";
  textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  expect(received?.detail).toEqual({ value: "Hola" });
});

test("does not leak the native input event outside the component", async () => {
  const el = await mount('<wt-textarea label="Note"></wt-textarea>');
  let native = 0;
  host.addEventListener("input", () => native++);
  parts(el).textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  expect(native).toBe(0);
});

test("is no wider than the field cap a container sets, and as wide as its container without one", async () => {
  const el = await mount('<wt-textarea label="Note"></wt-textarea>');
  host.style.width = "600px";
  expect(el.getBoundingClientRect().width).toBe(600);
  host.style.setProperty("--wt-field-max-width", "200px");
  expect(el.getBoundingClientRect().width).toBe(200);
  expect(parts(el).textarea.getBoundingClientRect().width).toBe(200);
});

test("focusing the host focuses the textarea", async () => {
  const el = await mount('<wt-textarea label="Note"></wt-textarea>');
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(parts(el).textarea);
});

test("field help sits outside the field box, at its trailing side", async () => {
  const el = await mount('<wt-textarea label="Note"><button slot="help">?</button></wt-textarea>');
  const { field, label } = parts(el);
  const slot = el.shadowRoot!.querySelector<HTMLSlotElement>('slot[name="help"]')!;
  expect(field.contains(slot)).toBe(false);
  expect(label.contains(slot)).toBe(false);
  expect(el.querySelector("button")!.getBoundingClientRect().left).toBeGreaterThanOrEqual(
    field.getBoundingClientRect().right,
  );
});

test("a form's failed submission focuses an invalid textarea (focusFirstInvalid)", async () => {
  await mount(`<form>
      <wt-input label="Name" name="name" value="Ana"></wt-input>
      <wt-textarea label="Note" name="note" error="Too long"></wt-textarea>
    </form>`);
  const form = host.querySelector("form")!;
  const area = host.querySelector("wt-textarea")!;
  const focused = await focusFirstInvalid(form);
  const textarea = area.shadowRoot!.querySelector("textarea")!;
  expect(focused).toBe(textarea);
  expect(area.shadowRoot!.activeElement).toBe(textarea);
});

test("an error set in the same turn is found by focusFirstInvalid", async () => {
  await mount('<form><wt-textarea label="Note"></wt-textarea></form>');
  const area = host.querySelector("wt-textarea")! as Textarea;
  area.error = "Write a note";
  expect(await focusFirstInvalid(host.querySelector("form")!)).toBe(
    area.shadowRoot!.querySelector("textarea"),
  );
});
