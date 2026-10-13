import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { registerIcons } from "@waitron/ui";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { SpecialDayPainter } from "./special-day-painter.js";
import {
  frame,
  painterModel,
  part,
  settle,
  specialDayApi,
  storedDay,
} from "../testing/special-day-painter-fixture.js";
import "./special-day-painter.js";

registerIcons({ close: "M3 3l10 10M13 3L3 13" });

afterEach(() => {
  cleanup();
  setLocale("en");
});

describe.each(["light", "dark"] as const)("special-day painter (%s)", (theme) => {
  test.each(["new", "stored", "refused", "adding dates", "deleting", "read-only", "offering"])(
    "%s",
    async (state) => {
      await mountThemed(`<special-day-painter></special-day-painter>`, theme);
      const painter = host.querySelector<SpecialDayPainter>("special-day-painter")!;
      painter.api = specialDayApi([], {
        days: { sd1: storedDay(), sd2: storedDay({ id: "sd2", name: "Navidad" }) },
        answer: () => ({
          code: "special_day.date_taken",
          params: { date: "2026-12-15", name: "Staff party", specialDayId: "sd7" },
        }),
      });
      painter.model = painterModel();
      painter.specialDayId = state === "new" || state === "offering" ? null : "sd1";
      painter.date = state === "new" ? "2026-12-24" : state === "offering" ? "2026-12-25" : null;
      painter.holidays = [
        { id: "h1", date: "2026-12-25", name: "Navidad", scope: "national", sourceId: "es" },
      ];
      painter.readOnly = state === "read-only";
      painter.open = true;
      await settle(painter);
      await expect.poll(() => part(painter, "loading")).toBeNull();
      await settle(painter);
      if (state === "refused") {
        painter.shadowRoot!.querySelector("wt-input[name=name]")!.dispatchEvent(
          new CustomEvent("wt-change", {
            detail: { value: "Renamed" },
            bubbles: true,
            composed: true,
          }),
        );
        await settle(painter);
        frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
        await expect.poll(() => frame(painter).refusal).not.toBe("");
        await settle(painter);
      }
      if (state === "adding dates") {
        part(painter, "add-dates")!.click();
        await settle(painter);
        await painter.shadowRoot!.querySelector("add-dates-calendar")!.updateComplete;
      }
      if (state === "deleting") {
        part(painter, "delete")!.click();
        await settle(painter);
        await painter.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
      }
      if (state === "offering") {
        await expect.poll(() => part(painter, "offer")).not.toBeNull();
        await settle(painter);
      }
      await expectNoA11yViolations(host);
    },
  );
});
