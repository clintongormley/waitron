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
  if (state === "a special day with buttons") {
    box.name = "School holidays";
    box.nameKind = "special";
    box.line = "Special day — replaces Autumn's standard hours";
    box.rows = [
      { name: "Santet Deli Co", text: "Lunch 16:00–17:00 · Open 17:00–02:00", strong: true },
      { name: "Front Bar", text: "as Santet Deli Co" },
    ];
    box.innerHTML = `<wt-button variant="secondary">Edit special day</wt-button>`;
  } else if (state === "a plain day with a long name") {
    box.name = "Fiesta de la Exaltación de la Santa Cruz y Romería de San Cristóbal del Monte";
    box.nameKind = "holiday";
    box.line = "Autumn standard hours";
    box.rows = [{ name: "Santet Deli Co", text: "Closed" }];
  } else {
    box.message = "Loading…";
  }
  await box.updateComplete;
  box.show(el.querySelector("button")!);
  expect(box.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
  return el;
}

describe.each(["light", "dark"] as const)("calendar-day-box in %s", (theme) => {
  test.each(["a special day with buttons", "a plain day with a long name", "a loading message"])(
    "has no a11y violations: %s",
    async (state) => {
      const el = await mount(theme, state);
      await expectNoA11yViolations(el);
    },
  );
});
