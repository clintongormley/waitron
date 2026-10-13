import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { Shift } from "../api/client.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { ShiftDialog } from "./shift-dialog.js";

const shift: Shift = {
  id: "s1",
  personId: "p1",
  locationId: "loc-1",
  startsAt: "2026-03-02T09:00:00Z",
  startsOffsetMinutes: 0,
  endsAt: "2026-03-02T13:00:00Z",
  endsOffsetMinutes: 0,
  role: "bar",
  rosterVersionId: "v1",
};
const offsetShift: Shift = {
  ...shift,
  id: "s2",
  startsAt: "2027-01-04T07:00:00Z",
  startsOffsetMinutes: 120,
  endsAt: "2027-01-04T15:00:00Z",
  endsOffsetMinutes: 120,
};
const inputValue = (el: ShiftDialog, test: string) =>
  el.shadowRoot!.querySelector<HTMLElement & { value: string }>(`[data-test=${test}]`)!.value;
// wt-input announces edits through a composed `wt-change` CustomEvent (`detail.value`), never a
// host-level native `input` (its internal onInput calls `event.stopPropagation()`).
const setInput = (el: ShiftDialog, test: string, value: string) => {
  const input = el.shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`)!;
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
};
const capture = (el: ShiftDialog, type: string) => {
  const spy = vi.fn();
  el.addEventListener(type, (e) => spy((e as CustomEvent).detail));
  return spy;
};
afterEach(cleanupWidgets);

describe("shift-dialog", () => {
  it("submits a new shift with Save", async () => {
    const before = currentLocale();
    setLocale("en-GB");
    try {
      const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
        open: true,
        day: "2026-03-02",
        personId: "p1",
        shift: null,
      });
      expect(
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.textContent!.trim(),
      ).toBe("Save");
    } finally {
      setLocale(before);
    }
  });

  it("emits add-shift with instants composed from the day + entered times (offset 0)", async () => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
      open: true,
      day: "2026-03-02",
      personId: "p1",
      shift: null,
    });
    const add = capture(el, "add-shift");
    setInput(el, "shift-start", "09:00");
    setInput(el, "shift-end", "13:00");
    setInput(el, "shift-role", "bar");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await el.updateComplete;
    expect(add).toHaveBeenCalledWith({
      personId: "p1",
      startsAt: "2026-03-02T09:00:00Z",
      startsOffsetMinutes: 0,
      endsAt: "2026-03-02T13:00:00Z",
      endsOffsetMinutes: 0,
      role: "bar",
    });
  });

  it("pre-fills from an existing shift and emits update-shift on save", async () => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
      open: true,
      day: "2026-03-02",
      personId: "p1",
      shift,
    });
    const update = capture(el, "update-shift");
    setInput(el, "shift-end", "15:00");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await el.updateComplete;
    expect(update).toHaveBeenCalledWith({
      shiftId: "s1",
      patch: {
        startsAt: "2026-03-02T09:00:00Z",
        startsOffsetMinutes: 0,
        endsAt: "2026-03-02T15:00:00Z",
        endsOffsetMinutes: 0,
        role: "bar",
      },
    });
  });

  it("pre-fills a +02:00 shift with its wall-clock times and saves them back unchanged", async () => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
      open: true,
      day: "2027-01-04",
      personId: "p1",
      shift: { ...offsetShift },
      timeZone: "Etc/GMT-2",
    });
    expect(inputValue(el, "shift-start")).toBe("09:00");
    expect(inputValue(el, "shift-end")).toBe("17:00");
    const update = capture(el, "update-shift");
    setInput(el, "shift-role", "kitchen");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await el.updateComplete;
    expect(update).toHaveBeenCalledExactlyOnceWith({
      shiftId: "s2",
      patch: {
        startsAt: "2027-01-04T07:00:00Z",
        startsOffsetMinutes: 120,
        endsAt: "2027-01-04T15:00:00Z",
        endsOffsetMinutes: 120,
        role: "kitchen",
      },
    });
  });

  it("saves an edited wall-clock start before the offset as the previous UTC day", async () => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
      open: true,
      day: "2027-01-04",
      personId: "p1",
      shift: { ...offsetShift },
      timeZone: "Etc/GMT-2",
    });
    const update = capture(el, "update-shift");
    setInput(el, "shift-start", "00:30");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    await el.updateComplete;
    expect(update).toHaveBeenCalledExactlyOnceWith({
      shiftId: "s2",
      patch: {
        startsAt: "2027-01-03T22:30:00Z",
        startsOffsetMinutes: 120,
        endsAt: "2027-01-04T15:00:00Z",
        endsOffsetMinutes: 120,
        role: "bar",
      },
    });
  });

  it("pre-fills an offset-0 shift with its stored times", async () => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
      open: true,
      day: "2026-03-02",
      personId: "p1",
      shift,
    });
    expect(inputValue(el, "shift-start")).toBe("09:00");
    expect(inputValue(el, "shift-end")).toBe("13:00");
  });

  it("emits remove-shift for an existing shift", async () => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
      open: true,
      day: "2026-03-02",
      personId: "p1",
      shift,
    });
    const remove = capture(el, "remove-shift");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=remove]")!.click();
    await el.updateComplete;
    expect(remove).toHaveBeenCalledWith({ shiftId: "s1" });
  });

  it("does not offer Remove for a new shift (shift null)", async () => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
      open: true,
      day: "2026-03-02",
      personId: "p1",
      shift: null,
    });
    expect(el.shadowRoot!.querySelector("[data-test=remove]")).toBeNull();
  });

  it("drops a double-fired confirm to one event when busy", async () => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
      open: true,
      day: "2026-03-02",
      personId: "p1",
      shift: null,
      busy: false,
    });
    const add = capture(el, "add-shift");
    setInput(el, "shift-start", "09:00");
    setInput(el, "shift-end", "13:00");
    const btn = el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!;
    btn.click();
    (el as unknown as { busy: boolean }).busy = true; // the screen sets busy while the add round-trips
    await el.updateComplete;
    btn.click();
    await el.updateComplete;
    expect(add).toHaveBeenCalledTimes(1);
  });
});

describe("shift-dialog guards and keyboard submit", () => {
  it("drops a Remove while a write is in flight", async () => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
      open: true,
      day: "2026-03-02",
      personId: "p1",
      shift,
      busy: true,
    });
    const remove = capture(el, "remove-shift");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=remove]")!.click();
    await el.updateComplete;
    expect(remove).not.toHaveBeenCalled();
  });

  it("confirms on Enter in a field", async () => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
      open: true,
      day: "2026-03-02",
      personId: "p1",
      shift,
    });
    const update = capture(el, "update-shift");
    setInput(el, "shift-role", "kitchen");
    await el.updateComplete;
    const field = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "[data-test=shift-role]",
    )!;
    await field.updateComplete;
    field.shadowRoot!.querySelector("input")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    expect(update).toHaveBeenCalledExactlyOnceWith({
      shiftId: "s1",
      patch: {
        startsAt: "2026-03-02T09:00:00Z",
        startsOffsetMinutes: 0,
        endsAt: "2026-03-02T13:00:00Z",
        endsOffsetMinutes: 0,
        role: "kitchen",
      },
    });
  });
});

describe("shift-dialog venue clock", () => {
  it.each([
    ["2026-03-02", "22:00", "02:00", "2026-03-02T21:00:00Z", 60, "2026-03-03T01:00:00Z", 60],
    ["2026-03-28", "22:00", "04:00", "2026-03-28T21:00:00Z", 60, "2026-03-29T02:00:00Z", 120],
    ["2026-10-24", "22:00", "04:00", "2026-10-24T20:00:00Z", 120, "2026-10-25T03:00:00Z", 60],
    ["2026-12-31", "22:00", "02:00", "2026-12-31T21:00:00Z", 60, "2027-01-01T01:00:00Z", 60],
    ["2026-03-02", "09:00", "09:00", "2026-03-02T08:00:00Z", 60, "2026-03-03T08:00:00Z", 60],
  ])(
    "builds %s %s–%s in the venue zone",
    async (day, start, end, startsAt, startsOffsetMinutes, endsAt, endsOffsetMinutes) => {
      const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
        open: true,
        day: day as string,
        personId: "p1",
        timeZone: "Europe/Madrid",
      });
      const add = capture(el, "add-shift");
      setInput(el, "shift-start", start as string);
      setInput(el, "shift-end", end as string);
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
      expect(add).toHaveBeenCalledExactlyOnceWith({
        personId: "p1",
        startsAt,
        startsOffsetMinutes,
        endsAt,
        endsOffsetMinutes,
        role: null,
      });
    },
  );

  it("recomputes both offsets when an edit moves a winter shift to summer", async () => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
      open: true,
      day: "2026-07-06",
      personId: "p1",
      timeZone: "Europe/Madrid",
      shift: {
        ...shift,
        startsAt: "2026-03-02T08:00:00Z",
        endsAt: "2026-03-02T12:00:00Z",
        startsOffsetMinutes: 60,
        endsOffsetMinutes: 60,
      },
    });
    const update = capture(el, "update-shift");
    setInput(el, "shift-role", "kitchen");
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    expect(update).toHaveBeenCalledExactlyOnceWith({
      shiftId: "s1",
      patch: {
        startsAt: "2026-07-06T07:00:00Z",
        startsOffsetMinutes: 120,
        endsAt: "2026-07-06T11:00:00Z",
        endsOffsetMinutes: 120,
        role: "kitchen",
      },
    });
  });
});

it("preserves the later repeated minute when only the role changes", async () => {
  const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
    open: true,
    day: "2026-10-25",
    personId: "p1",
    timeZone: "Europe/Madrid",
    shift: {
      ...shift,
      startsAt: "2026-10-25T01:30:00Z",
      startsOffsetMinutes: 60,
      endsAt: "2026-10-25T03:00:00Z",
      endsOffsetMinutes: 60,
    },
  });
  const update = capture(el, "update-shift");
  setInput(el, "shift-role", "kitchen");
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  expect(update).toHaveBeenCalledExactlyOnceWith({
    shiftId: "s1",
    patch: {
      startsAt: "2026-10-25T01:30:00Z",
      startsOffsetMinutes: 60,
      endsAt: "2026-10-25T03:00:00Z",
      endsOffsetMinutes: 60,
      role: "kitchen",
    },
  });
});

it.each(["shift-start", "shift-end"])(
  "marks only the %s that names a skipped minute and recovers after correction",
  async (field) => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
      open: true,
      day: "2026-03-29",
      personId: "p1",
      timeZone: "Europe/Madrid",
    });
    const add = capture(el, "add-shift");
    setInput(el, "shift-start", field === "shift-start" ? "02:30" : "01:00");
    setInput(el, "shift-end", field === "shift-end" ? "02:30" : "04:00");
    await el.updateComplete;
    const save =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm]")!;
    save.click();
    await el.updateComplete;
    await save.updateComplete;
    expect(add).not.toHaveBeenCalled();
    expect(save.disabled).toBe(true);
    const bad = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      `[data-test=${field}]`,
    )!;
    const good = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      `[data-test=${field === "shift-start" ? "shift-end" : "shift-start"}]`,
    )!;
    expect(bad.error).toBe(t("roster.time_skipped"));
    expect(good.error).toBe("");
    const message = el.shadowRoot!.querySelector<HTMLElement>('[role="alert"]')!;
    expect(message.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      save.getBoundingClientRect().top,
    );
    expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe(
      codeMessage("shift.invalid"),
    );
    setInput(el, field, "");
    await el.updateComplete;
    expect(good.error).toBe("");
    expect(bad.error).toBe(t("roster.time_required"));
    setInput(el, field, field === "shift-start" ? "01:00" : "04:00");
    await el.updateComplete;
    await save.updateComplete;
    expect(save.disabled).toBe(false);
    save.click();
    expect(add).toHaveBeenCalledExactlyOnceWith({
      personId: "p1",
      startsAt: "2026-03-29T00:00:00Z",
      startsOffsetMinutes: 60,
      endsAt: "2026-03-29T02:00:00Z",
      endsOffsetMinutes: 120,
      role: null,
    });
  },
);

it("marks both shift times as required", async () => {
  const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
    open: true,
    day: "2026-03-02",
    personId: "p1",
  });
  for (const field of ["shift-start", "shift-end"]) {
    const input = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      `[data-test=${field}]`,
    )!;
    await input.updateComplete;
    expect(input.required).toBe(true);
  }
});

it.each([
  ["02:30", "03:30", "2026-10-25T00:30:00Z", 120, "2026-10-25T02:30:00Z", 60],
  ["01:30", "02:30", "2026-10-24T23:30:00Z", 120, "2026-10-25T00:30:00Z", 120],
])(
  "uses the earlier occurrence for a new repeated %s–%s shift",
  async (start, end, startsAt, startsOffsetMinutes, endsAt, endsOffsetMinutes) => {
    const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
      open: true,
      day: "2026-10-25",
      personId: "p1",
      timeZone: "Europe/Madrid",
    });
    const add = capture(el, "add-shift");
    setInput(el, "shift-start", start as string);
    setInput(el, "shift-end", end as string);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
    expect(add).toHaveBeenCalledExactlyOnceWith({
      personId: "p1",
      startsAt,
      startsOffsetMinutes,
      endsAt,
      endsOffsetMinutes,
      role: null,
    });
  },
);

it("retains a stored later repeated end minute on a role-only edit", async () => {
  const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
    open: true,
    day: "2026-10-25",
    personId: "p1",
    timeZone: "Europe/Madrid",
    shift: {
      ...shift,
      startsAt: "2026-10-24T23:30:00Z",
      startsOffsetMinutes: 120,
      endsAt: "2026-10-25T01:30:00Z",
      endsOffsetMinutes: 60,
    },
  });
  const update = capture(el, "update-shift");
  setInput(el, "shift-role", "kitchen");
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  expect(update).toHaveBeenCalledExactlyOnceWith({
    shiftId: "s1",
    patch: {
      startsAt: "2026-10-24T23:30:00Z",
      startsOffsetMinutes: 120,
      endsAt: "2026-10-25T01:30:00Z",
      endsOffsetMinutes: 60,
      role: "kitchen",
    },
  });
});

it("recomputes an edited end's offset on the clock-change day", async () => {
  const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
    open: true,
    day: "2026-03-29",
    personId: "p1",
    timeZone: "Europe/Madrid",
    shift: {
      ...shift,
      startsAt: "2026-03-29T00:00:00Z",
      startsOffsetMinutes: 60,
      endsAt: "2026-03-29T00:30:00Z",
      endsOffsetMinutes: 60,
    },
  });
  const update = capture(el, "update-shift");
  setInput(el, "shift-end", "04:00");
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  expect(update).toHaveBeenCalledExactlyOnceWith({
    shiftId: "s1",
    patch: {
      startsAt: "2026-03-29T00:00:00Z",
      startsOffsetMinutes: 60,
      endsAt: "2026-03-29T02:00:00Z",
      endsOffsetMinutes: 120,
      role: "bar",
    },
  });
});

it("keeps a draft blocked without blaming its times while the venue clock is unavailable", async () => {
  const { el } = await mountWidget<ShiftDialog>("dashboard-shift-dialog", {
    open: true,
    day: "2026-03-02",
    personId: "p1",
    timeZone: "",
  });
  const add = capture(el, "add-shift");
  setInput(el, "shift-start", "09:00");
  setInput(el, "shift-end", "17:00");
  await el.updateComplete;
  const save =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=confirm]")!;
  await save.updateComplete;
  expect(save.disabled).toBe(true);
  save.click();
  await el.updateComplete;
  expect(add).not.toHaveBeenCalled();
  for (const field of ["shift-start", "shift-end"])
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(`[data-test=${field}]`)!
        .error,
    ).toBe("");
  expect(el.shadowRoot!.querySelector('[role="alert"]')!.textContent).toBe(
    t("roster.clock_unavailable"),
  );
  el.timeZone = "Europe/Madrid";
  await el.updateComplete;
  await save.updateComplete;
  expect(save.disabled).toBe(false);
  save.click();
  expect(add).toHaveBeenCalledExactlyOnceWith({
    personId: "p1",
    startsAt: "2026-03-02T08:00:00Z",
    startsOffsetMinutes: 60,
    endsAt: "2026-03-02T16:00:00Z",
    endsOffsetMinutes: 60,
    role: null,
  });
});
