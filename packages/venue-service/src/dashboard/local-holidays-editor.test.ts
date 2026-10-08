import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LiveData, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import type { WtFormActions } from "@waitron/ui";
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

function localModel(over: Partial<LocalHolidayModel> = {}): LocalHolidayModel {
  return {
    venue: { country: "ES", provinceCode: "41", city: "Sevilla" },
    localEntryLimit: 2,
    areaOptions: [],
    areaRequired: false,
    geographies: [SEVILLA],
    entries: [{ id: "e1", geographyId: SEVILLA.id, date: "2026-05-30", name: "San Fernando" }],
    ...over,
  };
}

/** A value to answer with, a promise of one, or `{ reject }` to refuse with. */
type Answer = unknown;

function server(model = localModel(), liveData?: LiveData) {
  const state = { model, reads: [] as Answer[], writes: [] as Answer[] };
  const request = vi.fn<
    (
      path: string,
      method: string,
      body?: unknown,
      options?: { passive?: boolean },
    ) => Promise<unknown>
  >(async (_path, method) => {
    const queue = method === "GET" ? state.reads : state.writes;
    const next = queue.length > 0 ? queue.shift() : method === "GET" ? state.model : undefined;
    const value = await next;
    if (typeof value === "object" && value !== null && "reject" in value)
      throw (value as { reject: unknown }).reject;
    return structuredClone(value);
  });
  const api = new HoursApi(request as unknown as DashboardRequest, liveData);
  const calls = (method: string) =>
    request.mock.calls.filter((call) => call[1] === method).map((call) => [call[0], call[2]]);
  return { state, request, api, calls };
}

