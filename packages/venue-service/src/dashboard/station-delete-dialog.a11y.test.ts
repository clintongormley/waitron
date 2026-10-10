import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { allowedImpact, mountDelete, openDelete } from "../../test/station-delete-test-helpers.js";
describe.each(["light", "dark"])("permanent delete accessibility %s", (theme) => {
  it.each(["loading", "read-error", "allowed", "default", "screens", "work", "write-error"])(
    "checks %s",
    async (state) => {
      const impact = {
        ...allowedImpact,
        removes: [
          { key: "station_routing_periods", count: 2, targets: [] },
          {
            key: "station_daily_destinations",
            count: 1,
            targets: [{ id: "other", name: "Very long other station name" }],
          },
        ],
        refusals:
          state === "default"
            ? [{ code: "station.is_default", params: { stationId: "bar" }, targets: [] }]
            : state === "screens"
              ? [
                  {
                    code: "station.screen_in_use",
                    params: { count: 1 },
                    targets: [{ id: "screen", name: "Very long kitchen display name" }],
                  },
                ]
              : state === "work"
                ? [{ code: "station.work_in_progress", params: { count: 3 }, targets: [] }]
                : [],
      };
      const read =
        state === "loading"
          ? vi.fn(() => new Promise(() => {}))
          : state === "read-error"
            ? vi.fn().mockRejectedValue({ code: "connection.failed" })
            : vi.fn().mockResolvedValue(impact);
      const { screen, host } = await mountDelete(
        {
          getStationDeleteImpact: read,
          deleteStation: vi.fn().mockRejectedValue({ code: "connection.failed" }),
        },
        theme,
      );
      setLocale("en");
      const dialog = await openDelete(screen);
      if (state !== "loading") await expect.poll(() => dialog.loading).toBe(false);
      if (state === "write-error") {
        dialog.shadowRoot!.querySelector<HTMLElement>('[data-test="delete-confirm"]')!.click();
        await expect.poll(() => dialog.actionError).not.toBe("");
      }
      await expectNoA11yViolations(host);
    },
  );
});
