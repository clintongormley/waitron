import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { OpeningHoursScreen } from "./opening-hours-screen.js";
import type { ServiceGrid } from "./service-grid.js";
import "./opening-hours-screen.js";

const originalUrl = location.href;
const hosts: HTMLElement[] = [];
beforeEach(() => {
  setLocale("en");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  hosts.splice(0).forEach((host) => host.remove());
  history.replaceState(null, "", originalUrl);
  setLocale("en");
});
const model = {
  timeZone: "Europe/Madrid",
  clockReadable: true,
  dayCutover: "06:00",
  menus: [],
  namedDays: [],
  departments: [
    {
      id: "dining",
      name: "Dining",
      active: true,
      zones: [],
      dates: [],
      week: [],
      periods: [
        {
          id: "lunch",
          name: "Lunch",
          colour: "blue",
          menuId: "menu",
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: [1],
          routingUses: [],
        },
      ],
    },
  ],
};
const stations = [
  { id: "bar", name: "Bar", active: true, isDefault: false },
  { id: "kitchen", name: "Kitchen", active: true, isDefault: true },
  { id: "off", name: "Off", active: false, isDefault: false },
];
async function mount(station = "bar", answer?: (path: string) => unknown | Promise<unknown>) {
  history.replaceState(null, "", `/manage/opening-hours?view=week&station=${station}`);
  const calls: unknown[][] = [];
  const request = (async (path: string, method: string, body: unknown, options: unknown) => {
    calls.push([path, method, body, options]);
    if (path === "/management-api/venue-service/opening-hours") return structuredClone(model);
    if (path === "/management-api/stations?includeDisabled=true") return structuredClone(stations);
    if (path.includes("/service-times?"))
      return (
        answer?.(path) ?? {
          always: path.includes("/kitchen/")
            ? "default"
            : path.includes("/off/")
              ? "switched_off"
              : null,
          days: Array.from({ length: 7 }, (_, index) => ({
            date: `2026-10-${12 + index}`,
            departments:
              index === 0
                ? [
                    {
                      departmentId: "dining",
                      ranges: [{ periodId: "lunch", startsAt: "12:00", endsAt: "16:00" }],
                    },
                  ]
                : [],
          })),
        }
      );
    if (path.includes("/named-days?")) return { days: [], stations: [], departments: [] };
    throw new Error(`Unexpected request ${path}`);
  }) as DashboardRequest;
  const screen = document.createElement("dashboard-opening-hours-screen") as OpeningHoursScreen;
  screen.api = new OpeningHoursApi(request);
  applyTokens(screen);
  hosts.push(screen);
  document.body.append(screen);
  await expect.poll(() => screen.shadowRoot?.querySelector("wt-combobox")).not.toBeNull();
  return { screen, calls };
}
const stationView = (screen: OpeningHoursScreen) =>
  screen.shadowRoot!.querySelector("opening-hours-station");
const grid = (screen: OpeningHoursScreen) =>
  stationView(screen)?.shadowRoot?.querySelector<ServiceGrid>("service-grid");
