import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import { rotaWeek } from "../testing/rota-fixture.js";
import type { RotaWeek } from "../staffing-types.js";
import type { StaffingApi } from "./client.js";
import "./rota-view.js";
type Editor = LitElement & {
  open: boolean;
  api: StaffingApi;
  week: RotaWeek;
  shiftId?: string;
  businessDay: string;
  personId: string;
  area: string;
  staffRoleId: string;
};
let el: Editor;
beforeEach(() => setLocale("en"));
afterEach(() => {
  el?.remove();
  setLocale("en");
});
async function mount(existing = true, swaps = false) {
  el = document.createElement("rota-shift-dialog") as Editor;
  el.week = rotaWeek();
  if (swaps) el.week.openSwaps = [{ swapId: "swap", fromShiftId: "filled", toShiftId: null }];
  el.open = true;
  el.shiftId = existing ? "filled" : undefined;
  el.businessDay = "2026-12-04";
  el.personId = "ana";
  const api = {
    addRotaShift: vi.fn(async () => ({ shiftId: "new" })),
    updateRotaShift: vi.fn(async () => undefined),
    removeRotaShift: vi.fn(async () => undefined),
  };
  el.api = api as unknown as StaffingApi;
  document.body.append(el);
  applyTokens(el);
  await el.updateComplete;
  expect(el.shadowRoot?.querySelector("[name=personId]")).toBeTruthy();
  return api;
}
const field = (name: string) =>
  el.shadowRoot!.querySelector<HTMLElement & { value: string; error: string; required: boolean }>(
    `[name=${name}]`,
  )!;
