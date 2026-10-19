import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, mountInShadowRoot } from "@waitron/ui/src/test-helpers.js";
import type { DepartmentServiceSteps } from "./department-service-steps.js";
import type { ServiceStepDraft } from "./service-step-draft.js";

import "./department-service-steps.js";

const COURSES = [
  { id: "c-starters", name: "Starters" },
  { id: "c-mains", name: "Mains" },
];
const STEPS: ServiceStepDraft[] = [
  { key: "s1", id: "s1", name: "Set up", start: "seated", courseId: null, minutes: "0" },
  {
    key: "s2",
    id: "s2",
    name: "Take order",
    start: "after_previous",
    courseId: null,
    minutes: "2",
  },
  {
    key: "s3",
    id: "s3",
    name: "Dessert?",
    start: "course_served",
    courseId: "c-mains",
    minutes: "10",
  },
  {
    key: "s4",
    id: "s4",
    name: "Anything else?",
    start: "all_served",
    courseId: null,
    minutes: "10",
  },
];
const copy = (steps: ServiceStepDraft[]) => steps.map((step) => ({ ...step }));

type Updatable = HTMLElement & { updateComplete: Promise<unknown>; disabled?: boolean };
type Combobox = HTMLElementTagNameMap["wt-combobox"];

const unlisten: (() => void)[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const stop of unlisten.splice(0)) stop();
  cleanup();
  setLocale("en");
});

async function settle(el: DepartmentServiceSteps): Promise<void> {
  await el.updateComplete;
  await Promise.all(
    [...el.shadowRoot!.querySelectorAll<Updatable>("wt-input, wt-combobox, wt-button")].map(
      (control) => control.updateComplete,
    ),
  );
}

async function mount(
  props: Partial<
    Pick<DepartmentServiceSteps, "steps" | "courses" | "errors" | "listError" | "disabled">
  > = {},
): Promise<DepartmentServiceSteps> {
  const el = (await mountInShadowRoot(
    "<department-service-steps></department-service-steps>",
  )) as DepartmentServiceSteps;
  applyTokens(el);
  el.steps = copy(STEPS);
  el.courses = COURSES;
  Object.assign(el, props);
  await settle(el);
  return el;
}

