import { expect } from "vitest";
import { userEvent } from "vitest/browser";
import { createRequest, LiveData } from "@waitron/dashboard-kit";
import type {
  AttendanceCommand,
  AttendanceDayView,
  AttendanceLookups,
  ManagerHours,
} from "@waitron/dashboard-modules";
import { mountWidget } from "../src/widgets/test-helpers.js";
import "../src/screens/attendance-corrections-screen.js";
import type { AttendanceCorrectionsScreen } from "../src/screens/attendance-corrections-screen.js";
import { hoursView } from "./hours-fixtures.js";
import { attendanceItem } from "./attendance-fixtures.js";

export function managerHours(): ManagerHours {
  const hours = hoursView({
    personId: "worker",
    locationId: "shop",
    selection: { kind: "pay-period" },
    period: { start: "2026-01-01", end: "2026-02-01" },
  });
  hours.pending.items = [
    attendanceItem({
      id: "request",
      personId: "worker",
      locationId: "shop",
      direction: "worker_request",
      status: "waiting-manager",
      reason: "Old pending hours",
      changes: [
        { target: { entryId: "automatic-out" }, at: "2026-01-05T18:00:00.000Z", offsetMinutes: 60 },
      ],
    }),
  ];
  return {
    locationId: "shop",
    selection: { kind: "pay-period" },
    period: hours.period,
    businessDay: hours.businessDay,
    asOf: hours.asOf,
    people: [
      { personId: "worker", displayName: "Ana Worker", hours },
      {
        personId: "retained",
        displayName: "Retained worker",
        hours: hoursView({
          personId: "retained",
          locationId: "shop",
          selection: { kind: "pay-period" },
          period: hours.period,
          workedMinutes: 0,
          days: [{ date: "2026-01-05", workedMinutes: 0, sessions: [] }],
          record: { entries: [], sessions: [], closures: [], closedPeriodImpacts: [] },
          pending: { prompts: [], items: [], automaticEntryIds: [] },
        }),
      },
    ],
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
export async function mountManagerHours(
  options: {
    live?: boolean;
    theme?: "light" | "dark";
    fail?: boolean;
    held?: Promise<ManagerHours>;
  } = {},
) {
  const data = {
    hours: managerHours(),
    lookups: {
      viewer: { personId: "manager", canSelfApprove: false },
      locations: [
        { id: "shop", name: "Deli", timeZone: "Europe/Madrid" },
        { id: "bar", name: "Bar", timeZone: "Europe/Madrid" },
      ],
      people: [{ personId: "worker", displayName: "Ana Worker" }],
    } satisfies AttendanceLookups,
  };
  const reads: { path: string; passive: string | null }[] = [],
    commands: AttendanceCommand[] = [];
  let fail = options.fail ?? false,
    refusal = "",
    receipt: unknown = null,
    receiptFailure = false;
  let held = options.held ? { match: "/hours?", promise: options.held as Promise<unknown> } : null;
  let revision = "authoritative-day";
  const request = createRequest({
    fetchImpl: async (path, init) => {
      if (init.method === "POST") {
        const command = JSON.parse(init.body as string) as AttendanceCommand;
        commands.push(command);
        if (refusal === "lost") throw new Error("lost answer");
        if (refusal) return Response.json({ error: { code: refusal } }, { status: 409 });
        return Response.json({
          commandId: command.commandId,
          entryIds: ["saved"],
          replayed: false,
        });
      }
      reads.push({ path, passive: new Headers(init.headers).get("x-waitron-live") });
      if (held && path.includes(held.match)) return Response.json(await held.promise);
      if (path.includes("/commands/")) {
        if (receiptFailure) throw new Error("receipt offline");
        return Response.json(receipt);
      }
      if (path.endsWith("/lookups")) return Response.json(data.lookups);
      if (fail) throw new Error("offline");
      if (path.includes("/hours?")) {
        const args = new URL(path, location.origin).searchParams;
        return Response.json({
          ...data.hours,
          locationId: args.get("locationId"),
          people: data.hours.people.map((person) => ({
            ...person,
            hours: {
              ...person.hours,
              period: data.hours.period,
              locationId: args.get("locationId")!,
            },
          })),
          selection: {
            kind: "pay-period",
            ...(args.has("date") ? { date: args.get("date") } : {}),
          },
        });
      }
      if (path.includes("/queue?")) return Response.json({ locationId: "shop", items: [] });
      if (path.includes("/day?")) {
        const args = new URL(path, location.origin).searchParams;
        const hours = data.hours.people.find(
          (person) => person.personId === args.get("personId"),
        )!.hours;
        return Response.json({
          personId: args.get("personId")!,
          locationId: args.get("locationId")!,
          date: args.get("date")!,
          revision,
          timeZone: "Europe/Madrid",
          record: hours.record,
          items: hours.pending.items,
        } satisfies AttendanceDayView);
      }
      throw new Error(path);
    },
  });
  const liveData = options.live ? new LiveData() : undefined;
  const mounted = await mountWidget<AttendanceCorrectionsScreen>(
    "dashboard-attendance-corrections-screen",
    { request, liveData, mode: "hours" },
    options.theme,
  );
  const root = mounted.el.shadowRoot!;
  await expect.poll(() => root.querySelector('[name="attendanceLocation"]')).toBeTruthy();
  return {
    ...mounted,
    root,
    data,
    commands,
    reads,
    liveData,
    fail: (value = true) => {
      fail = value;
    },
    refuse: (value: string) => {
      refusal = value;
    },
    hold: (match: string, promise: Promise<unknown>) => {
      held = { match, promise };
    },
    release: () => {
      held = null;
    },
    receipt: (value: unknown, fails = false) => {
      receipt = value;
      receiptFailure = fails;
    },
    revision: (value: string) => {
      revision = value;
    },
  };
}
export async function click(root: ParentNode, selector: string) {
  const el = root.querySelector<HTMLElement>(selector);
  expect(el, selector).toBeTruthy();
  await userEvent.click(el!);
}
export async function change(root: ParentNode, name: string, value: string) {
  const el = root.querySelector(`[name="${name}"]`);
  expect(el, name).toBeTruthy();
  el!.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
}
export async function record(root: ParentNode) {
  await expect
    .poll(() =>
      root.querySelector("dashboard-hours-record")?.shadowRoot?.querySelector("[data-total]"),
    )
    .toBeTruthy();
  return root.querySelector("dashboard-hours-record")!;
}
export async function openDay(root: ParentNode, date = "2026-01-05") {
  const view = await record(root);
  await click(view.shadowRoot!, `[data-fix="${date}"]`);
  await expect.poll(() => root.querySelector("[data-day]")).toBeTruthy();
}
