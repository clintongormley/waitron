import { TABLE_CUSTOMISATION_STRINGS } from "@waitron/dashboard-kit/src/strings.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { applyTokens, type WtDataTable } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { painterModel } from "../testing/season-painter-fixture.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import "./seasons-screen.js";

let screen: HTMLElementTagNameMap["dashboard-seasons-screen"];
beforeEach(() => {
  setLocale("en");
  history.replaceState({}, "", "/seasons");
});
afterEach(() => screen?.remove());
async function mount(
  request: DashboardRequest = (async () => painterModel()) as DashboardRequest,
  readOnly = false,
) {
  screen = document.createElement("dashboard-seasons-screen");
  screen.api = new OpeningHoursApi(request);
  screen.readOnly = readOnly;
  applyTokens(screen);
  document.body.append(screen);
  await expect
    .poll(() => screen.shadowRoot!.querySelector("wt-data-table, seasons-window"))
    .not.toBeNull();
  const table = screen.shadowRoot!.querySelector<WtDataTable>("wt-data-table")!;
  if (table) await table.updateComplete;
  return table;
}
it("lists seasons in January-first order with dates and Edit/Delete row menus", async () => {
  const table = await mount();
  expect(table.rows.map((row) => (row as { name: string }).name)).toEqual(["Winter", "Spring"]);
  expect(table.columns.map((c) => c.key)).toEqual(["name", "startsOn", "runsUntil", "actions"]);
  expect(table.columns.at(-1)!.pinned).toBe("end");
  expect(
    [...table.shadowRoot!.querySelectorAll('[role="img"]')].map((swatch) => [
      swatch.getAttribute("aria-label"),
      swatch.getAttribute("title"),
    ]),
  ).toEqual([
    ["Blue", "Blue"],
    ["Green", "Green"],
  ]);
  expect(screen.shadowRoot!.querySelector("[data-test=save-seasons]")).toBeNull();
  expect(table.shadowRoot!.querySelectorAll("wt-row-actions")).toHaveLength(2);
  table.shadowRoot!.querySelector<HTMLElement>("button.row-activate")!.click();
  await expect.poll(() => location.pathname).toBe("/seasons/season/winter");
  await expect.poll(() => screen.shadowRoot!.querySelector("seasons-window")).not.toBeNull();
  expect(screen.shadowRoot!.querySelector("h1")!.textContent!.trim()).toBe("Winter");
  expect(screen.shadowRoot!.querySelector("nav[aria-label] a.parent")).not.toBeNull();
});

it("Delete reads lost hours and confirms only that season under the opening revision", async () => {
  const writes: unknown[] = [];
  const table = await mount((async (path, method, body) => {
    if (path.endsWith("/delete-impact")) return { departments: [{ id: "d1", name: "Restaurant" }] };
    if (method !== "GET") {
      writes.push(body);
      return painterModel().seasons;
    }
    return painterModel();
  }) as DashboardRequest);
  table
    .shadowRoot!.querySelector<HTMLElement>('tr[data-row-key="spring"] [data-test=delete-season]')!
    .click();
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=delete-impact]")?.textContent)
    .toContain("Restaurant");
  expect(screen.shadowRoot!.querySelector("[data-test=delete-impact]")!.textContent).toContain(
    "Winter",
  );
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
  await expect
    .poll(() => writes)
    .toEqual([{ save: [], delete: ["spring"], expectedClockRevision: 4 }]);
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
});

it("leaves keyboard focus on Add after a confirmed deletion refreshes the list", async () => {
  const data = painterModel();
  const table = await mount((async (path, method) => {
    if (path.endsWith("/delete-impact")) return { departments: [] };
    if (method !== "GET") {
      data.seasons = data.seasons.filter((row) => row.id !== "winter");
      return data.seasons;
    }
    return data;
  }) as DashboardRequest);
  const menu = table.shadowRoot!.querySelector("wt-row-actions")!;
  await menu.updateComplete;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await userEvent.click(menu.querySelector<HTMLElement>("[data-test=delete-season]")!);
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=confirm-delete]"))
    .not.toBeNull();
  await userEvent.click(
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!,
  );
  await expect.poll(() => table.rows).toHaveLength(1);
  const add = screen.shadowRoot!.querySelector<HTMLElement>("[data-test=add-season]")!;
  await expect.poll(() => screen.shadowRoot!.activeElement).toBe(add);
  expect(add.shadowRoot!.activeElement).toBe(add.shadowRoot!.querySelector("button"));
});

it.each(["new", "winter", "missing"])(
  "opens the addressed season or cleans an unknown address (%s)",
  async (id) => {
    history.replaceState(
      {},
      "",
      id === "new" ? "/seasons/view/new?keep=yes" : `/seasons/season/${id}?keep=yes`,
    );
    await mount();
    if (id === "missing") {
      await expect.poll(() => location.pathname).toBe("/seasons");
      expect(screen.shadowRoot!.querySelector("seasons-window")).toBeNull();
    } else
      expect(screen.shadowRoot!.querySelector("seasons-window")!.seasonId).toBe(
        id === "new" ? "" : id,
      );
    expect(location.search).toBe("?keep=yes");
  },
);
it("a viewer has no actions and its direct season edit address returns to the list", async () => {
  history.replaceState({}, "", "/seasons/season/winter");
  const table = await mount(undefined, true);
  expect(location.pathname).toBe("/seasons");
  expect(table.columns.some((c) => c.key === "actions")).toBe(false);
  expect(screen.shadowRoot!.querySelector("[data-test=add-season]")).toBeNull();
});

