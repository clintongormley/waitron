import { afterEach, describe, expect, test } from "vitest";
import { cleanup } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import "@waitron/ui/src/components/wt-button.js";
import type { CalendarDayBox } from "./calendar-day-box.js";
import "./calendar-day-box.js";

afterEach(() => cleanup());

async function mount(theme: "light" | "dark", state: string) {
  const el = (await mountThemed(
    `<div><button>16</button><calendar-day-box heading="Fri, 16 Oct 2026"></calendar-day-box></div>`,
    theme,
  )) as HTMLElement;
  const box = el.querySelector<CalendarDayBox>("calendar-day-box")!;
  if (state === "department and station sections with a season link") {
    box.sectioned = true;
    box.linkedLine = true;
    box.line = "Autumn standard hours";
    box.rows = [
      { name: "Restaurant", text: "08:00–11:00 · 13:00–16:00", strong: true },
      { name: "Terrace", text: "09:00–23:00" },
      { name: "Inside", text: "08:00–11:00 · 13:00–16:00", inheritedFrom: "Restaurant" },
      { name: "Prep stations", text: "", strong: true },
      { name: "Grill", text: "", station: true },
      { name: "Restaurant", text: "Lunch 13:00–16:00" },
    ];
    box.innerHTML = `<a slot="season-action" href="/opening-hours/view/season/season/autumn">Autumn standard hours</a><wt-button>Edit special day</wt-button>`;
  } else if (state === "a special day with buttons") {
    box.name = "School holidays";
    box.nameKind = "special";
    box.line = "Special day — replaces Autumn's standard hours";
    box.rows = [
      { name: "Santet Deli Co", text: "16:00–02:00", strong: true },
      { name: "Front Bar", text: "16:00–02:00", inheritedFrom: "Santet Deli Co" },
    ];
    box.innerHTML = `<wt-button slot="season-action" variant="secondary">Edit Autumn's standard week</wt-button><wt-button variant="secondary">Edit special day</wt-button>`;
  } else if (state === "a plain day with a long name") {
    box.name =
      "Festival of the Exaltation of the Holy Cross and Pilgrimage to Saint Christopher of the Mount";
    box.nameKind = "holiday";
    box.line = "Autumn standard hours";
    box.rows = [{ name: "Santet Deli Co", text: "Closed" }];
  } else if (state === "a read error beside earlier hours") {
    box.rows = [{ name: "Santet Deli Co", text: "Lunch 16:00–17:00" }];
    box.error = "Opening hours could not be loaded.";
  } else if (state === "a read error with nothing to show") {
    box.error = "Opening hours could not be loaded.";
  } else {
    box.message = "Loading…";
  }
  await box.updateComplete;
  box.show(el.querySelector("button")!);
  expect(box.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
  return el;
}

describe.each(["light", "dark"] as const)("calendar-day-box in %s", (theme) => {
  test.each([
    "department and station sections with a season link",
    "a special day with buttons",
    "a plain day with a long name",
    "a loading message",
    "a read error beside earlier hours",
    "a read error with nothing to show",
  ])("has no a11y violations: %s", async (state) => {
    const el = await mount(theme, state);
    await expectNoA11yViolations(el);
  });
});
