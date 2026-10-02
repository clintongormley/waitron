import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { DeadEndAnswer } from "../api/client.js";
import type { WtCombobox } from "@waitron/ui";
import "./dead-ends-section.js";
import type { TillDeadEndsSection } from "./dead-ends-section.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

const answer: DeadEndAnswer = {
  sends: true,
  deadEnds: [
    {
      key: "first",
      name: "Beer",
      quantity: "2.000",
      stationId: "bar",
      stationName: "Upstairs bar",
      why: "closed",
    },
    {
      key: "second",
      name: "Wine",
      quantity: "1",
      stationId: "bar",
      stationName: "Upstairs bar",
      why: "switched_off",
    },
  ],
  stations: [
    { id: "bar", name: "Upstairs bar", open: false },
    { id: "kitchen", name: "Kitchen", open: true },
  ],
};

it("shows each reason, closed option, required station, and removal events", async () => {
  const { el: host } = await mountWidget<TillDeadEndsSection>("till-dead-ends-section", {
    answer,
    allowRemove: true,
  });
  const root = host.shadowRoot!;
  const text = root.textContent!.replace(/\s+/g, " ");
  expect(root.querySelector(".name")!.textContent).toBe("Beer ×2");
  expect(text).toContain("Upstairs bar is closed, and no station can replace it.");
  expect(text).toContain("Upstairs bar is switched off, and no station can replace it.");
  const selects = root.querySelectorAll<WtCombobox>('wt-combobox[name="make-at"]');
  expect(selects).toHaveLength(2);
  expect(selects[0]!.required).toBe(true);
  expect(selects[0]!.placeholder).toBe("Choose a station");
  expect(selects[0]!.options[0]!.label).toBe("Upstairs bar (closed)");
  const events: unknown[] = [];
  host.addEventListener("make-at", (event) => events.push((event as CustomEvent).detail));
  selects[0]!.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "kitchen" } }));
  expect(events).toEqual([{ key: "first", stationId: "kitchen" }]);
  expect(root.textContent).toContain("Choose where to make each dish, or remove it.");
});
