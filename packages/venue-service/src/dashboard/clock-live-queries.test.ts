import { expect, it } from "vitest";
import { LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
import { OpeningHoursApi } from "./opening-hours-client.js";
for (const type of ["location_business_day_settings", "location_day_cutover_changes"]) {
  for (const kind of ["hours", "year"]) {
    it(`${kind} rereads ${type} changes passively`, async () => {
      const live = new LiveData();
      const methods: unknown[][] = [];
      let reads = 0;
      const revisions: number[] = [];
      const request = (async (_path, method, _body, options) => {
        methods.push([method, options]);
        return { clockRevision: ++reads };
      }) as DashboardRequest;
      const stop =
        kind === "hours"
          ? new OpeningHoursApi(request, live).watchOpeningHours(
              (model) => revisions.push(model.clockRevision),
              () => {},
              () => {},
            )
          : new OpeningHoursApi(request, live).watchYear(
              2026,
              (model) => revisions.push(model.clockRevision),
              () => {},
              () => {},
            );
      try {
        await expect.poll(() => revisions).toEqual([1]);
        live.invalidate([{ type }]);
        await expect.poll(() => revisions).toEqual([1, 2]);
        expect(methods).toEqual([
          ["GET", { passive: true }],
          ["GET", { passive: true }],
        ]);
      } finally {
        stop();
      }
    });
  }
}
