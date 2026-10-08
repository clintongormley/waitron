import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { LocalHolidayModel } from "../holiday-types.js";
import { HoursApi } from "./hours-client.js";
import type { LocalHolidaysEditor } from "./local-holidays-editor.js";
import "./local-holidays-editor.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

const SEVILLA = {
  id: "g-sevilla",
  country: "ES",
  provinceCode: "41",
  city: "Sevilla",
  areaKey: null,
  matchesVenue: true,
};
const OLD_TOWN = { ...SEVILLA, id: "g-old", city: "Dos Hermanas", matchesVenue: false };

function localModel(): LocalHolidayModel {
  return {
    venue: { country: "ES", provinceCode: "41", city: "Sevilla" },
    localEntryLimit: 2,
    areaOptions: [],
    areaRequired: false,
    geographies: [SEVILLA, OLD_TOWN],
    entries: [{ id: "e1", geographyId: SEVILLA.id, date: "2026-05-30", name: "San Fernando" }],
  };
}

function server() {
  const writes: unknown[] = [];
  const request = vi.fn(async (_path: string, method: string) => {
    if (method === "GET") return structuredClone(localModel());
    const next = writes.shift();
    if (typeof next === "object" && next !== null && "reject" in next)
      throw (next as { reject: unknown }).reject;
    return next;
  });
  const api = new HoursApi(request as unknown as DashboardRequest);
  const sent = () => request.mock.calls.filter((call) => call[1] !== "GET");
  return { api, writes, sent };
}

async function settle(el: LocalHolidaysEditor) {
  for (let turn = 0; turn < 3; turn++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await el.updateComplete;
}

async function mount(api: HoursApi): Promise<LocalHolidaysEditor> {
  const host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = document.createElement("local-holidays-editor");
  el.api = api;
  el.today = "2026-10-07";
  host.append(el);
  await settle(el);
  return el;
}

function find<T extends Element = HTMLElement>(el: Element, selector: string): T | null {
  const search = (root: ParentNode): T | null => {
    const hit = root.querySelector<T>(selector);
    if (hit) return hit;
    for (const child of root.querySelectorAll("*"))
      if (child.shadowRoot) {
        const inner = search(child.shadowRoot);
        if (inner) return inner;
      }
    return null;
  };
  return search(el.shadowRoot!);
}
const part = (el: LocalHolidaysEditor, test: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`)!;
const saveButton = (el: LocalHolidaysEditor) =>
  part(el, "save-local") as HTMLElementTagNameMap["wt-button"];

/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: LocalHolidaysEditor) {
  await settle(el);
  const save = saveButton(el);
  await save.updateComplete;
  return {
    variant: save.variant,
    disabled: save.disabled,
    innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };

async function type(el: LocalHolidaysEditor, name: string, value: string) {
  const field = find<HTMLElementTagNameMap["wt-input"]>(el, `wt-input[name="${name}"]`)!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), value);
  await settle(el);
}
async function openEdit(el: LocalHolidaysEditor) {
  const action = find(el, '[data-test="edit-local"]')!;
  action.closest("wt-row-actions")!.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  action.click();
  await settle(el);
}
async function openAdd(el: LocalHolidaysEditor) {
  part(el, "add-local").click();
  await settle(el);
}
const fieldError = (el: LocalHolidaysEditor, name: string) =>
  find<HTMLElementTagNameMap["wt-input"]>(el, `wt-input[name="${name}"]`)!.error;

it("Edit on a stored holiday opens with Save quiet and disabled", async () => {
  const { api } = server();
  const el = await mount(api);
  await openEdit(el);
  expect(await saveState(el)).toEqual(quiet);
});

it("Add with nothing typed opens with Save quiet and disabled", async () => {
  const { api } = server();
  const el = await mount(api);
  await openAdd(el);
  expect(await saveState(el)).toEqual(quiet);
});

it("one edit makes Save primary and enabled; the stored name typed back, with or without spaces, makes it quiet again", async () => {
  const { api } = server();
  const el = await mount(api);
  await openEdit(el);
  await type(el, "holidayName", "San Fernando Rey");
  expect(await saveState(el)).toEqual(ready);
  await type(el, "holidayName", "San Fernando");
  expect(await saveState(el)).toEqual(quiet);
  await type(el, "holidayName", "  San Fernando  ");
  expect(await saveState(el)).toEqual(quiet);
  await type(el, "holidayDate", "2026-06-01");
  expect(await saveState(el)).toEqual(ready);
  await type(el, "holidayDate", "2026-05-30");
  expect(await saveState(el)).toEqual(quiet);
});

it("on Add, typing makes Save primary and clearing it back makes it quiet", async () => {
  const { api } = server();
  const el = await mount(api);
  await openAdd(el);
  await type(el, "holidayName", "Feria");
  expect(await saveState(el)).toEqual(ready);
  await type(el, "holidayName", "");
  expect(await saveState(el)).toEqual(quiet);
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself sends nothing for an untouched form.
it("a press that reaches Save's handler on an untouched Edit sends nothing and marks nothing", async () => {
  const { api, sent } = server();
  const el = await mount(api);
  await openEdit(el);
  saveButton(el).click();
  await settle(el);
  expect(sent()).toEqual([]);
  expect(fieldError(el, "holidayDate")).toBe("");
  expect(fieldError(el, "holidayName")).toBe("");
});

it("a press that reaches Save's handler on an untouched Add sends nothing and marks nothing", async () => {
  const { api, sent } = server();
  const el = await mount(api);
  await openAdd(el);
  saveButton(el).click();
  await settle(el);
  expect(sent()).toEqual([]);
  expect(fieldError(el, "holidayDate")).toBe("");
  expect(fieldError(el, "holidayName")).toBe("");
});

it("a refused save leaves Save enabled and primary", async () => {
  const { api, writes, sent } = server();
  const el = await mount(api);
  await openEdit(el);
  await type(el, "holidayName", "San Fernando Rey");
  writes.push({ reject: { code: "holiday.invalid", params: { field: "id" } } });
  saveButton(el).click();
  await settle(el);
  expect(sent()).toHaveLength(1);
  expect(await saveState(el)).toEqual(ready);
});

it("Remove and Forget open with their action enabled and drawn danger", async () => {
  const { api } = server();
  const el = await mount(api);
  const remove = find(el, '[data-test="remove-local"]')!;
  remove.closest("wt-row-actions")!.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  remove.click();
  await settle(el);
  expect(await saveState(el)).toEqual({ variant: "danger", disabled: false, innerDisabled: false });
  part(el, "cancel-local").click();
  await settle(el);
  find(el, '[data-test="forget-g-old"]')!.click();
  await settle(el);
  expect(await saveState(el)).toEqual({ variant: "danger", disabled: false, innerDisabled: false });
});