const button = (name: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test=${name}]`)!;
async function change(name: string, value: string) {
  field(name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
it("marks each required field, opens Save quiet, enables on edits and quiets on undo", async () => {
  const api = await mount();
  for (const name of ["personId", "area", "staffRoleId", "startsAt", "endsAt"])
    expect(field(name).required).toBe(true);
  expect(button("save").disabled).toBe(true);
  expect(button("save").variant).toBe("secondary");
  button("save").click();
  await el.updateComplete;
  expect(api.updateRotaShift).not.toHaveBeenCalled();
  await change("endsAt", "18:00");
  expect(button("save").disabled).toBe(false);
  expect(button("save").variant).toBe("primary");
  await change("endsAt", "17:00");
  expect(button("save").disabled).toBe(true);
});
it("a new shift opened from a cell starts with its area and staff role", async () => {
  const api = await mount(false);
  el.open = false;
  el.personId = "";
  await el.updateComplete;
  el.area = "station:kitchen";
  el.staffRoleId = "sous";
  el.open = true;
  await el.updateComplete;
  expect(field("personId").value).toBe("");
  expect(field("area").value).toBe("station:kitchen");
  expect(field("staffRoleId").value).toBe("sous");
  await change("personId", "laia");
  await change("startsAt", "09:00");
  await change("endsAt", "17:00");
  button("save").click();
  await vi.waitFor(() => expect(el.open).toBe(false));
  expect(api.addRotaShift).toHaveBeenCalledWith({
    week: "2026-11-30",
    businessDay: "2026-12-04",
    personId: "laia",
    area: { kind: "station", id: "kitchen" },
    staffRoleId: "sous",
    startsAt: "09:00",
    endsAt: "17:00",
  });
});
it("a second cell's editor on the same day starts afresh with its own staff role", async () => {
  await mount(false);
  el.personId = "";
  el.area = "station:kitchen";
  el.staffRoleId = "sous";
  await el.updateComplete;
  await change("startsAt", "10:00");
  expect(field("startsAt").value).toBe("10:00");
  el.staffRoleId = "head";
  await el.updateComplete;
  expect(field("staffRoleId").value).toBe("head");
  expect(field("startsAt").value).toBe("");
  el.area = "department:restaurant";
  await el.updateComplete;
  expect(field("area").value).toBe("department:restaurant");
});
it("assigns an unlinked shift through a patch and closes after writing", async () => {
  const api = await mount();
  el.shiftId = "unlinked";
  await el.updateComplete;
  expect(field("area").value).toBe("");
  await change("area", "station:kitchen");
  await change("staffRoleId", "sous");
  button("save").click();
  await vi.waitFor(() => expect(el.open).toBe(false));
  expect(api.updateRotaShift).toHaveBeenCalledWith("unlinked", {
    personId: "ana",
    area: { kind: "station", id: "kitchen" },
    staffRoleId: "sous",
    startsAt: "09:00",
    endsAt: "17:00",
  });
});
it("marks missing fields after an invalid attempt, then lets a server refusal retry without another edit", async () => {
  const api = await mount(false);
  await change("startsAt", "09:00");
  button("save").click();
  await el.updateComplete;
  expect(field("area").error).toBeTruthy();
  expect(field("staffRoleId").error).toBeTruthy();
  expect(field("endsAt").error).toBeTruthy();
  expect(button("save").disabled).toBe(true);
  await change("area", "station:kitchen");
  await change("staffRoleId", "sous");
  await change("endsAt", "17:00");
  api.addRotaShift.mockRejectedValueOnce({
    code: "staffing.invalid",
    params: { field: "startsAt" },
  });
  button("save").click();
  await vi.waitFor(() => expect(field("startsAt").error).toBeTruthy());
  expect(button("save").disabled).toBe(false);
  expect(
    (el.shadowRoot!.querySelector("wt-form-actions")! as HTMLElement & { error: string }).error,
  ).toBe("Correct the highlighted fields to continue.");
  button("save").click();
  await vi.waitFor(() => expect(el.open).toBe(false));
  expect(api.addRotaShift).toHaveBeenCalledTimes(2);
});
it("asks before deletion and before changing an open swap's person or time", async () => {
  const api = await mount(true, true);
  await change("endsAt", "18:00");
  button("save").click();
  await el.updateComplete;
  expect(api.updateRotaShift).not.toHaveBeenCalled();
  expect(el.shadowRoot!.textContent).toContain("request was made for the previous person and time");
  button("confirm").click();
  await vi.waitFor(() => expect(el.open).toBe(false));
  expect(api.updateRotaShift).toHaveBeenCalledTimes(1);
  el.open = true;
  await el.updateComplete;
  button("delete").click();
  await el.updateComplete;
  expect(api.removeRotaShift).not.toHaveBeenCalled();
  expect(el.shadowRoot!.textContent).toContain("cancels requests offering it");
  button("confirm").click();
  await vi.waitFor(() => expect(el.open).toBe(false));
  expect(api.removeRotaShift).toHaveBeenCalledWith("filled");
});

it("marks a removed area rather than throwing when a live snapshot retires its selection", async () => {
  const api = await mount();
  await change("endsAt", "18:00");
  el.week = { ...el.week, areas: [] };
  await el.updateComplete;
  button("save").click();
  await el.updateComplete;
  expect(field("area").error).toBeTruthy();
  expect(api.updateRotaShift).not.toHaveBeenCalled();
});
it("retains a refused delete and allows retry after confirmation", async () => {
  const api = await mount();
  api.removeRotaShift.mockRejectedValueOnce({ code: "connection.failed" });
  button("delete").click();
  await el.updateComplete;
  button("confirm").click();
  await vi.waitFor(() =>
    expect(
      (el.shadowRoot!.querySelector("wt-form-actions")! as HTMLElement & { error: string }).error,
    ).toBeTruthy(),
  );
  expect(el.open).toBe(true);
  button("delete").click();
  await el.updateComplete;
  button("confirm").click();
  await vi.waitFor(() => expect(el.open).toBe(false));
  expect(api.removeRotaShift).toHaveBeenCalledTimes(2);
});

it.each(["personId", "staffRoleId"])("marks a removed %s selection", async (name) => {
  const api = await mount();
  await change("endsAt", "18:00");
  el.week = name === "personId" ? { ...el.week, people: [] } : { ...el.week, staffRoles: [] };
  await el.updateComplete;
  button("save").click();
  await el.updateComplete;
  expect(field(name).error).toBeTruthy();
  expect(api.updateRotaShift).not.toHaveBeenCalled();
});
it.each([
  ["startsAt", "09:07"],
  ["endsAt", "08:00"],
])("refuses invalid business-day time %s=%s", async (name, value) => {
  const api = await mount();
  await change(name!, value!);
  button("save").click();
  await el.updateComplete;
  expect(field(name!).error).toBeTruthy();
  expect(api.updateRotaShift).not.toHaveBeenCalled();
});
it("keeps a shift when deletion is cancelled", async () => {
  const api = await mount();
  button("delete").click();
  await el.updateComplete;
  button("keep").click();
  await el.updateComplete;
  expect(el.open).toBe(true);
  expect(api.removeRotaShift).not.toHaveBeenCalled();
  expect(button("delete").disabled).toBe(false);
});

it("paints Cancel and Delete as visible controls in the actual dialog footer", async () => {
  await mount();
  for (const label of ["Cancel", "Delete"]) {
    const control = [
      ...el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-button"]>("wt-button"),
    ].find((b) => b.textContent!.trim() === label)!;
    await control.updateComplete;
    await vi.waitFor(() =>
      expect(
        control.shadowRoot!.querySelector("button")!.getBoundingClientRect().width,
      ).toBeGreaterThan(0),
    );
  }
});

it.each([
  ["staff_role.not_found", "staffRoleId", { staffRoleId: "head" }],
  ["staffing_area.not_found", "area", { area: "station:kitchen" }],
])("puts %s beside the field its payload names", async (code, name, params) => {
  const api = await mount();
  await change("endsAt", "18:00");
  api.updateRotaShift.mockRejectedValueOnce({ code, params });
  button("save").click();
  await vi.waitFor(() => expect(field(name as string).error).toBeTruthy());
  expect(button("save").disabled).toBe(false);
  expect(
    (el.shadowRoot!.querySelector("wt-form-actions")! as HTMLElement & { error: string }).error,
  ).toBe("Correct the highlighted fields to continue.");
});