it("the only season cannot be deleted", async () => {
  const data = painterModel();
  data.seasons = data.seasons.slice(0, 1);
  const table = await mount((async () => data) as DashboardRequest);
  expect(
    table.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=delete-season]",
    )!.disabled,
  ).toBe(true);
});
it.each([
  [
    { code: "hours.clock_changed" },
    "The business-day start changed. Check what deleting it changes, then delete it again.",
  ],
  [{ code: "season.invalid", params: { reason: "last" } }, "A venue keeps at least one season."],
  [{ code: "network.unavailable" }, "The change could not be saved."],
])(
  "a delete refusal keeps the named confirmation and permits retry (%j)",
  async (refusal, message) => {
    let writes = 0;
    const table = await mount((async (path, method) => {
      if (path.endsWith("/delete-impact")) throw new Error("offline");
      if (method !== "GET") {
        writes++;
        throw refusal;
      }
      return painterModel();
    }) as DashboardRequest);
    table.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-season]")!.click();
    await expect
      .poll(() => screen.shadowRoot!.querySelector("[data-test=delete-impact]")?.textContent)
      .toContain("Which departments lose hours could not be read.");
    const confirm = () =>
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
        "[data-test=confirm-delete]",
      )!;
    confirm().click();
    await expect
      .poll(() => screen.shadowRoot!.querySelector("wt-form-actions")?.error)
      .toBe(message);
    expect(confirm().disabled).toBe(false);
    confirm().click();
    await expect.poll(() => writes).toBe(2);
  },
);

it.each(["Save", "Cancel"])(
  "%s replaces the selected-season address with its list",
  async (action) => {
    history.replaceState({}, "", "/seasons/season/winter");
    const writes: unknown[] = [];
    await mount((async (_path, method, body) => {
      if (method !== "GET") writes.push(body);
      return method === "GET" ? painterModel() : painterModel().seasons;
    }) as DashboardRequest);
    const editor = screen.shadowRoot!.querySelector("seasons-window")!;
    await editor.updateComplete;
    const replace = vi.spyOn(history, "replaceState");
    const push = vi.spyOn(history, "pushState");
    try {
      if (action === "Save") {
        editor.shadowRoot!.querySelector("wt-input")!.dispatchEvent(
          new CustomEvent("wt-change", {
            detail: { value: "Deep winter" },
            bubbles: true,
            composed: true,
          }),
        );
        await editor.updateComplete;
        editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-seasons]")!.click();
      } else await editor.requestClose();
      await expect.poll(() => screen.shadowRoot!.querySelector("seasons-window")).toBeNull();
      expect(location.pathname).toBe("/seasons");
      expect(replace).toHaveBeenCalledTimes(1);
      expect(push).not.toHaveBeenCalled();
      expect(writes).toEqual(
        action === "Save"
          ? [
              {
                save: [{ id: "winter", name: "Deep winter", startsOn: "12-01", colour: "blue" }],
                delete: [],
                expectedClockRevision: 4,
              },
            ]
          : [],
      );
    } finally {
      replace.mockRestore();
      push.mockRestore();
    }
  },
);

it("returns an open season page to the list when it becomes view-only", async () => {
  history.replaceState({}, "", "/seasons/season/winter");
  await mount();
  screen.readOnly = true;
  await screen.updateComplete;
  await expect.poll(() => location.pathname).toBe("/seasons");
  expect(screen.shadowRoot!.querySelector("seasons-window")).toBeNull();
});
it("keeps a missing selected season marked with a useful heading until leaving", async () => {
  let data = { ...painterModel(), departments: [] };
  history.replaceState({}, "", "/seasons/season/winter");
  await mount((async () => structuredClone(data)) as DashboardRequest);
  data = {
    ...data,
    seasons: data.seasons.filter((s) => s.id !== "winter"),
    currentSeasonId: "spring",
  };
  screen.api.rereadWatches();
  const editor = screen.shadowRoot!.querySelector("seasons-window")!;
  await expect
    .poll(() => editor.shadowRoot!.querySelector("wt-input")!.error)
    .toBe("This season no longer exists.");
  expect(screen.shadowRoot!.querySelector("h1")!.textContent!.trim()).toBe(
    "This season no longer exists.",
  );
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save-seasons]",
    )!.disabled,
  ).toBe(true);
});