it("offers active prep stations as a group and shows read-only coloured department columns", async () => {
  const { screen, calls } = await mount();
  const chooser = screen.shadowRoot!.querySelector("wt-combobox")!;
  await expect
    .poll(() => chooser.options.filter((option) => option.group === "Prep stations"))
    .toEqual([
      { value: "station:bar", label: "Bar", group: "Prep stations" },
      { value: "station:kitchen", label: "Kitchen", group: "Prep stations" },
    ]);
  await expect.poll(() => grid(screen)?.columns.length).toBe(7);
  expect(grid(screen)!.columns[0]).toMatchObject({
    key: "2026-10-12:dining",
    label: "Monday",
    editable: false,
    narrow: true,
    slots: [{ periodId: "lunch", startsAt: "12:00", endsAt: "16:00" }],
    periods: [{ id: "lunch", name: "Lunch", colour: "blue" }],
  });
  expect(grid(screen)!.readOnly).toBe(true);
  await grid(screen)!.updateComplete;
  const heading = grid(screen)!.shadowRoot!.querySelector(".heading:has(slot)")!;
  const dayLabel = document.createRange();
  const text = [...heading.childNodes].find(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("Monday"),
  )!;
  expect(text?.textContent).toBe("Monday");
  dayLabel.selectNode(text);
  const departmentLabel = grid(screen)!.querySelector("span")!;
  expect(departmentLabel.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    dayLabel.getBoundingClientRect().bottom,
  );

  expect(calls.filter(([path]) => String(path).includes("service-times"))).toEqual([
    [
      "/management-api/venue-service/stations/bar/service-times?from=2026-10-12&to=2026-10-18&week=normal",
      "GET",
      undefined,
      { passive: true },
    ],
  ]);
  chooser.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "station:kitchen" },
      bubbles: true,
      composed: true,
    }),
  );
  await expect.poll(() => new URL(location.href).searchParams.get("station")).toBe("kitchen");
  await expect
    .poll(() => stationView(screen)?.textContent ?? stationView(screen)?.shadowRoot?.textContent)
    .not.toBeNull();
  await expect.poll(() => stationView(screen)?.shadowRoot?.textContent).toContain("Always open");
  expect(grid(screen)).toBeNull();
});
it("a bookmarked switched-off station shows its sentence instead of a grid", async () => {
  const { screen } = await mount("off");
  await expect.poll(() => stationView(screen)?.shadowRoot?.textContent).toContain("Switched off");
  expect(grid(screen)).toBeNull();
});
it("changing the real week reloads counted ranges and ignores the departed week's late answer", async () => {
  let resolveFirst!: (answer: unknown) => void;
  const { screen, calls } = await mount("bar", (path) =>
    path.includes("week=normal")
      ? { always: null, days: [] }
      : path.includes("from=2026-10-12")
        ? new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : {
            always: null,
            days: [
              {
                date: "2026-10-19",
                departments: [
                  {
                    departmentId: "dining",
                    ranges: [{ periodId: "lunch", startsAt: "13:00", endsAt: "15:00" }],
                  },
                ],
              },
            ],
          },
  );
  const toggle = screen.shadowRoot!.querySelector("wt-switch")!;
  toggle.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
  );
  await expect.poll(() => resolveFirst).toBeDefined();
  await page
    .elementLocator(screen.shadowRoot!.querySelector<HTMLElement>('[data-test="next-week"]')!)
    .click();
  await expect
    .poll(() => grid(screen)?.columns[0]?.slots)
    .toEqual([{ periodId: "lunch", startsAt: "13:00", endsAt: "15:00" }]);
  resolveFirst({ always: null, days: [] });
  await screen.updateComplete;
  expect(grid(screen)!.columns[0]!.slots).toEqual([
    { periodId: "lunch", startsAt: "13:00", endsAt: "15:00" },
  ]);
  expect(
    calls.filter(([path]) => String(path).includes("service-times")).map(([path]) => path),
  ).toEqual([
    "/management-api/venue-service/stations/bar/service-times?from=2026-10-12&to=2026-10-18&week=normal",
    "/management-api/venue-service/stations/bar/service-times?from=2026-10-12&to=2026-10-18",
    "/management-api/venue-service/stations/bar/service-times?from=2026-10-19&to=2026-10-25",
  ]);
});

it("reloads the same station view when reattached without changing its properties", async () => {
  let startsAt = "12:00";
  const { screen } = await mount("bar", () => ({
    always: null,
    days: [
      {
        date: "2026-10-12",
        departments: [
          {
            departmentId: "dining",
            ranges: [{ periodId: "lunch", startsAt, endsAt: "16:00" }],
          },
        ],
      },
    ],
  }));
  await expect.poll(() => grid(screen)?.columns[0]?.slots[0]?.startsAt).toBe("12:00");
  const view = stationView(screen)!;
  view.remove();
  startsAt = "13:00";
  screen.shadowRoot!.append(view);
  await expect.poll(() => grid(screen)?.columns[0]?.slots[0]?.startsAt).toBe("13:00");
});