const q = <T extends Element = HTMLElement>(el: DepartmentServiceSteps, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const heads = (el: DepartmentServiceSteps) =>
  [...el.shadowRoot!.querySelectorAll("thead [data-head]")].map((head) => head.textContent!.trim());
const rows = (el: DepartmentServiceSteps) => [...el.shadowRoot!.querySelectorAll("tbody tr")];
const nameInput = (el: DepartmentServiceSteps, index: number) =>
  rows(el)[index]!.querySelector<Updatable & { value: string }>(
    'wt-input[name="serviceStepName"]',
  )!;
const startBox = (el: DepartmentServiceSteps, index: number) =>
  rows(el)[index]!.querySelector<Combobox>('wt-combobox[name="serviceStepStart"]')!;
const minutesInput = (el: DepartmentServiceSteps, index: number) =>
  rows(el)[index]!.querySelector<Updatable & { value: string }>(
    'wt-input[name="serviceStepMinutes"]',
  )!;
const addButton = (el: DepartmentServiceSteps) =>
  q<HTMLElement & { disabled: boolean }>(el, '[data-test="add-service-step"]');

function record(): { changes: ServiceStepDraft[][]; raw: Event[] } {
  const changes: ServiceStepDraft[][] = [];
  const raw: Event[] = [];
  const change = (event: Event) =>
    changes.push(
      structuredClone((event as CustomEvent<{ steps: ServiceStepDraft[] }>).detail.steps),
    );
  const primitive = (event: Event) => raw.push(event);
  document.addEventListener("steps-change", change);
  document.addEventListener("wt-change", primitive);
  unlisten.push(() => {
    document.removeEventListener("steps-change", change);
    document.removeEventListener("wt-change", primitive);
  });
  return { changes, raw };
}

async function remove(el: DepartmentServiceSteps, key: string): Promise<void> {
  const button = q(el, `[data-test="remove-${key}"]`)!;
  const menu = button.closest("wt-row-actions")!;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await userEvent.click(button);
  await settle(el);
}

async function choose(el: DepartmentServiceSteps, index: number, label: string): Promise<void> {
  const control = startBox(el, index);
  await userEvent.click(control.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!);
  await control.updateComplete;
  const option = [...control.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (row) => row.textContent!.trim() === label,
  );
  expect(option, label).toBeDefined();
  await userEvent.click(option!);
  await settle(el);
}

async function typeInto(input: Updatable, text: string): Promise<void> {
  const field = input.shadowRoot!.querySelector("input")!;
  await userEvent.clear(field);
  if (text !== "") await userEvent.type(field, text);
}

it("draws each step's name, start and minutes under Step and Starts", async () => {
  const el = await mount();
  expect(heads(el).slice(0, 2)).toEqual(["Step", "Starts"]);
  const drawn = rows(el).map((_, index) => [
    nameInput(el, index).value,
    startBox(el, index).shadowRoot!.querySelector(".value")!.textContent,
    minutesInput(el, index).value,
    minutesInput(el, index).querySelector('[slot="end"]')!.textContent!.trim(),
  ]);
  expect(drawn).toEqual([
    ["Set up", "When seated", "0", "min"],
    ["Take order", "After the step before", "2", "min"],
    ["Dessert?", "Mains served", "10", "min"],
    ["Anything else?", "Everything served", "10", "min"],
  ]);
  expect(q(el, '[data-test="service-steps-heading"]')!.textContent!.trim()).toBe("Service steps");
});

it("offers the five starts, one per course in the order given", async () => {
  const el = await mount();
  expect(startBox(el, 0).options.map((option) => option.label)).toEqual([
    "When seated",
    "After the step before",
    "Starters served",
    "Mains served",
    "Everything served",
    "Repeats after the last order",
  ]);
});

it("says No service steps. when there are none", async () => {
  const el = await mount({ steps: [] });
  expect(rows(el)).toHaveLength(0);
  expect(q(el, '[data-test="empty"]')!.textContent!.trim()).toBe("No service steps.");
});

it("typing a name, choosing a start or changing minutes sends the whole list", async () => {
  const el = await mount();
  const { changes, raw } = record();

  await typeInto(nameInput(el, 1), "Order");
  expect(changes.at(-1)!.map((step) => step.name)).toEqual([
    "Set up",
    "Order",
    "Dessert?",
    "Anything else?",
  ]);

  await choose(el, 1, "Starters served");
  expect(changes.at(-1)![1]).toMatchObject({ start: "course_served", courseId: "c-starters" });

  await choose(el, 2, "Everything served");
  expect(changes.at(-1)![2]).toMatchObject({ start: "all_served", courseId: null });

  await typeInto(minutesInput(el, 3), "15");
  expect(changes.at(-1)![3]).toMatchObject({ key: "s4", minutes: "15" });
  expect(changes.at(-1)).toHaveLength(4);
  expect(raw).toEqual([]);
});

it("Add step adds an empty row, When seated in an empty list and After the step before otherwise, and focuses its name", async () => {
  const el = await mount({ steps: [] });
  const { changes } = record();
  await userEvent.click(addButton(el)!);
  await settle(el);
  expect(changes.at(-1)).toEqual([
    expect.objectContaining({ id: null, name: "", start: "seated", courseId: null, minutes: "0" }),
  ]);
  expect(el.shadowRoot!.activeElement).toBe(nameInput(el, 0));

  await userEvent.click(addButton(el)!);
  await settle(el);
  const [first, second] = changes.at(-1)!;
  expect(second).toMatchObject({ id: null, name: "", start: "after_previous", minutes: "0" });
  expect(second!.key).not.toBe(first!.key);
  expect(second!.key).not.toBe("");
  expect(el.shadowRoot!.activeElement).toBe(nameInput(el, 1));
});

it("Add step is disabled at 20 steps", async () => {
  const many = Array.from({ length: 19 }, (_, index) => ({
    ...STEPS[1]!,
    key: `k${index}`,
    id: `k${index}`,
  }));
  const el = await mount({ steps: many });
  expect(addButton(el)!.disabled).toBe(false);
  await userEvent.click(addButton(el)!);
  await settle(el);
  expect(rows(el)).toHaveLength(20);
  expect(addButton(el)!.disabled).toBe(true);
});

it("Delete in the row menu removes the step and moves focus to the next name, or to Add step", async () => {
  const el = await mount({ steps: copy(STEPS.slice(0, 2)) });
  const { changes } = record();
  await remove(el, "s1");
  expect(changes.at(-1)!.map((step) => step.key)).toEqual(["s2"]);
  expect(el.shadowRoot!.activeElement).toBe(nameInput(el, 0));

  await remove(el, "s2");
  expect(changes.at(-1)).toEqual([]);
  expect(el.shadowRoot!.activeElement).toBe(addButton(el));
});

it("moves a step with the keyboard and announces its place", async () => {
  const el = await mount();
  const { changes } = record();
  const grip = q(el, '[data-test="drag-s1"]')!;
  expect(grip.getAttribute("aria-label")).toBe("Reorder: Set up");
  grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await settle(el);
  expect(changes.at(-1)!.map((step) => step.key)).toEqual(["s2", "s1", "s3", "s4"]);
  expect(
    rows(el).map((row) => row.querySelector("[data-test^=drag-]")!.getAttribute("data-test")),
  ).toEqual(["drag-s2", "drag-s1", "drag-s3", "drag-s4"]);
  expect(q(el, ".reorder-status")!.textContent).toBe("Set up is now 2 of 4.");
  expect(el.shadowRoot!.activeElement).toBe(q(el, '[data-test="drag-s1"]'));
});

it("drags a step into place", async () => {
  const el = await mount();
  const { changes } = record();
  q(el, '[data-test="drag-s1"]')!.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerId: 9 }),
  );
  for (const index of [1, 2]) {
    const box = rows(el)[index]!.getBoundingClientRect();
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 9,
        clientY: box.top + box.height / 2,
      }),
    );
    await settle(el);
  }
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9 }));
  await settle(el);
  expect(changes.at(-1)!.map((step) => step.key)).toEqual(["s2", "s3", "s1", "s4"]);
});