async function settle(el: LocalHolidaysEditor) {
  for (let turn = 0; turn < 3; turn++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await el.updateComplete;
}

async function mount(api: HoursApi, readOnly = false): Promise<LocalHolidaysEditor> {
  const host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = document.createElement("local-holidays-editor");
  el.api = api;
  el.readOnly = readOnly;
  el.today = "2026-10-07";
  host.append(el);
  await settle(el);
  return el;
}

function findAll<T extends Element = HTMLElement>(el: Element, selector: string): T[] {
  const found: T[] = [];
  const search = (root: ParentNode) => {
    found.push(...root.querySelectorAll<T>(selector));
    for (const child of root.querySelectorAll("*")) if (child.shadowRoot) search(child.shadowRoot);
  };
  search(el.shadowRoot!);
  return found;
}
const find = <T extends Element = HTMLElement>(el: Element, selector: string): T | null =>
  findAll<T>(el, selector)[0] ?? null;
const text = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const part = (el: LocalHolidaysEditor, test: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`);

type Field = HTMLElement & {
  value: string;
  error: string;
  disabled: boolean;
  required: boolean;
  label: string;
  hint: string;
  options: { value: string; label: string }[];
  updateComplete: Promise<unknown>;
};
const field = (el: Element, name: string) => find<Field>(el, `[name="${name}"]`);
async function setField(el: LocalHolidaysEditor, name: string, value: string) {
  const target = field(el, name)!;
  expect(target, name).not.toBeNull();
  target.value = value;
  target.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settle(el);
}
async function click(el: LocalHolidaysEditor, target: HTMLElement | null) {
  expect(target).not.toBeNull();
  target!.click();
  await settle(el);
}
async function menuAction(el: LocalHolidaysEditor, test: string, index = 0) {
  const action = findAll(el, `[data-test="${test}"]`)[index] ?? null;
  expect(action, test).not.toBeNull();
  action!
    .closest("wt-row-actions")!
    .shadowRoot!.querySelector<HTMLButtonElement>("button")!
    .click();
  action!.click();
  await settle(el);
}
const modal = (el: LocalHolidaysEditor) => el.shadowRoot!.querySelector<HTMLElement>("wt-modal");
const saveButton = (el: LocalHolidaysEditor) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>('[data-test="save-local"]')!;
const cancelButton = (el: LocalHolidaysEditor) =>
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel-local"]')!;
async function bottomMessage(el: LocalHolidaysEditor): Promise<string> {
  const actions = el.shadowRoot!.querySelector<WtFormActions>("wt-modal wt-form-actions")!;
  return text(await formMessageOf(actions));
}
type Table = HTMLElement & {
  columns: { key: string; pinned?: string }[];
  rows: unknown[];
  updateComplete: Promise<unknown>;
};
const table = (el: LocalHolidaysEditor) => part(el, "local-entries") as Table | null;
async function tableRows(el: LocalHolidaysEditor): Promise<string[][]> {
  const shown = table(el)!;
  await shown.updateComplete;
  return [...shown.shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td, th")].map((cell) => text(cell)),
  );
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("Local holidays: what the section shows", () => {
  it("names the venue's city, the year's allowance from the response, and each entry, with a pinned actions column", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    expect(text(part(el, "local-heading"))).toBe("Local holidays");
    expect(text(part(el, "local-address"))).toBe(
      "Local holidays for Sevilla: up to 2 dates a year. They are your own entries, not checked against an official list.",
    );
    expect(text(part(el, "local-allowance"))).toBe("2026: 1 of 2 local holidays entered.");
    expect(await tableRows(el)).toEqual([["Sat, 30 May 2026", "San Fernando", "Edit Remove"]]);
    const columns = table(el)!.columns;
    expect(columns.at(-1)).toMatchObject({ key: "actions", pinned: "end" });
    expect(calls("GET")).toEqual([["/management-api/venue-service/local-holidays", undefined]]);
  });

  it("uses an allowance of 1 for the current year, and still accepts another year's date", async () => {
    const { api, state, calls } = server(localModel({ localEntryLimit: 1 }));
    const el = await mount(api);
    expect(text(part(el, "local-allowance"))).toBe("2026: 1 of 1 local holiday entered.");
    await click(el, part(el, "add-local"));
    await setField(el, "holidayDate", "2026-09-08");
    await setField(el, "holidayName", "Feria");
    await click(el, saveButton(el));
    expect(field(el, "holidayDate")!.error).toBe("You can enter at most 1 local holiday for 2026.");
    expect(saveButton(el).disabled).toBe(true);
    expect(calls("POST")).toEqual([]);
    await setField(el, "holidayDate", "2027-05-30");
    expect(field(el, "holidayDate")!.error).toBe("");
    expect(saveButton(el).disabled).toBe(false);
    state.writes.push({ id: "e2", geographyId: SEVILLA.id, date: "2027-05-30", name: "Feria" });
    await click(el, saveButton(el));
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    expect(calls("POST")).toEqual([
      ["/management-api/venue-service/local-holidays", { date: "2027-05-30", name: "Feria" }],
    ]);
  });

  it("uses an allowance of 3, letting a third date in the same year through", async () => {
    const entries = [
      { id: "e1", geographyId: SEVILLA.id, date: "2026-05-30", name: "San Fernando" },
      { id: "e2", geographyId: SEVILLA.id, date: "2026-06-04", name: "Corpus" },
    ];
    const { api, calls } = server(localModel({ localEntryLimit: 3, entries }));
    const el = await mount(api);
    expect(text(part(el, "local-allowance"))).toBe("2026: 2 of 3 local holidays entered.");
    await click(el, part(el, "add-local"));
    await setField(el, "holidayDate", "2026-04-22");
    await setField(el, "holidayName", "Feria de abril");
    await click(el, saveButton(el));
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    expect(calls("POST")).toEqual([
      [
        "/management-api/venue-service/local-holidays",
        { date: "2026-04-22", name: "Feria de abril" },
      ],
    ]);
  });

  it("says local entry is unavailable when the response allows none, and offers nothing to add", async () => {
    const { api } = server(localModel({ localEntryLimit: 0, geographies: [], entries: [] }));
    const el = await mount(api);
    expect(text(part(el, "local-address"))).toBe(
      "Local holidays cannot be entered for a venue in this country.",
    );
    expect(part(el, "add-local")).toBeNull();
    expect(part(el, "local-allowance")).toBeNull();
    expect(table(el)).toBeNull();
  });

  it("explains that the address needs a city, adds nothing, and shows the area choice disabled", async () => {
    const { api } = server(
      localModel({
        venue: { country: "ES", provinceCode: "25", city: null },
        areaOptions: [
          { key: "aran", name: "Arán" },
          { key: "lleida-rest", name: "Lleida, fuera del territorio de Arán" },
        ],
        areaRequired: true,
        geographies: [],
        entries: [],
      }),
    );
    const el = await mount(api);
    expect(text(part(el, "local-address"))).toBe(
      "Local holidays and the holiday area need the venue's city. Add it in Venue details.",
    );
    expect(part(el, "add-local")).toBeNull();
    const area = field(el, "holidayArea")!;
    expect(area.disabled).toBe(true);
  });

  it("explains that the address needs a province it can recognise", async () => {
    const { api } = server(
      localModel({ venue: { country: "ES", provinceCode: null, city: "Sevilla" }, entries: [] }),
    );
    const el = await mount(api);
    expect(text(part(el, "local-address"))).toBe(
      "Local holidays need a recognised province. Correct it in Venue details.",
    );
    expect(part(el, "add-local")).toBeNull();
  });

  it("points a Spanish reader to Datos del local to fix the address", async () => {
    setLocale("es");
    const { api } = server(
      localModel({ venue: { country: "ES", provinceCode: "41", city: null }, entries: [] }),
    );
    const el = await mount(api);
    expect(text(part(el, "local-address"))).toBe(
      "Los festivos locales necesitan la ciudad del local. Añádela en Datos del local.",
    );
  });

  it.each(["London", null])(
    "tells a venue in a country with no local holidays and no provinces (city %s) that they are unavailable, not to fix its address",
    async (city) => {
      const { api } = server(
        localModel({
          venue: { country: "GB", provinceCode: null, city },
          localEntryLimit: 0,
          areaOptions: [],
          areaRequired: false,
          geographies: [],
          entries: [],
        }),
      );
      const el = await mount(api);
      expect(text(part(el, "local-address"))).toBe(
        "Local holidays cannot be entered for a venue in this country.",
      );
    },
  );

  it("says local entry is unavailable in a country without it, even with no city", async () => {
    const { api } = server(
      localModel({
        venue: { country: "XX", provinceCode: "01", city: null },
        localEntryLimit: 0,
        geographies: [],
        entries: [],
      }),
    );
    const el = await mount(api);
    expect(text(part(el, "local-address"))).toBe(
      "Local holidays cannot be entered for a venue in this country.",
    );
    expect(part(el, "add-local")).toBeNull();
  });

  it("hides an earlier address's entries behind a notice, and shows them again once the address matches", async () => {
    const { api, state } = server(
      localModel({
        venue: { country: "ES", provinceCode: "41", city: "Utrera" },
        geographies: [{ ...SEVILLA, matchesVenue: false }],
        entries: [],
      }),
    );
    const el = await mount(api);
    expect(text(part(el, "retained"))).toBe("These local holidays were for Sevilla. Remove");
    expect(table(el)!.rows).toEqual([]);
    expect(findAll(el, "wt-button").map(text)).not.toContain("Confirm");

    state.model = localModel();
    api.rereadWatches();
    await settle(el);
    expect(part(el, "retained")).toBeNull();
    expect(await tableRows(el)).toEqual([["Sat, 30 May 2026", "San Fernando", "Edit Remove"]]);
  });

  it("shows everything to a read-only viewer with nothing to change", async () => {
    const { api } = server(
      localModel({
        areaOptions: [{ key: "aran", name: "Arán" }],
        geographies: [{ ...SEVILLA, areaKey: "aran" }, OLD_TOWN],
      }),
    );
    const el = await mount(api, true);
    expect(await tableRows(el)).toEqual([["Sat, 30 May 2026", "San Fernando"]]);
    expect(table(el)!.columns.map(({ key }) => key)).not.toContain("actions");
    expect(text(part(el, "retained"))).toBe("These local holidays were for Dos Hermanas.");
    expect(text(part(el, "area-chosen"))).toBe("Holiday area: Arán");
    expect(field(el, "holidayArea")).toBeNull();
    expect(part(el, "add-local")).toBeNull();
    expect(findAll(el, "wt-button")).toEqual([]);
  });

  it("keeps a long name whole", async () => {
    const name = "Festividad ".repeat(18).trim();
    const { api } = server(
      localModel({ entries: [{ id: "e1", geographyId: SEVILLA.id, date: "2026-05-30", name }] }),
    );
    const el = await mount(api);
    expect((await tableRows(el))[0]![1]).toBe(name);
  });

  it("speaks Spanish, showing the data's area names as they are", async () => {
    setLocale("es");
    const { api } = server(
      localModel({
        areaOptions: [{ key: "lleida-rest", name: "Lleida, fuera del territorio de Arán" }],
        areaRequired: true,
        geographies: [SEVILLA, OLD_TOWN],
      }),
    );
    const el = await mount(api);
    expect(text(part(el, "local-heading"))).toBe("Festivos locales");
    expect(text(part(el, "local-allowance"))).toBe("2026: 1 de 2 festivos locales introducidos.");
    expect(text(part(el, "retained"))).toBe("Estos festivos locales eran de Dos Hermanas. Quitar");
    expect(field(el, "holidayArea")!.options.map(({ label }) => label)).toEqual([
      "Lleida, fuera del territorio de Arán",
    ]);
  });
});

describe("Local holidays: adding and changing an entry", () => {
  it("marks every bad field and the bottom of the form, holds Save until fixed, then saves the trimmed name and closes", async () => {
    const { api, state, calls } = server();
    const el = await mount(api);
    await click(el, part(el, "add-local"));
    expect(modal(el)!.getAttribute("heading")).toBe("Add a local holiday for Sevilla");
    expect(field(el, "holidayDate")!.required).toBe(true);
    expect(field(el, "holidayName")!.required).toBe(true);
    expect(field(el, "holidayName")!.hint).toBe("As your town council publishes it");
    await setField(el, "holidayName", "Feria");
    await click(el, saveButton(el));
    expect(field(el, "holidayDate")!.error).toBe("Enter a date.");
    expect(field(el, "holidayName")!.error).toBe("");
    expect(await bottomMessage(el)).toBe("Correct the highlighted fields to continue.");
    expect(saveButton(el).disabled).toBe(true);
    await vi.waitFor(() => expect(field(el, "holidayDate")!.matches(":focus-within")).toBe(true));

    await setField(el, "holidayDate", "2026-05-30");
    expect(field(el, "holidayDate")!.error).toBe("Sat, 30 May 2026 already has a local holiday.");
    await setField(el, "holidayDate", "2026-09-08");
    await setField(el, "holidayName", "x".repeat(201));
    expect(field(el, "holidayName")!.error).toBe("Use at most 200 characters.");
    await setField(el, "holidayName", "  Virgen de la Hiniesta  ");
    expect(saveButton(el).disabled).toBe(false);
    expect(await bottomMessage(el)).toBe("");

    const reads = calls("GET").length;
    state.writes.push({ id: "e2", geographyId: SEVILLA.id, date: "2026-09-08", name: "x" });
    await click(el, saveButton(el));
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    expect(calls("POST")).toEqual([
      [
        "/management-api/venue-service/local-holidays",
        { date: "2026-09-08", name: "Virgen de la Hiniesta" },
      ],
    ]);
    await settle(el);
    expect(calls("GET").length).toBe(reads + 1);
    expect(document.activeElement === el && el.shadowRoot!.activeElement).toBe(
      part(el, "add-local"),
    );
  });

  it("marks a blank name when a date is typed, and holds Save until it is fixed", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await click(el, part(el, "add-local"));
    await setField(el, "holidayDate", "2026-09-08");
    await setField(el, "holidayName", "   ");
    await click(el, saveButton(el));
    expect(field(el, "holidayName")!.error).toBe("Enter a name.");
    expect(field(el, "holidayDate")!.error).toBe("");
    expect(await bottomMessage(el)).toBe("Correct the highlighted fields to continue.");
    expect(saveButton(el).disabled).toBe(true);
    await vi.waitFor(() => expect(field(el, "holidayName")!.matches(":focus-within")).toBe(true));
    expect(calls("POST")).toEqual([]);
  });

  const DOS_HERMANAS_NOW = () =>
    localModel({
      venue: { country: "ES", provinceCode: "41", city: "Dos Hermanas" },
      geographies: [{ ...SEVILLA, matchesVenue: false }],
      entries: [],
    });

  it("does not save a new holiday silently after the address moves to another city: it says so, keeps the values, and saves on the next Save", async () => {
    const { api, state, calls } = server();
    const el = await mount(api);
    await click(el, part(el, "add-local"));
    expect(modal(el)!.getAttribute("heading")).toBe("Add a local holiday for Sevilla");
    await setField(el, "holidayDate", "2026-09-08");
    await setField(el, "holidayName", "Feria");

    state.model = DOS_HERMANAS_NOW();
    api.rereadWatches();
    await settle(el);
    expect(modal(el)!.getAttribute("heading")).toBe("Add a local holiday for Dos Hermanas");
    await click(el, saveButton(el));
    expect(calls("POST")).toEqual([]);
    expect(await bottomMessage(el)).toBe(
      "The venue's address has changed to Dos Hermanas, so this holiday will be saved for Dos Hermanas. Press Save again to save it.",
    );
    expect(field(el, "holidayDate")!.value).toBe("2026-09-08");
    expect(field(el, "holidayName")!.value).toBe("Feria");
    expect(saveButton(el).disabled).toBe(false);

    state.writes.push({ id: "e2", geographyId: "g-dos", date: "2026-09-08", name: "Feria" });
    await click(el, saveButton(el));
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    expect(calls("POST")).toEqual([
      ["/management-api/venue-service/local-holidays", { date: "2026-09-08", name: "Feria" }],
    ]);
  });

  it("says the address change in Spanish", async () => {
    setLocale("es");
    const { api, state, calls } = server();
    const el = await mount(api);
    await click(el, part(el, "add-local"));
    expect(modal(el)!.getAttribute("heading")).toBe("Añadir un festivo local en Sevilla");
    await setField(el, "holidayDate", "2026-09-08");
    await setField(el, "holidayName", "Feria");
    state.model = DOS_HERMANAS_NOW();
    api.rereadWatches();
    await settle(el);
    await click(el, saveButton(el));
    expect(calls("POST")).toEqual([]);
    expect(await bottomMessage(el)).toBe(
      "La dirección del local ha cambiado a Dos Hermanas, así que este festivo se guardará para Dos Hermanas. Pulsa Guardar otra vez para guardarlo.",
    );
  });

  it("saves at once when the address is only spelled differently, as the server matches it", async () => {
    const { api, state, calls } = server();
    const el = await mount(api);
    await click(el, part(el, "add-local"));
    await setField(el, "holidayDate", "2026-09-08");
    await setField(el, "holidayName", "Feria");
    state.model = localModel({ venue: { country: "ES", provinceCode: "41", city: "  SEVILLA " } });
    api.rereadWatches();
    await settle(el);
    state.writes.push({ id: "e2", geographyId: SEVILLA.id, date: "2026-09-08", name: "Feria" });
    await click(el, saveButton(el));
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    expect(calls("POST")).toHaveLength(1);
  });

  it("leaves an address that lost its city to the server's refusal, naming no city in the heading", async () => {
    const { api, state, calls } = server();
    const el = await mount(api);
    await click(el, part(el, "add-local"));
    await setField(el, "holidayDate", "2026-09-08");
    await setField(el, "holidayName", "Feria");
    state.model = localModel({
      venue: { country: "ES", provinceCode: "41", city: null },
      geographies: [{ ...SEVILLA, matchesVenue: false }],
      entries: [],
    });
    api.rereadWatches();
    await settle(el);
    expect(modal(el)!.getAttribute("heading")).toBe("Add a local holiday");
    state.writes.push({ reject: { code: "holiday.invalid", params: { field: "geography" } } });
    await click(el, saveButton(el));
    expect(calls("POST")).toHaveLength(1);
    expect(await bottomMessage(el)).toBe(
      "Local holidays need the venue's city and a recognised province. Set them in Venue details.",
    );
  });

  it("edits an entry in place, keeping its own date, and saves on Enter", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await menuAction(el, "edit-local");
    expect(modal(el)!.getAttribute("heading")).toBe("Edit local holiday");
    expect(field(el, "holidayDate")!.value).toBe("2026-05-30");
    expect(field(el, "holidayName")!.value).toBe("San Fernando");
    await setField(el, "holidayName", "San Fernando, patrón");
    field(el, "holidayName")!.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    expect(calls("PUT")).toEqual([
      [
        "/management-api/venue-service/local-holidays/e1",
        { date: "2026-05-30", name: "San Fernando, patrón" },
      ],
    ]);
  });

  it("closes on Cancel without saving and returns focus to the row's menu", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await menuAction(el, "edit-local");
    await click(el, cancelButton(el));
    expect(modal(el)).toBeNull();
    expect(calls("PUT")).toEqual([]);
    await vi.waitFor(() =>
      expect(find(el, "wt-row-actions")!.shadowRoot!.activeElement).not.toBeNull(),
    );
  });

  it.each([
    [
      { code: "holiday.date_taken", params: { date: "2026-09-08" } },
      "holidayDate",
      "Tue, 8 Sept 2026 already has a local holiday.",
    ],
    [
      { code: "holiday.local_limit", params: { limit: 2, year: 2026 } },
      "holidayDate",
      "You can enter at most 2 local holidays for 2026.",
    ],
    [{ code: "holiday.invalid", params: { field: "name" } }, "holidayName", "Check the name."],
    [{ code: "holiday.invalid", params: { field: "date" } }, "holidayDate", "Check the date."],
  ])(
    "puts the refusal %j under its field, and Save stays ready to retry",
    async (refusal, name, sentence) => {
      const { api, state, calls } = server(localModel({ geographies: [SEVILLA, OLD_TOWN] }));
      const el = await mount(api);
      await click(el, part(el, "add-local"));
      await setField(el, "holidayDate", "2026-09-08");
      await setField(el, "holidayName", "Feria");
      state.writes.push({ reject: refusal });
      await click(el, saveButton(el));
      expect(field(el, name)!.error).toBe(sentence);
      expect(await bottomMessage(el)).toBe("Correct the highlighted fields to continue.");
      expect(saveButton(el).disabled).toBe(false);
      expect(field(el, "holidayName")!.value).toBe("Feria");
      expect(text(part(el, "retained"))).toBe("These local holidays were for Dos Hermanas. Remove");
      await click(el, saveButton(el));
      await vi.waitFor(() => expect(modal(el)).toBeNull());
      expect(calls("POST")).toHaveLength(2);
    },
  );

  it("keeps a refusal under its field while another field changes, and drops it once that field changes", async () => {
    const { api, state } = server();
    const el = await mount(api);
    await click(el, part(el, "add-local"));
    await setField(el, "holidayDate", "2026-09-08");
    await setField(el, "holidayName", "Feria");
    state.writes.push({ reject: { code: "holiday.date_taken", params: { date: "2026-09-08" } } });
    await click(el, saveButton(el));
    expect(field(el, "holidayDate")!.error).toBe("Tue, 8 Sept 2026 already has a local holiday.");

    await setField(el, "holidayName", "Feria de abril");
    expect(field(el, "holidayDate")!.error).toBe("Tue, 8 Sept 2026 already has a local holiday.");
    expect(await bottomMessage(el)).toBe("Correct the highlighted fields to continue.");

    await setField(el, "holidayDate", "2026-09-09");
    expect(field(el, "holidayDate")!.error).toBe("");
    expect(await bottomMessage(el)).toBe("");
    expect(saveButton(el).disabled).toBe(false);
  });

  it.each([
    [
      { code: "holiday.local_limit", params: { limit: 2 } },
      "You can enter at most 2 local holidays a year.",
    ],
    [
      { code: "holiday.local_limit", params: { limit: 1 } },
      "You can enter at most 1 local holiday a year.",
    ],
    [
      { code: "holiday.local_limit", params: { limit: 0 } },
      "Local holidays cannot be entered for a venue in this country.",
    ],
    [
      { code: "holiday.not_found", params: { holidayId: "e1" } },
      "This local holiday no longer exists.",
    ],
    [
      { code: "holiday.invalid", params: { field: "id" } },
      "This local holiday belongs to an earlier address, so it cannot be changed.",
    ],
    [
      { code: "holiday.invalid", params: { field: "geography" } },
      "Local holidays need the venue's city and a recognised province. Set them in Venue details.",
    ],
    [{ code: "connection.failed" }, "The change could not be saved."],
  ])(
    "says the refusal %j at the bottom, keeping the values and the retained notices",
    async (refusal, sentence) => {
      const { api, state } = server(localModel({ geographies: [SEVILLA, OLD_TOWN] }));
      const el = await mount(api);
      await menuAction(el, "edit-local");
      await setField(el, "holidayName", "San Fernando Rey");
      state.writes.push({ reject: refusal });
      await click(el, saveButton(el));
      expect(await bottomMessage(el)).toBe(sentence);
      expect(await bottomMessage(el)).not.toContain("{");
      expect(saveButton(el).disabled).toBe(false);
      expect(field(el, "holidayName")!.value).toBe("San Fernando Rey");
      expect(text(part(el, "retained"))).toBe("These local holidays were for Dos Hermanas. Remove");
    },
  );

  it("closes the editor once the write succeeds, and says a failed reload as a read failure", async () => {
    const { api, state } = server();
    const el = await mount(api);
    await click(el, part(el, "add-local"));
    await setField(el, "holidayDate", "2026-09-08");
    await setField(el, "holidayName", "Feria");
    state.reads.push({ reject: { code: "connection.failed" } });
    await click(el, saveButton(el));
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    await vi.waitFor(() =>
      expect(text(part(el, "local-alert"))).toBe("Local holidays could not be loaded."),
    );
  });

  it("cannot be closed while a save is in flight, and a reopened editor starts with nothing in flight", async () => {
    const { api, state, calls } = server();
    const el = await mount(api);
    await click(el, part(el, "add-local"));
    await setField(el, "holidayDate", "2026-09-08");
    await setField(el, "holidayName", "Feria");
    const held = deferred();
    state.writes.push(held.promise);
    await click(el, saveButton(el));
    expect(saveButton(el).disabled).toBe(true);
    expect((cancelButton(el) as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    cancelButton(el).click();
    field(el, "holidayName")!.focus();
    await userEvent.keyboard("{Escape}");
    await settle(el);
    expect(modal(el)).not.toBeNull();

    held.resolve({ reject: { code: "holiday.date_taken", params: { date: "2026-09-08" } } });
    await settle(el);
    expect(field(el, "holidayDate")!.error).toBe("Tue, 8 Sept 2026 already has a local holiday.");
    await click(el, cancelButton(el));
    expect(modal(el)).toBeNull();
    await click(el, part(el, "add-local"));
    expect(saveButton(el).disabled).toBe(true);
    expect(field(el, "holidayDate")!.value).toBe("");
    expect(field(el, "holidayDate")!.error).toBe("");
    await setField(el, "holidayName", "Feria");
    expect(saveButton(el).disabled).toBe(false);
    expect(calls("POST")).toHaveLength(1);
  });

  it("removes an entry after confirming, and says a refusal at the bottom", async () => {
    const { api, state, calls } = server();
    const el = await mount(api);
    await menuAction(el, "remove-local");
    expect(text(part(el, "confirm-text"))).toBe(
      "Remove the local holiday San Fernando on Sat, 30 May 2026?",
    );
    state.writes.push({ reject: { code: "holiday.not_found", params: { holidayId: "e1" } } });
    await click(el, saveButton(el));
    expect(await bottomMessage(el)).toBe("This local holiday no longer exists.");
    await click(el, saveButton(el));
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    expect(calls("DELETE")).toEqual([
      ["/management-api/venue-service/local-holidays/e1", undefined],
      ["/management-api/venue-service/local-holidays/e1", undefined],
    ]);
  });
});

describe("Local holidays: an earlier address and the holiday area", () => {
  it("removes an earlier address's local holidays after confirming, and says why the current one cannot go", async () => {
    const { api, state, calls } = server(localModel({ geographies: [SEVILLA, OLD_TOWN] }));
    const el = await mount(api);
    await click(el, find(el, '[data-test="forget-g-old"]'));
    expect(text(part(el, "confirm-text"))).toBe(
      "Remove every local holiday entered for Dos Hermanas? The current address's holidays stay.",
    );
    state.writes.push({
      reject: { code: "holiday.geography_current", params: { geographyId: "g-old" } },
    });
    await click(el, saveButton(el));
    expect(await bottomMessage(el)).toBe(
      "These local holidays are for the venue's current address, so they cannot be removed together.",
    );
    await click(el, saveButton(el));
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    expect(calls("DELETE").at(-1)).toEqual([
      "/management-api/venue-service/holiday-geographies/g-old",
      undefined,
    ]);
  });

  it.each([
    ["en", "These local holidays have already been removed."],
    ["es", "Estos festivos locales ya se han quitado."],
  ] as const)(
    "says in %s that an earlier address's holidays are already gone, not that one holiday is",
    async (locale, sentence) => {
      setLocale(locale);
      const { api, state } = server(localModel({ geographies: [SEVILLA, OLD_TOWN] }));
      const el = await mount(api);
      await click(el, find(el, '[data-test="forget-g-old"]'));
      state.writes.push({
        reject: { code: "holiday_geography.not_found", params: { geographyId: "g-old" } },
      });
      await click(el, saveButton(el));
      expect(await bottomMessage(el)).toBe(sentence);
      expect(saveButton(el).disabled).toBe(false);
    },
  );

  const VIELHA_AREAS = [
    { key: "aran", name: "Arán" },
    { key: "lleida-rest", name: "Lleida, fuera del territorio de Arán" },
  ];
  const GRAN_CANARIA_AREAS = [
    { key: "gran-canaria", name: "Gran Canaria" },
    { key: "lanzarote", name: "Lanzarote" },
  ];
  const areaModel = (
    provinceCode: string,
    city: string,
    areaOptions: { key: string; name: string }[],
  ) =>
    localModel({
      venue: { country: "ES", provinceCode, city },
      areaOptions,
      areaRequired: true,
      geographies: [],
      entries: [],
    });

  it("drops an area save's late refusal once the address has moved, freeing the new address's choice", async () => {
    const { api, state } = server(areaModel("25", "Vielha", VIELHA_AREAS));
    const el = await mount(api);
    const held = deferred();
    state.writes.push(held.promise);
    await chooseOption(field(el, "holidayArea")!, "aran");
    await settle(el);
    expect(field(el, "holidayArea")!.disabled).toBe(true);

    state.model = areaModel("35", "Las Palmas de Gran Canaria", GRAN_CANARIA_AREAS);
    api.rereadWatches();
    await settle(el);
    expect(field(el, "holidayArea")!.options.map(({ label }) => label)).toEqual([
      "Gran Canaria",
      "Lanzarote",
    ]);
    expect(field(el, "holidayArea")!.disabled).toBe(false);

    held.resolve({ reject: { code: "holiday.invalid", params: { field: "areaKey" } } });
    await settle(el);
    expect(field(el, "holidayArea")!.error).toBe("");
    expect(field(el, "holidayArea")!.disabled).toBe(false);
  });

  it("keeps an area refusal through a read of the same address, and clears it once the address moves", async () => {
    const { api, state } = server(areaModel("25", "Vielha", VIELHA_AREAS));
    const el = await mount(api);
    state.writes.push({ reject: { code: "holiday.invalid", params: { field: "areaKey" } } });
    await chooseOption(field(el, "holidayArea")!, "aran");
    await settle(el);
    expect(field(el, "holidayArea")!.error).toBe("Choose one of the areas offered.");

    api.rereadWatches();
    await settle(el);
    expect(field(el, "holidayArea")!.error).toBe("Choose one of the areas offered.");

    state.model = areaModel("35", "Las Palmas de Gran Canaria", GRAN_CANARIA_AREAS);
    api.rereadWatches();
    await settle(el);
    expect(field(el, "holidayArea")!.error).toBe("");
  });

  it("offers only the sourced areas, required until one is chosen, and saves the choice before any entry exists", async () => {
    const areaOptions = [
      { key: "aran", name: "Arán" },
      { key: "lleida-rest", name: "Lleida, fuera del territorio de Arán" },
    ];
    const { api, state, calls } = server(
      localModel({
        venue: { country: "ES", provinceCode: "25", city: "Vielha" },
        areaOptions,
        areaRequired: true,
        geographies: [],
        entries: [],
      }),
    );
    const el = await mount(api);
    const area = field(el, "holidayArea")!;
    expect(area.required).toBe(true);
    expect(area.options).toEqual([
      { value: "aran", label: "Arán" },
      { value: "lleida-rest", label: "Lleida, fuera del territorio de Arán" },
    ]);
    expect(text(part(el, "area-note"))).toBe(
      "Some official holidays here apply only in part of the province. Choose the area the venue is in.",
    );
    state.writes.push({ reject: { code: "holiday.invalid", params: { field: "areaKey" } } });
    await chooseOption(area, "aran");
    await settle(el);
    expect(field(el, "holidayArea")!.error).toBe("Choose one of the areas offered.");
    await chooseOption(field(el, "holidayArea")!, "aran");
    await settle(el);
    expect(field(el, "holidayArea")!.error).toBe("");
    expect(calls("PUT")).toEqual([
      ["/management-api/venue-service/holiday-area", { areaKey: "aran" }],
      ["/management-api/venue-service/holiday-area", { areaKey: "aran" }],
    ]);
    state.model = localModel({
      venue: { country: "ES", provinceCode: "25", city: "Vielha" },
      areaOptions,
      areaRequired: false,
      geographies: [{ ...SEVILLA, provinceCode: "25", city: "Vielha", areaKey: "aran" }],
      entries: [],
    });
    api.rereadWatches();
    await settle(el);
    expect(field(el, "holidayArea")!.value).toBe("aran");
    expect(field(el, "holidayArea")!.required).toBe(false);
  });

  it.each([
    [
      { code: "holiday.invalid", params: { field: "geography" } },
      "Local holidays need the venue's city and a recognised province. Set them in Venue details.",
    ],
    [{ code: "connection.failed" }, "The change could not be saved."],
  ])("puts the area refusal %j under the choice, which stays usable", async (refusal, sentence) => {
    const { api, state } = server(
      localModel({ areaOptions: [{ key: "aran", name: "Arán" }], areaRequired: true }),
    );
    const el = await mount(api);
    state.writes.push({ reject: refusal });
    await chooseOption(field(el, "holidayArea")!, "aran");
    await settle(el);
    expect(field(el, "holidayArea")!.error).toBe(sentence);
    expect(field(el, "holidayArea")!.disabled).toBe(false);
  });

  it("tells a read-only viewer when no area has been chosen", async () => {
    const { api } = server(
      localModel({ areaOptions: [{ key: "aran", name: "Arán" }], areaRequired: true }),
    );
    const el = await mount(api, true);
    expect(text(part(el, "area-chosen"))).toBe("Holiday area: not chosen");
  });

  it("offers no area choice where the annex needs none", async () => {
    const { api } = server();
    const el = await mount(api);
    expect(field(el, "holidayArea")).toBeNull();
    expect(part(el, "area-note")).toBeNull();
  });
});

describe("Local holidays: reading", () => {
  it("reads passively, keeps an action's failure through a failed and a recovered read, and stops reading once gone", async () => {
    const liveData = new LiveData();
    const { api, state, request, calls } = server(localModel(), liveData);
    const el = await mount(api);
    await menuAction(el, "edit-local");
    await setField(el, "holidayName", "San Fernando Rey");
    state.writes.push({ reject: { code: "connection.failed" } });
    await click(el, saveButton(el));
    expect(await bottomMessage(el)).toBe("The change could not be saved.");

    state.reads.push({ reject: { code: "connection.failed" } });
    liveData.invalidate([{ type: "local_holidays" }]);
    await vi.waitFor(() =>
      expect(text(part(el, "local-alert"))).toBe("Local holidays could not be loaded."),
    );
    expect(await bottomMessage(el)).toBe("The change could not be saved.");
    liveData.invalidate([{ type: "holiday_geographies" }]);
    await vi.waitFor(() => expect(part(el, "local-alert")).toBeNull());
    expect(await bottomMessage(el)).toBe("The change could not be saved.");

    const reads = request.mock.calls.filter((call) => call[1] === "GET");
    expect(reads.every((call) => call[3]?.passive === true)).toBe(true);
    expect(calls("PUT")).toHaveLength(1);
    expect(calls("POST")).toEqual([]);

    const before = calls("GET").length;
    el.remove();
    liveData.invalidate([{ type: "local_holidays" }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls("GET").length).toBe(before);
  });

  it("says when it is still reading", async () => {
    const { api, state } = server();
    state.reads.push(new Promise(() => {}));
    const el = await mount(api);
    expect(text(part(el, "local-loading"))).toBe("Loading local holidays…");
  });
});
