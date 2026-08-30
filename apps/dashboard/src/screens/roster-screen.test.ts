import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "@vitest/browser/context";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, PersonSummary, RosterSnapshot } from "../api/client.js";
import { RosterScreen } from "./roster-screen.js";

const staff: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ana",
    role: "staff",
    status: "active",
    hasPassword: false,
    hasTotp: false,
    email: null,
  },
  {
    personId: "p2",
    displayName: "Beto",
    role: "staff",
    status: "active",
    hasPassword: false,
    hasTotp: false,
    email: null,
  },
];
const locations = [{ id: "loc-1", name: "Main" }];
const emptySnapshot: RosterSnapshot = { version: null, shifts: [] };

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getLocations: vi.fn().mockResolvedValue(locations),
    listStaff: vi.fn().mockResolvedValue(staff),
    getRoster: vi.fn().mockResolvedValue(emptySnapshot),
    createRosterVersion: vi.fn().mockResolvedValue({ versionId: "v1" }),
    addShift: vi.fn().mockResolvedValue({ shiftId: "s1" }),
    updateShift: vi.fn().mockResolvedValue(undefined),
    removeShift: vi.fn().mockResolvedValue(undefined),
    publishRoster: vi.fn().mockResolvedValue({ breaches: [] }),
    ...overrides,
  } as unknown as DashboardApi;
}
async function flush(el: RosterScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
function emit(source: Element, type: string, detail: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}
const dialog = (el: RosterScreen) => el.shadowRoot!.querySelector("dashboard-shift-dialog")!;
const draftSnapshot = (): RosterSnapshot => ({
  version: {
    id: "v1",
    locationId: "loc-1",
    periodStart: "2026-03-02",
    periodEnd: "2026-03-08",
    status: "draft",
    publishedAt: null,
    publishedByPersonId: null,
  },
  shifts: [],
});
afterEach(cleanupWidgets);

describe("roster-screen", () => {
  it("loads locations, staff and the roster on connect and renders a row per staff member", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    expect(api.getLocations).toHaveBeenCalledTimes(1);
    expect(api.listStaff).toHaveBeenCalledTimes(1);
    expect(api.getRoster).toHaveBeenCalledWith(
      "loc-1",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(el.shadowRoot!.querySelectorAll("[data-test^=row-]")).toHaveLength(2);
  });

  it("creates a draft on the first add-shift, then adds the shift with the selected location", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    // Open a cell (person p1, the week's first day) and emit add-shift from the dialog.
    (el as unknown as { openCell(personId: string, day: string, shift: null): void }).openCell(
      "p1",
      "2026-03-02",
      null,
    );
    await el.updateComplete;
    emit(dialog(el), "add-shift", {
      personId: "p1",
      startsAt: "2026-03-02T09:00:00Z",
      startsOffsetMinutes: 0,
      endsAt: "2026-03-02T13:00:00Z",
      endsOffsetMinutes: 0,
      role: null,
    });
    await flush(el);
    expect(api.createRosterVersion).toHaveBeenCalledWith("loc-1", expect.any(String));
    expect(api.addShift).toHaveBeenCalledWith(
      "v1",
      expect.objectContaining({ personId: "p1", locationId: "loc-1" }),
    );
    expect(api.getRoster).toHaveBeenCalledTimes(2); // reloaded after the add
  });

  it("publishes and renders the returned breaches as an advisory banner (publish still succeeds)", async () => {
    const api = stubApi({
      getRoster: vi.fn().mockResolvedValue(draftSnapshot()),
      publishRoster: vi.fn().mockResolvedValue({
        breaches: [{ kind: "night_work", personId: "p1", shiftId: "s1", nightMinutes: 120 }],
      }),
    });
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=publish]")!.click();
    await flush(el);
    expect(api.publishRoster).toHaveBeenCalledWith("v1");
    const banner = el.shadowRoot!.querySelector("[data-test=breaches]");
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain("nocturno"); // breachKindName(night_work, es)
  });

  it("clears the advisory-breach banner when the roster context changes (week/location)", async () => {
    // Regression: `breaches` was set on publish and never cleared, so navigating to another week or
    // location kept showing the PRIOR roster's warnings against an unrelated week.
    const api = stubApi({
      getLocations: vi.fn().mockResolvedValue([
        { id: "loc-1", name: "Main" },
        { id: "loc-2", name: "Annex" },
      ]),
      getRoster: vi.fn().mockResolvedValue(draftSnapshot()),
      publishRoster: vi.fn().mockResolvedValue({
        breaches: [{ kind: "night_work", personId: "p1", shiftId: "s1", nightMinutes: 120 }],
      }),
    });
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);

    // Publish → the advisory banner shows.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=publish]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=breaches]")).not.toBeNull();

    // Changing the week must drop the prior roster's warnings.
    const week = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=week-picker]")!;
    week.value = "2026-04-08";
    week.dispatchEvent(new Event("change"));
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=breaches]")).toBeNull();

    // Publish again, then switch location — same: the banner clears.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=publish]")!.click();
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=breaches]")).not.toBeNull();
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=location-select]")!;
    select.value = "loc-2";
    select.dispatchEvent(new Event("change"));
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=breaches]")).toBeNull();
  });

  it("ignores a cleared week input (value '') — no crash, week unchanged, no reload", async () => {
    // Regression: a native <input type="date"> can be CLEARED (value ""). mondayOf("") builds an
    // Invalid Date and throws a RangeError on toISOString(), which #onSelectWeek did not guard, so the
    // handler rejected (an unhandled rejection) and left the screen broken.
    const api = stubApi();
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    const before = (el as unknown as { weekMonday: string }).weekMonday;
    const loadsBefore = (api.getRoster as ReturnType<typeof vi.fn>).mock.calls.length;

    const rejections: unknown[] = [];
    const onReject = (e: PromiseRejectionEvent): void => {
      e.preventDefault();
      rejections.push(e.reason);
    };
    window.addEventListener("unhandledrejection", onReject);
    try {
      const week = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=week-picker]")!;
      week.value = "";
      week.dispatchEvent(new Event("change"));
      await flush(el);
      await flush(el);
    } finally {
      window.removeEventListener("unhandledrejection", onReject);
    }

    expect(rejections).toEqual([]);
    expect((el as unknown as { weekMonday: string }).weekMonday).toBe(before);
    // The ignored change fires no reload.
    expect((api.getRoster as ReturnType<typeof vi.fn>).mock.calls.length).toBe(loadsBefore);
  });

  it("shows the error banner and does not crash when a load rejects", async () => {
    const api = stubApi({ getRoster: vi.fn().mockRejectedValue({ code: "convenio.not_found" }) });
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("convenio.not_found");
  });

  it("files at most one create when add-shift fires twice (single-flight)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    (el as unknown as { openCell(p: string, d: string, shift: null): void }).openCell(
      "p1",
      "2026-03-02",
      null,
    );
    await el.updateComplete;
    const detail = {
      personId: "p1",
      startsAt: "2026-03-02T09:00:00Z",
      startsOffsetMinutes: 0,
      endsAt: "2026-03-02T13:00:00Z",
      endsOffsetMinutes: 0,
      role: null,
    };
    emit(dialog(el), "add-shift", detail);
    emit(dialog(el), "add-shift", detail);
    await flush(el);
    expect(api.addShift).toHaveBeenCalledTimes(1);
  });

  // ── Coverage of the remaining handlers/branches ────────────────────────────────────────────────

  it("clicking a cell opens the dialog for that person + day (editable week)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    // The grid renders the current week; pick the first cell in p1's row rather than a hardcoded date.
    const cell = el.shadowRoot!.querySelector<HTMLElement>("[data-test^=cell-p1-]")!;
    cell.click();
    await el.updateComplete;
    expect((dialog(el) as unknown as { open: boolean }).open).toBe(true);
  });

  it("renders each editable grid cell's affordance as a real, labelled <button>", async () => {
    // Keyboard-accessibility: the cell must expose a real button (focusable + Enter/Space activatable),
    // not a bare clickable <td>. An empty cell's button carries an accessible name so assistive tech
    // announces it (axe did not catch the bare-<td> version).
    const api = stubApi();
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    const cell = el.shadowRoot!.querySelector<HTMLButtonElement>("[data-test^=cell-p1-]")!;
    expect(cell.tagName).toBe("BUTTON");
    // Empty cell → an accessible name from aria-label ("Nuevo turno" in the default es locale).
    expect(cell.getAttribute("aria-label")).toBe("Nuevo turno");
  });

  it("opens the dialog when a grid cell button is activated by keyboard (Enter)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    const cell = el.shadowRoot!.querySelector<HTMLButtonElement>("[data-test^=cell-p1-]")!;
    cell.focus();
    await userEvent.keyboard("{Enter}");
    await el.updateComplete;
    expect((dialog(el) as unknown as { open: boolean }).open).toBe(true);
  });

  it("authors a SECOND shift on a populated cell (split shift) — edits the existing one AND adds another", async () => {
    // The slice-2 fix: a populated cell must offer BOTH an edit of its existing shift AND an add of a
    // second one. Before the fix `openCell`'s `.find` always re-opened the FIRST shift in edit mode, so
    // a jornada partida could not be authored.
    const snap: RosterSnapshot = {
      version: draftSnapshot().version,
      shifts: [
        {
          id: "s1",
          personId: "p1",
          locationId: "loc-1",
          startsAt: "2026-03-02T09:00:00Z",
          startsOffsetMinutes: 0,
          endsAt: "2026-03-02T13:00:00Z",
          endsOffsetMinutes: 0,
          role: "bar",
          rosterVersionId: "v1",
        },
      ],
    };
    const api = stubApi({ getRoster: vi.fn().mockResolvedValue(snap) });
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    // The grid defaults to the current week; the fixture shift lives in the week of Mon 2026-03-02,
    // so navigate there (the stub returns `snap` for any week) before the March cell is rendered.
    const week = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=week-picker]")!;
    week.value = "2026-03-02";
    week.dispatchEvent(new Event("change"));
    await flush(el);
    const editBtn = el.shadowRoot!.querySelector<HTMLButtonElement>("[data-test=edit-s1]")!;
    const addBtn = el.shadowRoot!.querySelector<HTMLButtonElement>(
      "[data-test=cell-p1-2026-03-02]",
    )!;
    expect(editBtn).not.toBeNull();
    expect(addBtn).not.toBeNull();
    // Editing opens the dialog on the existing shift.
    editBtn.click();
    await el.updateComplete;
    expect((dialog(el) as unknown as { shift: { id: string } | null }).shift).toMatchObject({
      id: "s1",
    });
    // The add button opens the dialog for a NEW (null) shift on the same person + day.
    addBtn.click();
    await el.updateComplete;
    expect((dialog(el) as unknown as { shift: unknown }).shift).toBeNull();
    expect((dialog(el) as unknown as { personId: string }).personId).toBe("p1");
  });

  it("edits an existing shift via update-shift and reloads", async () => {
    const snap: RosterSnapshot = {
      version: draftSnapshot().version,
      shifts: [
        {
          id: "s1",
          personId: "p1",
          locationId: "loc-1",
          startsAt: "2026-03-02T09:00:00Z",
          startsOffsetMinutes: 0,
          endsAt: "2026-03-02T13:00:00Z",
          endsOffsetMinutes: 0,
          role: "bar",
          rosterVersionId: "v1",
        },
      ],
    };
    const api = stubApi({ getRoster: vi.fn().mockResolvedValue(snap) });
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    emit(dialog(el), "update-shift", { shiftId: "s1", patch: { role: "kitchen" } });
    await flush(el);
    expect(api.updateShift).toHaveBeenCalledWith("s1", { role: "kitchen" });
    expect(api.getRoster).toHaveBeenCalledTimes(2);
  });

  it("removes a shift via remove-shift and reloads", async () => {
    const api = stubApi();
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    emit(dialog(el), "remove-shift", { shiftId: "s1" });
    await flush(el);
    expect(api.removeShift).toHaveBeenCalledWith("s1");
    expect(api.getRoster).toHaveBeenCalledTimes(2);
  });

  it("switching location and week reloads the roster", async () => {
    const api = stubApi({
      getLocations: vi.fn().mockResolvedValue([
        { id: "loc-1", name: "Main" },
        { id: "loc-2", name: "Annex" },
      ]),
    });
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=location-select]")!;
    select.value = "loc-2";
    select.dispatchEvent(new Event("change"));
    await flush(el);
    expect(api.getRoster).toHaveBeenLastCalledWith("loc-2", expect.any(String));
    const week = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=week-picker]")!;
    week.value = "2026-04-08"; // a Wednesday — snaps to Monday 2026-04-06
    week.dispatchEvent(new Event("change"));
    await flush(el);
    expect(api.getRoster).toHaveBeenLastCalledWith("loc-2", "2026-04-06");
  });

  it("shows the no-location prompt when the tenant has no locations", async () => {
    const api = stubApi({ getLocations: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=no-location]")).not.toBeNull();
    expect(api.getRoster).not.toHaveBeenCalled();
  });

  it("shows the published-readonly note and no publish button for a published week", async () => {
    const published: RosterSnapshot = {
      version: {
        id: "v1",
        locationId: "loc-1",
        periodStart: "2026-03-02",
        periodEnd: "2026-03-08",
        status: "published",
        publishedAt: "2026-03-01T10:00:00Z",
        publishedByPersonId: "p9",
      },
      shifts: [],
    };
    const api = stubApi({ getRoster: vi.fn().mockResolvedValue(published) });
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=readonly]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=publish]")).toBeNull();
    // A cell click on a published week does nothing (not editable).
    const cell = el.shadowRoot!.querySelector<HTMLElement>("[data-test^=cell-p1-]")!;
    cell.click();
    await el.updateComplete;
    expect((dialog(el) as unknown as { open: boolean }).open).toBe(false);
  });

  it("surfaces an add-shift rejection as the error banner (single-flight releases)", async () => {
    const api = stubApi({ addShift: vi.fn().mockRejectedValue({ code: "shift.invalid" }) });
    const { el } = await mountWidget<RosterScreen>("dashboard-roster-screen", { api });
    await flush(el);
    (el as unknown as { openCell(p: string, d: string, shift: null): void }).openCell(
      "p1",
      "2026-03-02",
      null,
    );
    await el.updateComplete;
    emit(dialog(el), "add-shift", {
      personId: "p1",
      startsAt: "2026-03-02T09:00:00Z",
      startsOffsetMinutes: 0,
      endsAt: "2026-03-02T08:00:00Z",
      endsOffsetMinutes: 0,
      role: null,
    });
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("shift.invalid");
    expect((el as unknown as { busy: boolean }).busy).toBe(false);
  });
});
