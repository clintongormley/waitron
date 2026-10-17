import { html, nothing } from "lit";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { StaffingApi } from "./client.js";
import { STAFFING_STRINGS } from "./strings.js";
import "./staff-roles-screen.js";
import "./staffing-month.js";
import "./rota-view.js";
import "./staffing-season-painter.js";
import "./staffing-special-day-painter.js";

export const STAFFING_DASHBOARD: DashboardContribution = {
  module: "staffing",
  screen: {
    id: "staff-roles",
    navLabelKey: "nav.staff_roles",
    group: "team",
    requiresPermission: "staffing.manage",
    readPermission: "venue.view",
  },
  strings: STAFFING_STRINGS,
  calendarViews: [
    {
      id: "staffing",
      labelKey: "staffing.view.tab",
      order: 10,
      requiresPermission: "staffing.manage",
      readPermission: "venue.view",
      create(ctx, host) {
        const api = new StaffingApi(ctx.request, ctx.liveData);
        return {
          render: () =>
            html`<staffing-month
                .api=${api}
                .month=${host.month}
                .params=${host.params}
                .canWrite=${host.canWrite}
                .canOpenRota=${ctx.calendarViews?.some((entry) => entry.view.id === "rota") ?? false}
                .open=${host.open}
              ></staffing-month
              >${
                host.params.painter === "season" && host.params.season
                  ? html`<staffing-season-painter
                      .api=${api}
                      .seasonId=${host.params.season}
                      .area=${host.params.area ?? ""}
                      .month=${host.month}
                      .readOnly=${!host.canWrite}
                      .open=${host.open}
                    ></staffing-season-painter>`
                  : host.params.painter === "special-day" && host.params["special-day"]
                    ? html`<staffing-special-day-painter
                        .api=${api}
                        .specialDayId=${host.params["special-day"]}
                        .area=${host.params.area ?? ""}
                        .month=${host.month}
                        .readOnly=${!host.canWrite}
                        .open=${host.open}
                      ></staffing-special-day-painter>`
                    : nothing
              }`,
        };
      },
    },
    {
      id: "rota",
      searchDestinations: [
        { id: "everyone", labelKey: "staffing.rota.everyone_search", params: { area: "everyone" } },
      ],
      labelKey: "staffing.rota.tab",
      order: 20,
      requiresPermission: "schedule.manage",
      readPermission: "schedule.manage",
      create(ctx, host) {
        const api = new StaffingApi(ctx.request, ctx.liveData);
        return {
          render: () =>
            html`<staffing-rota
              .api=${api}
              .week=${validWeek(host.params.week) ? host.params.week! : monday(host.month)}
              .params=${host.params}
              .canWrite=${host.canWrite}
              .canWriteStaffing=${ctx.calendarViews?.some((entry) => entry.view.id === "staffing" && entry.canWrite) ?? false}
              .canOpenStaffing=${ctx.calendarViews?.some((entry) => entry.view.id === "staffing") ?? false}
              .open=${host.open}
            ></staffing-rota>`,
        };
      },
    },
  ],
  create(ctx) {
    const api = new StaffingApi(ctx.request, ctx.liveData);
    return {
      render: (readOnly = false) =>
        html`<dashboard-staff-roles-screen
          .api=${api}
          .readOnly=${readOnly}
        ></dashboard-staff-roles-screen>`,
    };
  },
};

function monday(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function validWeek(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 1
  );
}
