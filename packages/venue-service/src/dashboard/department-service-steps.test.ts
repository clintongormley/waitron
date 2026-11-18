import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, mountInShadowRoot } from "@waitron/ui/src/test-helpers.js";
import type { DepartmentServiceSteps } from "./department-service-steps.js";
import type { ServiceStepDraft } from "./service-step-draft.js";
import { STARTER_COURSE_NAMES, STARTER_STEP_NAMES } from "../starter-content.js";

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
    start: "after_step",
    afterStepKey: "s1",
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
  props: Partial<Pick<DepartmentServiceSteps, "steps" | "courses" | "errors" | "disabled">> = {},
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
  [...el.shadowRoot!.querySelectorAll("thead [data-head]")].map((head) =>
    [...head.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join("")
      .trim(),
  );
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

it("marks waiter steps with the shared primary colour and the step icon", async () => {
  const el = await mount();
  el.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  el.style.setProperty("--wt-color-primary-text", "rgb(4, 5, 6)");
  const cell = rows(el)[0]!.firstElementChild!;
  expect(getComputedStyle(cell).borderInlineStartColor).toBe("rgb(1, 2, 3)");
  expect(parseFloat(getComputedStyle(cell).borderInlineStartWidth)).toBeGreaterThan(0);
  const icon = q(el, 'h4 wt-icon[name="floor-step"]');
  expect(icon).not.toBeNull();
  expect(getComputedStyle(icon!).color).toBe("rgb(4, 5, 6)");
});

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
    ["Take order", "After Set up", "2", "min"],
    ["Dessert?", "Mains served", "10", "min"],
    ["Anything else?", "Everything served", "10", "min"],
  ]);
  expect(q(el, '[data-test="service-steps-heading"]')!.textContent!.trim()).toBe("Service steps");
});

