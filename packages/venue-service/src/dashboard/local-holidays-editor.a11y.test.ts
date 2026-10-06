import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { LocalHolidayModel } from "../holiday-types.js";
import { HoursApi } from "./hours-client.js";
import type { LocalHolidaysEditor } from "./local-holidays-editor.js";
import "./local-holidays-editor.js";

afterEach(async () => {
  cleanup();
  setLocale("en");
  await page.viewport(1280, 800);
});

const CURRENT = {
  id: "g-vielha",
  country: "ES",
  provinceCode: "25",
  city: "Vielha",
  areaKey: null,
  matchesVenue: true,
};
const AREAS = [
  { key: "aran", name: "Arán" },
  { key: "lleida-rest", name: "Lleida, fuera del territorio de Arán" },
];

function localModel(over: Partial<LocalHolidayModel> = {}): LocalHolidayModel {
  return {
    venue: { country: "ES", provinceCode: "25", city: "Vielha" },
    localEntryLimit: 2,
    areaOptions: AREAS,
    areaRequired: true,
    geographies: [CURRENT, { ...CURRENT, id: "g-old", city: "Lleida", matchesVenue: false }],
    entries: [{ id: "e1", geographyId: CURRENT.id, date: "2026-06-17", name: "Sant Joan" }],
    ...over,
  };
}

async function mount(
  theme: "light" | "dark",
  options: {
    model?: LocalHolidayModel;
    readOnly?: boolean;
    refuse?: unknown;
    failRead?: boolean;
    pendingRead?: boolean;
  } = {},
): Promise<LocalHolidaysEditor> {
  await mountThemed("<div></div>", theme);
  const request = async (_path: string, method: string) => {
    if (method === "GET") {
      if (options.pendingRead) return new Promise(() => {});
      if (options.failRead) throw { code: "connection.failed" };
      return options.model ?? localModel();
    }
    if (options.refuse !== undefined) throw options.refuse;
    return undefined;
  };
  const el = document.createElement("local-holidays-editor");
  el.api = new HoursApi(request as unknown as DashboardRequest);
  el.readOnly = options.readOnly ?? false;
  el.today = "2026-10-07";
  host.append(el);
  await settle(el);
  return el;
}

async function settle(el: LocalHolidaysEditor) {
  for (let turn = 0; turn < 3; turn++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function deep(el: Element, selector: string): HTMLElement | null {
  const search = (root: ParentNode): HTMLElement | null => {
    const found = root.querySelector<HTMLElement>(selector);
    if (found) return found;
    for (const child of root.querySelectorAll("*"))
      if (child.shadowRoot) {
        const inner = search(child.shadowRoot);
        if (inner) return inner;
      }
    return null;
  };
  return search(el.shadowRoot!);
}

async function press(el: LocalHolidaysEditor, selector: string) {
  const target = deep(el, selector)!;
  expect(target, selector).not.toBeNull();
  const menu = target.closest("wt-row-actions");
  if (menu) menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  target.click();
  await settle(el);
}

async function set(el: LocalHolidaysEditor, name: string, value: string) {
  const field = deep(el, `[name="${name}"]`) as HTMLElement & { value: string };
  field.value = value;
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settle(el);
}

const states: Record<string, (theme: "light" | "dark") => Promise<LocalHolidaysEditor>> = {
  "entries, an area to choose and an earlier address's notice": (theme) => mount(theme),
  "read-only with a chosen area": (theme) =>
    mount(theme, {
      readOnly: true,
      model: localModel({ areaRequired: false, geographies: [{ ...CURRENT, areaKey: "aran" }] }),
    }),
  "an address with no city, the area choice disabled": (theme) =>
    mount(theme, {
      model: localModel({
        venue: { country: "ES", provinceCode: "25", city: null },
        geographies: [],
        entries: [],
      }),
    }),
  "a country with no local holidays": (theme) =>
    mount(theme, {
      model: localModel({ localEntryLimit: 0, areaOptions: [], geographies: [], entries: [] }),
    }),
  "the first read still in flight": (theme) => mount(theme, { pendingRead: true }),
  "a failed first read": (theme) => mount(theme, { failRead: true }),
  "an add after a failed press": async (theme) => {
    const el = await mount(theme);
    await press(el, '[data-test="add-local"]');
    await press(el, '[data-test="save-local"]');
    expect((deep(el, '[name="holidayDate"]') as HTMLElement & { error: string }).error).not.toBe(
      "",
    );
    return el;
  },
  "an edit refused at the bottom": async (theme) => {
    const el = await mount(theme, { refuse: { code: "holiday.not_found", params: { id: "e1" } } });
    await press(el, '[data-test="edit-local"]');
    await set(el, "holidayName", "Sant Joan de Vielha");
    await press(el, '[data-test="save-local"]');
    return el;
  },
  "removing an entry": async (theme) => {
    const el = await mount(theme);
    await press(el, '[data-test="remove-local"]');
    return el;
  },
  "removing an earlier address's holidays": async (theme) => {
    const el = await mount(theme);
    await press(el, '[data-test="forget-g-old"]');
    return el;
  },
  "a phone's width": async (theme) => {
    await page.viewport(390, 800);
    const el = await mount(theme);
    expect(window.innerWidth).toBe(390);
    return el;
  },
};

describe.each(["light", "dark"] as const)("Local holidays accessibility (%s)", (theme) => {
  test.each(Object.keys(states))("%s", async (state) => {
    setLocale("en");
    await states[state]!(theme);
    await expectNoA11yViolations(host);
  });
});
