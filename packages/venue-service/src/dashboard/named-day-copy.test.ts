import { afterEach, expect, it } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import "./opening-hours-screen.js";
import { NamedDaysApi } from "./named-days-client.js";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { HoursModel } from "../hours-types.js";
import { clockChangeAfter, minutesAfter } from "../testing/clock-change.js";
import { formatDate } from "./hours-view.js";

type Copy = import("./named-day-copy.js").NamedDayCopy;
let el: Copy;
afterEach(() => {
  el?.remove();
  setLocale("en");
});
async function mount() {
  setLocale("en");
  el = document.createElement("named-day-copy") as Copy;
  el.day = { id: "annual", name: "Anniversary" };
  el.open = true;
  applyTokens(el);
  document.body.append(el);
  expect(customElements.get("named-day-copy"), "copy form registered").toBeDefined();
  await el.updateComplete;
  return el;
}
function save() {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-copy]")!;
}
async function change(value: string, index = 0) {
  el.shadowRoot!.querySelector(`[name='dates.${index}']`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
it("opens with one empty target, quiet Save and no submission even through a retained host click", async () => {
  await mount();
  const events: unknown[] = [];
  el.addEventListener("named-day-copy-save", (e) => events.push((e as CustomEvent).detail));
  expect(el.shadowRoot!.querySelectorAll("wt-input")).toHaveLength(1);
  expect(save().variant).toBe("secondary");
  expect(save().disabled).toBe(true);
  save().click();
  expect(events).toEqual([]);
  await change("2026-10-20");
  expect(save().variant).toBe("primary");
  expect(save().disabled).toBe(false);
  save().click();
  expect(events).toEqual([{ id: "annual", dates: ["2026-10-20"] }]);
  expect(el.commitSubmitted(["2026-10-20"])).toBe(true);
  await el.updateComplete;
  expect(save().disabled).toBe(true);
  save().click();
  expect(events).toEqual([{ id: "annual", dates: ["2026-10-20"] }]);
});
it("marks every invalid or duplicate target, then permits corrections and submits all dates", async () => {
  await mount();
  await change("bad");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-target]")!.click();
  await el.updateComplete;
  save().click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelectorAll("wt-input[required]")).toHaveLength(2);
  for (const input of el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-input"]>(
    "wt-input",
  ))
    expect(input.error).not.toBe("");
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).not.toBe("");
  expect(save().disabled).toBe(true);
  await change("2026-10-20");
  await change("2026-10-20", 1);
  expect(save().disabled).toBe(true);
  await change("2026-10-21", 1);
  expect(save().disabled).toBe(false);
  const events: unknown[] = [];
  el.addEventListener("named-day-copy-save", (e) => events.push((e as CustomEvent).detail));
  save().click();
  expect(events).toEqual([{ id: "annual", dates: ["2026-10-20", "2026-10-21"] }]);
});
it("a server refusal marks its target without disabling retry and preserves the draft", async () => {
  await mount();
  await change("2026-10-20");
  save().click();
  el.refusal = { code: "special_date.date_taken", params: { date: "2026-10-20" } };
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!.error,
  ).not.toBe("");
  expect(save().disabled).toBe(false);
  await change("2026-10-21");
  expect(el.refusal).toBeUndefined();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-target]")!.click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=remove-target-1]")!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelectorAll("wt-input")).toHaveLength(1);
});

function stationModel(): HoursModel {
  return {
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
    civilDate: "2026-10-07",
    clockReadable: true,
    departments: [],
    subjects: [
      { kind: "station", id: "bar", name: "Bar", active: true, isDefault: false },
      { kind: "station", id: "kitchen", name: "Kitchen", active: true, isDefault: true },
    ],
    week: [],
    days: [],
    specialDates: [],
    specialCells: [
      {
        specialDateId: "annual",
        cells: ["bar", "kitchen"].map((id) => ({
          subject: { kind: "station", id },
          cell: {
            mode: "periods",
            periods: [{ id: id + "-period", opensAt: "02:30", closesAt: "03:30" }],
          },
        })),
      },
    ],
    holidayCoverage: [],
    holidaySources: [],
  };
}
it("shows copied station repeated-clock warnings under their target without resetting edited targets on a read", async () => {
  await mount();
  const calls: unknown[][] = [];
  const model = stationModel();
  const back = clockChangeAfter("Europe/Madrid", "2026-10-08T00:00:00Z", "backward");
  const time = minutesAfter(back.after, 30);
  for (const cell of model.specialCells[0]!.cells) cell.cell.periods[0]!.opensAt = time;
  el.day = { ...el.day, date: "2026-10-01", closeWholeVenue: false } as typeof el.day;
  el.api = new NamedDaysApi((async (path, method, body, options) => {
    calls.push([path, method, body, options]);
    return model;
  }) as DashboardRequest);
  await el.updateComplete;
  await change(back.date);
  await expect
    .poll(() =>
      el.shadowRoot!.querySelector("[data-test=duplicate-repeat-note]")?.textContent?.trim(),
    )
    .toBe(
      `Bar on ${formatDate(back.date)}: the clock goes back, so ${time} happens twice. These hours apply both times.`,
    );
  expect(calls).toEqual([
    [
      "/management-api/venue-service/hours?from=2026-10-01&to=2026-10-01",
      "GET",
      undefined,
      { passive: true },
    ],
  ]);
  expect(el.shadowRoot!.querySelectorAll("[data-test=duplicate-repeat-note]")).toHaveLength(1);
  expect(
    el
      .shadowRoot!.querySelector("[data-test=duplicate-repeat-note]")!
      .previousElementSibling!.querySelector("[name='dates.0']"),
  ).not.toBeNull();
  el.api.rereadWatches();
  await expect.poll(() => calls.length).toBe(2);
  expect(el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!.value).toBe(
    back.date,
  );
  await change("bad");
  expect(el.shadowRoot!.querySelector("[data-test=duplicate-repeat-note]")).toBeNull();
});