it("offers named steps except itself and its descendants, then courses in their order", async () => {
  const el = await mount();
  expect(startBox(el, 0).options.map((option) => option.label)).toEqual([
    "When seated",
    "After Dessert?",
    "After Anything else?",
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

it("Add step adds an empty row, When seated in an empty list and after the last named step otherwise, and focuses its name", async () => {
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
  expect(second).toMatchObject({
    id: null,
    name: "",
    start: "after_step",
    afterStepKey: first!.key,
    minutes: "0",
  });
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
  const el = await mount({
    steps: [
      {
        ...STEPS[1]!,
        key: "grandchild",
        id: "grandchild",
        name: "Check again",
        afterStepKey: "s2",
      },
      STEPS[1]!,
      STEPS[0]!,
      STEPS[2]!,
    ],
  });
  const { changes } = record();
  await remove(el, "s1");
  expect(changes.at(-1)!.map((step) => step.key)).toEqual(["s3"]);
  expect(el.shadowRoot!.activeElement).toBe(nameInput(el, 0));

  await remove(el, "s3");
  expect(changes.at(-1)).toEqual([]);
  expect(el.shadowRoot!.activeElement).toBe(addButton(el));
});

it("keeps a delay field and its row in place while typing multiple digits", async () => {
  const el = await mount({
    steps: [
      STEPS[0]!,
      ...[
        ["alpha", "Alpha", "5"],
        ["bravo", "Bravo", "10"],
        ["charlie", "Charlie", "20"],
      ].map(([key, name, minutes]) => ({
        key: key!,
        id: key!,
        name: name!,
        minutes: minutes!,
        start: "after_step" as const,
        afterStepKey: "s1",
        courseId: null,
      })),
    ],
  });
  const input = minutesInput(el, 3).shadowRoot!.querySelector("input")!;
  await userEvent.type(input, "{selectall}15");
  await settle(el);
  expect(el.steps.find((step) => step.key === "charlie")!.minutes).toBe("15");
  await userEvent.type(input, "{selectall}7");
  await settle(el);
  expect(el.steps.find((step) => step.key === "charlie")!.minutes).toBe("7");
  expect(rows(el).map((row) => row.getAttribute("data-step"))).toEqual([
    "s1",
    "alpha",
    "bravo",
    "charlie",
  ]);
  expect(el.shadowRoot!.activeElement).toBe(minutesInput(el, 3));
});

it("places a step by its named start and offers no dragging", async () => {
  const el = await mount();
  const { changes } = record();
  await choose(el, 3, "Starters served");
  expect(changes.at(-1)!.map((step) => step.key)).toEqual(["s1", "s2", "s4", "s3"]);
  await choose(el, 2, "After Dessert?");
  expect(changes.at(-1)!.map((step) => step.key)).toEqual(["s1", "s2", "s3", "s4"]);
  expect(changes.at(-1)![3]).toMatchObject({
    start: "after_step",
    afterStepKey: "s3",
    courseId: null,
  });
  expect(q(el, '[data-test^="drag-"]')).toBeNull();
  expect(el.shadowRoot!.activeElement).toBe(startBox(el, 3));
});

it("shows each error under its own field", async () => {
  const el = await mount({
    errors: {
      s2: { name: "This field is required." },
      s3: { minutes: "Whole minutes, 0 to 120." },
    },
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
});

it("shows a start's error under the start", async () => {
  const el = await mount({
    errors: { s3: { start: "That course was deleted. Choose another start." } },
  });
  expect(startBox(el, 2).error).toBe("That course was deleted. Choose another start.");
});

function expectInFull(box: Element | null | undefined, what: string): void {
  const widths = box
    ? `scrollWidth ${box.scrollWidth} > clientWidth ${box.clientWidth}`
    : "not drawn";
  expect.soft(box ? box.scrollWidth <= box.clientWidth : false, `${what}: ${widths}`).toBe(true);
}

const STARTER_STEP_OF: Record<string, keyof typeof STARTER_STEP_NAMES> = {
  s1: "Set up",
  s2: "Take order",
  s3: "Dessert?",
  s4: "Coffee or bill?",
  s5: "Take order",
};
const STARTER_COURSE_OF: Record<string, keyof typeof STARTER_COURSE_NAMES> = {
  "c-starters": "Starters",
  "c-mains": "Mains",
};
// Verdana is about as wide as CI's Linux system font (DejaVu Sans).
const WIDE = 'Verdana, "DejaVu Sans"';

it.each([
  { locale: "en", width: 576, font: "", startsInFull: true, tableFits: true },
  { locale: "en", width: 356, font: "", startsInFull: false, tableFits: true },
  { locale: "en", width: 576, font: WIDE, startsInFull: true, tableFits: true },
  { locale: "en", width: 540, font: WIDE, startsInFull: true, tableFits: true },
  { locale: "en", width: 356, font: WIDE, startsInFull: true, tableFits: true },
  { locale: "en", width: 320, font: WIDE, startsInFull: true, tableFits: true },
  { locale: "en", width: 286, font: WIDE, startsInFull: true, tableFits: false },
  { locale: "es", width: 576, font: WIDE, startsInFull: true, tableFits: true },
  { locale: "es", width: 540, font: WIDE, startsInFull: true, tableFits: true },
  { locale: "es", width: 356, font: WIDE, startsInFull: true, tableFits: true },
  { locale: "es", width: 320, font: WIDE, startsInFull: true, tableFits: true },
  { locale: "es", width: 286, font: WIDE, startsInFull: true, tableFits: false },
] as const)(
  "at the $width px the department dialog gives the list, a three-digit minutes value and each name read in full ($locale, font $font)",
  async ({ locale, width, font, startsInFull, tableFits }) => {
    setLocale(locale);
    const steps: ServiceStepDraft[] = [
      ...copy(STEPS).map((step) => (step.key === "s3" ? { ...step, minutes: "120" } : step)),
      {
        key: "s5",
        id: "s5",
        name: "Take order",
        start: "since_last_order",
        courseId: null,
        minutes: "15",
      },
    ];
    const el = await mount(
      locale === "es"
        ? {
            steps: steps.map((step) => ({
              ...step,
              name: STARTER_STEP_NAMES[STARTER_STEP_OF[step.key]!].es,
            })),
            courses: COURSES.map((course) => ({
              ...course,
              name: STARTER_COURSE_NAMES[STARTER_COURSE_OF[course.id]!].es,
            })),
          }
        : { steps },
    );
    if (font) {
      const family = getComputedStyle(el).getPropertyValue("--wt-font-family");
      expect(family).not.toBe("");
      el.style.setProperty("--wt-font-family", `${font}, ${family}`);
    }
    el.style.width = `${width}px`;
    await settle(el);
    rows(el).forEach((_, index) => {
      const row = `row ${index + 1}`;
      expectInFull(minutesInput(el, index).shadowRoot!.querySelector("input"), `minutes in ${row}`);
      expectInFull(nameInput(el, index).shadowRoot!.querySelector("input"), `name in ${row}`);
      if (startsInFull) {
        const start = startBox(el, index).shadowRoot!.querySelector(".value");
        expectInFull(start, `start in ${row}`);
      }
    });
    // At 286 px the table scrolls sideways; names and starts are still checked in full.
    const wrap = q(el, ".table-wrap")!;
    if (tableFits) expect(wrap.scrollWidth).toBeLessThanOrEqual(wrap.clientWidth);
  },
);

it("draws one table row per step in order", async () => {
  const el = await mount();
  expect(rows(el).map((row) => row.getAttribute("data-step"))).toEqual(
    STEPS.map((step) => step.key),
  );
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

it("visibly marks Step, Starts and Minutes as required", async () => {
  const el = await mount();
  const marks = [...el.shadowRoot!.querySelectorAll("thead [data-head]")].map((head) =>
    head.querySelector<HTMLElement>(".required"),
  );
  expect(marks.map((mark) => mark?.textContent)).toEqual(["*", "*", "*"]);
  for (const mark of marks) {
    expect(mark!.getAttribute("aria-hidden")).toBe("true");
    expect(mark!.checkVisibility()).toBe(true);
    const box = mark!.getBoundingClientRect();
    expect(box.width * box.height).toBeGreaterThan(1);
  }
  expect(minutesInput(el, 0).shadowRoot!.querySelector<HTMLInputElement>("input")!.required).toBe(
    true,
  );
});

it("draws Minutes beside its required mark and keeps Actions available to screen readers", async () => {
  const el = await mount();
  expect(heads(el)).toEqual(["Step", "Starts", "Minutes"]);
  const heading = q(el, "thead .minutes")!;
  const label = new Range();
  label.selectNodeContents(heading);
  const box = label.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(
    heading.querySelector(".required")!.getBoundingClientRect().width,
  );
  const actions = q(el, "thead .actions-cell")!.querySelector<HTMLElement>(".visually-hidden")!;
  expect(actions.textContent).toBe("Actions");
  expect(actions.checkVisibility()).toBe(true);
  const hidden = actions.getBoundingClientRect();
  expect(hidden.width * hidden.height).toBeLessThanOrEqual(1);
});

it("reads a course or step name holding a replacement pattern literally", async () => {
  const el = await mount({
    steps: [{ ...STEPS[2]!, name: "Dessert $& $' $`" }],
    courses: [{ id: "c-mains", name: "Mains $& $' $`" }],
  });
  expect(startBox(el, 0).shadowRoot!.querySelector(".value")!.textContent).toBe(
    "Mains $& $' $` served",
  );
  expect(
    q(el, "wt-row-actions")!.shadowRoot!.querySelector("button")!.getAttribute("aria-label"),
  ).toBe("Delete: Dessert $& $' $`");
});
