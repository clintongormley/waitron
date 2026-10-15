import { afterEach, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import type { RosterBreach, WorkTimeRuleset } from "@waitron/workforce/roster-validation";
import type { RotaWeek } from "../staffing-types.js";
import { rotaWeek } from "../testing/rota-fixture.js";
import { StaffingApi } from "./client.js";
import { RotaView } from "./rota-view.js";
const A = "2026-11-30",
  B = "2026-12-07";
const frames: HTMLElement[] = [];
afterEach(() => {
  frames.splice(0).forEach((f) => f.remove());
  setLocale("en");
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type Warnings = { breaches: RosterBreach[]; ruleset: WorkTimeRuleset | null };
const quiet = (): Warnings => ({ breaches: [], ruleset: null });
async function mount(
  config: {
    read?: (week: string) => Promise<RotaWeek>;
    warnings?: (week: string) => Promise<Warnings>;
    publish?: () => Promise<unknown>;
    change?: (week: string) => Promise<unknown>;
  } = {},
) {
  setLocale("en");
  const live = new LiveData();
  const request = vi.fn(async (path: string, method: string, body?: { week: string }) => {
    if (method === "GET" && path.includes("/rota?")) {
      const week = decodeURIComponent(path.split("week=")[1]!);
      return config.read ? config.read(week) : rotaWeek(week);
    }
    if (method === "GET" && path.includes("/roster/breaches?")) {
      const week = decodeURIComponent(path.split("period=")[1]!);
      return config.warnings ? config.warnings(week) : quiet();
    }
    if (path.endsWith("/publish")) return config.publish?.() ?? { breaches: [] };
    if (path.endsWith("/change-week"))
      return config.change?.(body!.week) ?? { versionId: "copy", openSwaps: [] };
    throw Error(`unexpected ${method} ${path}`);
  });
  const api = new StaffingApi(request as unknown as DashboardRequest, live);
  const actions = {
    published: undefined as Promise<unknown> | undefined,
    changes: new Map<string, Promise<unknown>>(),
  };
  const publish = api.publishRota.bind(api);
  api.publishRota = (id) => {
    const pending = publish(id);
    actions.published = pending;
    return pending;
  };
  const change = api.changeRotaWeek.bind(api);
  api.changeRotaWeek = (week) => {
    const pending = change(week);
    actions.changes.set(week, pending);
    return pending;
  };
  let initialWarnings: Promise<void> | undefined;
  const watch = api.watchRotaWarnings.bind(api);
  api.watchRotaWarnings = (q, l, w, apply) => {
    const result = watch(q, l, w, apply);
    if (w === A) initialWarnings = result;
    return result;
  };
  const frame = document.createElement("div");
  frames.push(frame);
  document.body.append(frame);
  applyTokens(frame);
  const el = new RotaView();
  el.api = api;
  el.week = A;
  el.canWrite = true;
  el.open = () => undefined;
  frame.append(el);
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("rota-by-area")).toBeTruthy());
  return { el, live, request, actions, initial: () => initialWarnings! };
}
const click = (el: Element, selector: string) => {
  const b = el.shadowRoot!.querySelector<HTMLElement>(selector);
  expect(b, selector).toBeTruthy();
  b!.click();
};
const ready = async (el: RotaView) => {
  await el.updateComplete;
  await vi.waitFor(() =>
    expect(
      (
        el.shadowRoot!.querySelector(
          "[data-test=publish-week]",
        )! as HTMLElementTagNameMap["wt-button"]
      ).disabled,
    ).toBe(false),
  );
};
it("releases the old warning read before the next week's rota arrives", async () => {
  const warnings = deferred<Warnings>(),
    read = deferred<RotaWeek>();
  const { el, request, initial } = await mount({
    read: (w) => (w === A ? Promise.resolve(rotaWeek(A)) : read.promise),
    warnings: (w) => (w === A ? warnings.promise : Promise.resolve(quiet())),
  });
  el.week = B;
  await vi.waitFor(() =>
    expect(request.mock.calls.some(([p]) => p.endsWith(`week=${B}`))).toBe(true),
  );
  warnings.reject({ code: "connection.failed" });
  await warnings.promise.catch(() => undefined);
  await initial().catch(() => undefined);
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).not.toContain("Could not load labour warnings");
  read.resolve(rotaWeek(B));
  await ready(el);
});
it("keeps a newly opened publication dialog when an older week's publication answers late", async () => {
  const old = deferred<{ breaches: RosterBreach[] }>();
  const { el, actions } = await mount({ publish: () => old.promise });
  await ready(el);
  click(el, "[data-test=publish-week]");
  await el.updateComplete;
  const dialog = () =>
    el.shadowRoot!.querySelector<import("./publish-dialog.js").PublishDialog>(
      "rota-publish-dialog",
    )!;
  await dialog().updateComplete;
  click(dialog(), "[data-test=publish]");
  el.week = B;
  await ready(el);
  click(el, "[data-test=publish-week]");
  await el.updateComplete;
  expect(dialog().open).toBe(true);
  old.resolve({ breaches: [] });
  await actions.published;
  await el.updateComplete;
  expect(dialog().open).toBe(true);
  expect(dialog().week.week).toBe(B);
});
it("keeps the new week's swap notice when an older Change this week answers late", async () => {
  const old = deferred<{
    versionId: string;
    openSwaps: { swapId: string; fromShiftId: string }[];
  }>();
  let draftB = false;
  const { el, actions } = await mount({
    read: async (w) => {
      const r = rotaWeek(w);
      r.version = {
        id: w,
        status: w === B && draftB ? "draft" : "published",
        changedSincePublished: false,
      };
      return r;
    },
    change: async (w) => {
      if (w === A) return old.promise;
      draftB = true;
      return { versionId: "new-b", openSwaps: [{ swapId: "b", fromShiftId: "b" }] };
    },
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=change-week]")).toBeTruthy(),
  );
  click(el, "[data-test=change-week]");
  el.week = B;
  await el.updateComplete;
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=change-week]")).toBeTruthy(),
  );
  click(el, "[data-test=change-week]");
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("1 swap request is open"));
  old.resolve({
    versionId: "old-a",
    openSwaps: Array.from({ length: 4 }, () => ({ swapId: "a", fromShiftId: "a" })),
  });
  await actions.changes.get(A);
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain("1 swap request is open");
  expect(el.shadowRoot!.textContent).not.toContain("4 swap requests");
});
it("closes an open shift editor when another manager publishes its week", async () => {
  let published = false;
  const { el, live } = await mount({
    read: async (w) => {
      const r = rotaWeek(w);
      if (published) r.version = { id: "pub", status: "published", changedSincePublished: false };
      return r;
    },
  });
  await ready(el);
  const area = el.shadowRoot!.querySelector("rota-by-area")!;
  click(area, "[data-slot=filled]");
  await el.updateComplete;
  const editor = () =>
    el.shadowRoot!.querySelector<import("./shift-edit-dialog.js").ShiftEditDialog>(
      "rota-shift-dialog",
    )!;
  expect(editor().open).toBe(true);
  published = true;
  live.invalidate([{ type: "roster_versions" }]);
  await vi.waitFor(() => expect(editor().open).toBe(false));
});