it("a failed warning read and its recovery preserve target edits and a copy refusal", async () => {
  await mount();
  let fail = true;
  const requests: unknown[] = [];
  el.day = { ...el.day, date: "2026-10-01" };
  el.api = new NamedDaysApi((async () => {
    requests.push(fail);
    if (fail) throw new Error("offline");
    return stationModel();
  }) as DashboardRequest);
  await change("2026-10-25");
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=copy-read-error]"))
    .not.toBeNull();
  el.refusal = { code: "special_date.date_taken", params: { date: "2026-10-25" } };
  await el.updateComplete;
  fail = false;
  el.api.rereadWatches();
  await expect.poll(() => requests.length).toBe(2);
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=copy-read-error]")).toBeNull();
  expect(el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input")!.value).toBe(
    "2026-10-25",
  );
  expect(el.refusal?.code).toBe("special_date.date_taken");
  expect(save().disabled).toBe(false);
});

it("busy copy controls retain the submitted targets and ignore host-level edits, adds, removals and close", async () => {
  await mount();
  await change("2026-10-20");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-target]")!.click();
  await el.updateComplete;
  await change("2026-10-21", 1);
  const events: unknown[] = [];
  el.addEventListener("named-day-copy-save", (event) => events.push((event as CustomEvent).detail));
  save().click();
  el.busy = true;
  await el.updateComplete;
  await change("2026-11-20");
  for (const selector of [
    "[data-test=add-target]",
    "[data-test=remove-target-1]",
    "[slot=cancel]",
    "[data-test=save-copy]",
  ])
    el.shadowRoot!.querySelector<HTMLElement>(selector)!.dispatchEvent(new MouseEvent("click"));
  el.shadowRoot!.querySelector("wt-modal")!.dispatchEvent(new CustomEvent("wt-close"));
  await el.updateComplete;
  expect(el.open).toBe(true);
  expect(
    Array.from(
      el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-input"]>("wt-input"),
      (input) => input.value,
    ),
  ).toEqual(["2026-10-20", "2026-10-21"]);
  expect(events).toEqual([{ id: "annual", dates: ["2026-10-20", "2026-10-21"] }]);
});

it("a replaced copy's retained controls and completion cannot change the new target draft", async () => {
  await mount();
  await change("2026-10-20");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-target]")!.click();
  await el.updateComplete;
  await change("2026-10-21", 1);
  save().click();
  const old = el.shadowRoot!.querySelector("wt-modal")!;
  el.day = { id: "replacement", name: "Replacement" };
  await el.updateComplete;
  await change("2026-11-20");
  old.querySelector("wt-input")!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "2026-12-20" },
      bubbles: true,
      composed: true,
    }),
  );
  for (const selector of [
    "[data-test=add-target]",
    "[data-test=remove-target-1]",
    "[slot=cancel]",
    "[data-test=save-copy]",
  ])
    old.querySelector<HTMLElement>(selector)!.dispatchEvent(new MouseEvent("click"));
  old.dispatchEvent(new CustomEvent("wt-close"));
  await el.updateComplete;
  expect(el.open).toBe(true);
  expect(el.commitSubmitted(["2026-10-20", "2026-10-21"])).toBe(false);
  expect(
    Array.from(
      el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-input"]>("wt-input"),
      (input) => input.value,
    ),
  ).toEqual(["2026-11-20"]);
  expect(save().disabled).toBe(false);
});

it("Enter submits the changed target once and Cancel closes a clean copy", async () => {
  await mount();
  await change("2026-10-20");
  const events: unknown[] = [];
  el.addEventListener("named-day-copy-save", (event) => events.push((event as CustomEvent).detail));
  const field = el.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
  field.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true, cancelable: true }),
  );
  expect(events).toEqual([{ id: "annual", dates: ["2026-10-20"] }]);
  expect(el.commitSubmitted(["2026-10-20"])).toBe(true);
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[slot=cancel]")!.click();
  await expect.poll(() => el.open).toBe(false);
});

it("a field-specific copy refusal marks only its target and correction clears it without losing the other target", async () => {
  await mount();
  await change("2026-10-20");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-target]")!.click();
  await el.updateComplete;
  await change("2026-10-21", 1);
  el.refusal = { code: "hours.invalid", params: { field: "dates.1" } };
  await el.updateComplete;
  const fields = el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-input"]>("wt-input");
  expect(fields[0]!.error).toBe("");
  expect(fields[1]!.error).not.toBe("");
  expect(save().disabled).toBe(false);
  await change("2026-10-22", 1);
  expect(el.refusal).toBeUndefined();
  expect(Array.from(fields, (input) => input.value)).toEqual(["2026-10-20", "2026-10-22"]);
});
