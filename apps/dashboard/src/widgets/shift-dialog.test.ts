import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import type { Shift } from "../api/client.js";
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
// wt-input announces edits through a composed `wt-change` CustomEvent (`detail.value`), never a
// host-level native `input` (its internal onInput calls `event.stopPropagation()`), so the dialog
// binds `@wt-change` and the test dispatches `wt-change` — the product-form.test.ts pattern.
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
