import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, ServiceStatus } from "../api/client.js";
import "./service-status-screen.js";
import type { ServiceStatusScreen } from "./service-status-screen.js";

afterEach(cleanupWidgets);

// Every field of both rows holds something, in the spellings a stored status comes back in, and
// one row is disabled, so a field that rewrites its value on first draw would show as a change.
const seed: ServiceStatus[] = [
  {
    id: "s1",
    label: "Bill requested",
    color: "#ef4444",
    displayOrder: 0,
    active: true,
    createdAt: "2026-08-17T00:00:00Z",
  },
  {
    id: "s2",
    label: "Needs cleaning",
    color: "#f59e0b",
    displayOrder: 3,
    active: false,
    createdAt: "2026-08-17T00:00:00Z",
  },
];

function stubApi() {
  let rows = seed.map((row) => ({ ...row }));
  const api = {
    listStatuses: vi.fn(async () => rows.map((row) => ({ ...row }))),
    createStatus: vi.fn(async (input: { label: string; color: string; displayOrder: number }) => {
      rows = [...rows, { ...input, id: "s3", active: true, createdAt: "2026-08-17T00:00:00Z" }];
      return { id: "s3" };
    }),
    updateStatus: vi.fn(async (id: string, patch: Partial<ServiceStatus>) => {
      rows = rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
    }),
    deactivateStatus: vi.fn(async () => {}),
  };
  return api;
}

async function mount() {
  const api = stubApi();
  const { el } = await mountWidget<ServiceStatusScreen>("dashboard-service-status-screen", {
    api: api as unknown as DashboardApi,
  });
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=row-s2]")).toBeTruthy();
  await el.updateComplete;
  return { el, api };
}

function button(el: ServiceStatusScreen, test: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `wt-button[data-test="${test}"]`,
  )!;
}
/** What the action looks like and whether a person can press it: the host's state and its inner button's. */
async function state(el: ServiceStatusScreen, test: string) {
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

/** A real pointer press on the inner button; `force` presses a disabled one too. */
async function press(el: ServiceStatusScreen, test: string) {
  const inner = button(el, test).shadowRoot!.querySelector("button")!;
  await userEvent.click(page.elementLocator(inner), { force: true });
  await el.updateComplete;
}
async function type(el: ServiceStatusScreen, test: string, value: string) {
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `wt-input[data-test="${test}"]`,
  )!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}
async function toggle(el: ServiceStatusScreen, test: string) {
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
    `wt-switch[data-test="${test}"]`,
  )!;
  await field.updateComplete;
  await userEvent.click(page.elementLocator(field.shadowRoot!.querySelector(".hit-area")!));
  await el.updateComplete;
}

it("every stored row's Save and the add action open quiet and disabled, and a press sends nothing", async () => {
  const { el, api } = await mount();
  for (const test of ["save-s1", "save-s2", "add"]) {
    expect(await state(el, test)).toEqual(quiet);
    await press(el, test);
  }
  expect(api.updateStatus).not.toHaveBeenCalled();
  expect(api.createStatus).not.toHaveBeenCalled();
});

it("an edited label wakes its own row's Save only, and typing the stored label back quiets it", async () => {
  const { el } = await mount();
  await type(el, "label-s1", "Bill please");
  expect(await state(el, "save-s1")).toEqual(ready);
  expect(await state(el, "save-s2")).toEqual(quiet);
  expect(await state(el, "add")).toEqual(quiet);
  await type(el, "label-s1", "Bill requested");
  expect(await state(el, "save-s1")).toEqual(quiet);
});

it("a changed colour, order or active switch each wake the row's Save", async () => {
  const { el } = await mount();
  await type(el, "color-s2", "#10b981");
  expect(await state(el, "save-s2")).toEqual(ready);
  await type(el, "color-s2", "#f59e0b");
  expect(await state(el, "save-s2")).toEqual(quiet);
  await type(el, "order-s2", "4");
  expect(await state(el, "save-s2")).toEqual(ready);
  await type(el, "order-s2", "3");
  expect(await state(el, "save-s2")).toEqual(quiet);
  await toggle(el, "active-s2");
  expect(await state(el, "save-s2")).toEqual(ready);
  await toggle(el, "active-s2");
  expect(await state(el, "save-s2")).toEqual(quiet);
});

it("a saved row's Save goes quiet again while the row stays on screen", async () => {
  const { el, api } = await mount();
  await type(el, "label-s1", "Bill please");
  await press(el, "save-s1");
  expect(api.updateStatus).toHaveBeenCalledOnce();
  await expect.poll(() => state(el, "save-s1")).toEqual(quiet);
});

it("a typed name wakes the add action, and clearing it quiets it again", async () => {
  const { el } = await mount();
  await type(el, "new-label", "Needs water");
  expect(await state(el, "add")).toEqual(ready);
  await type(el, "new-label", "");
  expect(await state(el, "add")).toEqual(quiet);
});

it("a colour picked with no name keeps the add action drawn primary but disabled", async () => {
  const { el, api } = await mount();
  await type(el, "new-color", "#10b981");
  expect(await state(el, "add")).toEqual(blocked);
  button(el, "add").click();
  await el.updateComplete;
  expect(api.createStatus).not.toHaveBeenCalled();
});

it("the add action goes quiet again after a status is created", async () => {
  const { el, api } = await mount();
  await type(el, "new-label", "Needs water");
  await press(el, "add");
  expect(api.createStatus).toHaveBeenCalledOnce();
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=row-s3]")).toBeTruthy();
  expect(await state(el, "add")).toEqual(quiet);
});

// A host `.click()` reaches the listener even while the inner button is disabled, so these press the
// host: what they prove is that the handler itself sends nothing for an untouched form.
it("a press that reaches an untouched row's Save handler sends nothing", async () => {
  const { el, api } = await mount();
  button(el, "save-s1").click();
  await el.updateComplete;
  expect(api.updateStatus).not.toHaveBeenCalled();
});

it("Disable is immediate, not gated on a change", async () => {
  const { el, api } = await mount();
  await press(el, "deactivate-s1");
  expect(api.deactivateStatus).toHaveBeenCalledWith("s1");
});