it("shows each error under its own field", async () => {
  const el = await mount({
    errors: {
      s2: { name: "This field is required." },
      s3: { minutes: "Whole minutes, 0 to 120." },
    },
    listError: "A step was changed elsewhere. Cancel and open it again to see the latest.",
  });
  const name = nameInput(el, 1);
  const minutes = minutesInput(el, 2);
  expect(name.shadowRoot!.querySelector("[data-error]")!.textContent).toBe(
    "This field is required.",
  );
  expect(name.shadowRoot!.querySelector("input")!.getAttribute("aria-invalid")).toBe("true");
  expect(minutes.shadowRoot!.querySelector("[data-error]")!.textContent).toBe(
    "Whole minutes, 0 to 120.",
  );
  expect(minutes.shadowRoot!.querySelector("input")!.getAttribute("aria-invalid")).toBe("true");
  expect(nameInput(el, 0).shadowRoot!.querySelector("input")!.getAttribute("aria-invalid")).toBe(
    "false",
  );
  expect(q(el, '[data-test="list-error"]')!.textContent!.trim()).toBe(
    "A step was changed elsewhere. Cancel and open it again to see the latest.",
  );
});

it("shows a start's error under the start", async () => {
  const el = await mount({
    errors: { s3: { start: "That course was deleted. Choose another start." } },
  });
  expect(startBox(el, 2).error).toBe("That course was deleted. Choose another start.");
});

it("draws one table row and one handle per step, in order", async () => {
  const el = await mount();
  expect(rows(el)).toHaveLength(STEPS.length);
  expect(
    rows(el).map((row) => row.querySelector("[data-test^=drag-]")!.getAttribute("data-test")),
  ).toEqual(STEPS.map((step) => `drag-${step.key}`));
});

it("read-only: no handles, no menus, no Add step, fields disabled", async () => {
  const el = await mount({ disabled: true });
  expect(rows(el)).toHaveLength(4);
  expect(el.shadowRoot!.querySelector("[data-test^=drag-]")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-row-actions")).toBeNull();
  expect(addButton(el)).toBeNull();
  for (let index = 0; index < 4; index++) {
    expect(nameInput(el, index).disabled).toBe(true);
    expect(startBox(el, index).disabled).toBe(true);
    expect(minutesInput(el, index).disabled).toBe(true);
  }
});

it("reads in Spanish", async () => {
  setLocale("es");
  try {
    const el = await mount();
    expect(q(el, '[data-test="service-steps-heading"]')!.textContent!.trim()).toBe(
      "Pasos de servicio",
    );
    expect(heads(el).slice(0, 2)).toEqual(["Paso", "Empieza"]);
    expect(startBox(el, 2).shadowRoot!.querySelector(".value")!.textContent).toBe(
      "Al servir Mains",
    );
    expect(addButton(el)!.textContent!.trim()).toBe("Añadir paso");
    el.courses = [{ id: "c-mains", name: "Principales" }];
    await settle(el);
    expect(startBox(el, 2).shadowRoot!.querySelector(".value")!.textContent).toBe(
      "Al servir Principales",
    );
  } finally {
    setLocale("en");
  }
});