it.each(["before", "after"])(
  "refreshes a refused Delete when live hours arrive %s its refusal",
  async (update) => {
    let data = painterModel();
    let impacts = 0;
    const revisions: number[] = [];
    const table = await mount((async (path, method, body) => {
      if (path.endsWith("/delete-impact")) {
        impacts++;
        return { departments: [{ id: "d1", name: impacts === 1 ? "Restaurant" : "Terrace" }] };
      }
      if (method !== "GET") {
        const revision = (body as { expectedClockRevision: number }).expectedClockRevision;
        revisions.push(revision);
        if (revision !== data.clockRevision) throw { code: "hours.clock_changed" };
        return data.seasons;
      }
      return structuredClone(data);
    }) as DashboardRequest);
    table
      .shadowRoot!.querySelector<HTMLElement>('[data-row-key="spring"] [data-test=delete-season]')!
      .click();
    await expect
      .poll(() => screen.shadowRoot!.querySelector("[data-test=delete-impact]")?.textContent)
      .toContain("Restaurant");
    data = {
      ...data,
      clockRevision: 5,
      seasons: data.seasons.map((s) => (s.id === "winter" ? { ...s, name: "New winter" } : s)),
    };
    if (update === "before") {
      screen.api.rereadWatches();
      await expect.poll(() => (table.rows[0] as { name: string }).name).toBe("New winter");
    }
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await expect
      .poll(() => screen.shadowRoot!.querySelector("wt-form-actions")?.error)
      .not.toBe("");
    await expect
      .poll(() => screen.shadowRoot!.querySelector("[data-test=delete-impact]")?.textContent)
      .toContain("Terrace");
    const impactText = screen.shadowRoot!.querySelector("[data-test=delete-impact]")!.textContent;
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await expect.poll(() => revisions).toEqual([4, 5]);
    expect(impacts).toBe(2);
    expect(impactText).toContain("Terrace");
    expect(impactText).toContain("New winter");
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  },
);

it("keeps Cancel available while refreshing a clock-refused deletion's lost hours", async () => {
  let reads = 0;
  let finish!: (value: { departments: [] }) => void;
  const pending = new Promise<{ departments: [] }>((resolve) => {
    finish = resolve;
  });
  const table = await mount((async (path, method) => {
    if (path.endsWith("/delete-impact")) return ++reads === 1 ? { departments: [] } : pending;
    if (method !== "GET") throw { code: "hours.clock_changed" };
    return painterModel();
  }) as DashboardRequest);
  try {
    table.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-season]")!.click();
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await expect.poll(() => reads).toBe(2);
    const cancel = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      'wt-button[slot="cancel"]',
    )!;
    await expect.poll(() => cancel.disabled).toBe(false);
    const modal = screen.shadowRoot!.querySelector("wt-modal")!;
    const closed = new Promise<void>((done) =>
      modal.addEventListener("wt-close", () => done(), { once: true }),
    );
    cancel.click();
    await closed;
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  } finally {
    finish({ departments: [] });
  }
});

it("keeps a delete's opening revision through a live update and takes a new one after Cancel", async () => {
  let data = painterModel();
  const revisions: number[] = [];
  const table = await mount((async (path, method, body) => {
    if (path.endsWith("/delete-impact")) return { departments: [] };
    if (method !== "GET") {
      revisions.push((body as { expectedClockRevision: number }).expectedClockRevision);
      throw { code: "hours.clock_changed" };
    }
    return structuredClone(data);
  }) as DashboardRequest);
  const ask = () =>
    table
      .shadowRoot!.querySelector<HTMLElement>('[data-row-key="spring"] [data-test=delete-season]')!
      .click();
  ask();
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
  data = {
    ...data,
    clockRevision: 9,
    seasons: data.seasons.map((s) => (s.id === "winter" ? { ...s, name: "New winter" } : s)),
  };
  screen.api.rereadWatches();
  await expect.poll(() => (table.rows[0] as { name: string }).name).toBe("New winter");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
  await expect.poll(() => revisions).toEqual([4]);
  await expect
    .poll(
      () =>
        screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
          "[data-test=confirm-delete]",
        )!.loading,
    )
    .toBe(false);
  const modal = screen.shadowRoot!.querySelector("wt-modal")!;
  const closed = new Promise<void>((done) =>
    modal.addEventListener("wt-close", () => done(), { once: true }),
  );
  await modal.requestClose("cancel");
  await closed;
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  ask();
  await screen.updateComplete;
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
  await expect.poll(() => revisions).toEqual([4, 9]);
});

it("offers localized remembered column choices for waitron.seasons.table", async () => {
  setLocale("es-ES");
  localStorage.setItem("waitron.seasons.table:columns", '{"startsOn":false}');
  try {
    const table = await mount();
    const root = table.shadowRoot!;
    const chooser = root.querySelector<HTMLElement>(".columns-trigger");
    expect(chooser?.getAttribute("aria-label")).toBe(
      TABLE_CUSTOMISATION_STRINGS.es["table.customise_columns"],
    );
    await userEvent.click(chooser!);
    expect(root.querySelector('input[data-column="startsOn"]')).toHaveProperty("checked", false);
    expect(root.querySelector("wt-dialog")).toHaveProperty(
      "heading",
      TABLE_CUSTOMISATION_STRINGS.es["table.customise"],
    );
  } finally {
    localStorage.removeItem("waitron.seasons.table:columns");
    setLocale("en");
  }
});
