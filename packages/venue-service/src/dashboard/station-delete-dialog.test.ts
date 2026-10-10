import { expect, it, vi } from "vitest";
import { registerIcons } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DeleteImpact } from "@waitron/shared";
registerIcons({ kebab: "M8 2v12", grip: "M5 2v12M11 2v12" });
import {
  stationView,
  allowedImpact,
  deferred,
  mountDelete,
  openDelete,
} from "../../test/station-delete-test-helpers.js";
const button = (dialog: HTMLElementTagNameMap["wt-delete-dialog"], kind = "confirm") =>
  dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `[data-test="delete-${kind}"]`,
  )!;
async function ready(dialog: HTMLElementTagNameMap["wt-delete-dialog"]) {
  await expect.poll(() => dialog.loading).toBe(false);
  await dialog.updateComplete;
}

it("permanent delete renders every canonical removal under Settings removed with no work-ended group", async () => {
  const counted = (key: string, count: number) => ({ key, count, targets: [] });
  const named = (key: string, name: string) => ({
    key,
    count: 1,
    targets: [{ id: "private-id", name }],
  });
  const impact: DeleteImpact = {
    ...allowedImpact,
    ends: [],
    removes: [
      counted("station_unsent_lines", 3),
      counted("station_draft_lines", 2),
      named("station_printers", "Thermal printer"),
      named("station_made_here", "Counter till"),
      counted("station_timing", 1),
      counted("station_routing_cells", 4),
      counted("station_routing_periods", 5),
      named("station_device_screens", "Kitchen display"),
      named("station_profile_screens", "Kitchen profile"),
      counted("station_daily_states", 2),
      named("station_daily_destinations", "Terrace station"),
    ],
  };
  const { screen } = await mountDelete({
    getStationDeleteImpact: vi.fn().mockResolvedValue(impact),
  });
  const dialog = await openDelete(screen);
  await ready(dialog);
  expect(dialog.impact).toEqual(impact);
  expect(dialog.shadowRoot!.querySelector('[data-group="ends"]')).toBeNull();
  const group = dialog.shadowRoot!.querySelector('[data-group="removes"]')!;
  expect(group.querySelector("h3")!.textContent).toBe("Settings removed");
  expect([...group.querySelectorAll("li")].map((line) => line.textContent?.trim())).toEqual([
    "3 unsent order lines return to normal routing.",
    "2 draft lines return to normal routing.",
    "Remove these printer links: Thermal printer.",
    "Remove Made here from these devices: Counter till.",
    "Remove station timing settings (1).",
    "Remove 4 normal routing rules.",
    "Remove 5 period routing rules.",
    "Remove this station from these devices: Kitchen display.",
    "Remove this station from these profiles: Kitchen profile.",
    "Remove 2 daily station settings.",
    "These closed stations use normal routing: Terrace station.",
  ]);
  expect(dialog.shadowRoot!.textContent).not.toContain("private-id");
});

it.each([
  [
    "station.is_default",
    { stationId: "bar" },
    [{ id: "bar", name: "Bar" }],
    "Choose another default station first.",
  ],
  [
    "station.screen_in_use",
    { stationId: "bar", count: 2 },
    [
      { id: "one", name: "Kitchen display" },
      { id: "two", name: "Terrace display" },
    ],
    "Move these screens first: Kitchen display, Terrace display.",
  ],
  [
    "station.work_in_progress",
    { stationId: "bar", count: 3 },
    [{ id: "order", name: "Table 4" }],
    "3 dishes are still waiting or being prepared.",
  ],
] as const)(
  "permanent delete refuses %s without sending a write or opening a disposition",
  async (code, params, targets, line) => {
    const impact: DeleteImpact = {
      ...allowedImpact,
      refusals: [{ code, params, targets: [...targets] }],
    };
    const { screen, api } = await mountDelete({
      getStationDeleteImpact: vi.fn().mockResolvedValue(impact),
    });
    const dialog = await openDelete(screen);
    await ready(dialog);
    expect(dialog.shadowRoot!.textContent).toContain(line);
    expect(button(dialog).disabled).toBe(true);
    expect(dialog.shadowRoot!.querySelector("wt-combobox")).toBeNull();
    dialog.dispatchEvent(new CustomEvent("wt-delete-confirm", { detail: { id: "bar" } }));
    expect(api.deleteStation).not.toHaveBeenCalled();
  },
);
it("permanent delete cannot confirm a pending or failed read and retries it", async () => {
  const read = deferred<DeleteImpact>();
  const next = deferred<DeleteImpact>();
  const { screen, api } = await mountDelete({
    getStationDeleteImpact: vi.fn().mockReturnValueOnce(read.promise).mockReturnValue(next.promise),
  });
  const dialog = await openDelete(screen);
  dialog.dispatchEvent(new CustomEvent("wt-delete-confirm", { detail: { id: "bar" } }));
  expect(api.deleteStation).not.toHaveBeenCalled();
  read.reject({ code: "connection.failed" });
  await expect.poll(() => dialog.readError).not.toBe("");
  button(dialog, "retry").click();
  await expect.poll(() => dialog.loading).toBe(true);
  next.resolve(allowedImpact);
  await ready(dialog);
  expect(dialog.readError).toBe("");
  expect(button(dialog).disabled).toBe(false);
});
it("permanent delete rejects an impact for another target", async () => {
  const { screen, api } = await mountDelete({
    getStationDeleteImpact: vi
      .fn()
      .mockResolvedValue({ ...allowedImpact, target: { id: "other", name: "Other" } }),
  });
  const dialog = await openDelete(screen);
  await expect.poll(() => dialog.readError).not.toBe("");
  expect(button(dialog).disabled).toBe(true);
  expect(api.deleteStation).not.toHaveBeenCalled();
});
it("permanent delete sends only the captured id once and prevents pending dismissal", async () => {
  const write = deferred<DeleteImpact>();
  const { screen, api } = await mountDelete({
    deleteStation: vi.fn().mockReturnValue(write.promise),
  });
  const dialog = await openDelete(screen);
  await ready(dialog);
  button(dialog).click();
  dialog.dispatchEvent(new CustomEvent("wt-delete-confirm", { detail: { id: "bar" } }));
  dialog.dispatchEvent(new CustomEvent("wt-close"));
  await screen.updateComplete;
  expect(api.deleteStation).toHaveBeenCalledExactlyOnceWith("bar");
  expect(screen.shadowRoot!.querySelector("wt-delete-dialog")).toBe(dialog);
  expect(await dialog.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel")).toBe(false);
  write.resolve(allowedImpact);
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-delete-dialog")).toBeNull();
});
it("permanent delete keeps independent action and read errors, recovering only the read", async () => {
  const read = vi.fn().mockResolvedValue(allowedImpact);
  const { screen } = await mountDelete({
    getStationDeleteImpact: read,
    deleteStation: vi.fn().mockRejectedValue({ code: "connection.failed" }),
  });
  const dialog = await openDelete(screen);
  await ready(dialog);
  button(dialog).click();
  await expect.poll(() => dialog.actionError).not.toBe("");
  read.mockRejectedValueOnce({ code: "connection.failed" });
  dialog.dispatchEvent(new CustomEvent("wt-delete-retry"));
  await expect.poll(() => dialog.readError).not.toBe("");
  button(dialog, "retry").click();
  await expect.poll(() => dialog.readError).toBe("");
  expect(dialog.actionError).not.toBe("");
  expect(button(dialog).disabled).toBe(false);
});
it("permanent delete live blockers disable the open dialog and their removal enables it", async () => {
  const liveData = new LiveData();
  const read = vi.fn().mockResolvedValue(allowedImpact);
  const { screen } = await mountDelete({ liveData, getStationDeleteImpact: read });
  const dialog = await openDelete(screen);
  await ready(dialog);
  read.mockResolvedValue({
    ...allowedImpact,
    refusals: [
      { code: "station.work_in_progress", params: { stationId: "bar", count: 2 }, targets: [] },
    ],
  });
  liveData.invalidate([{ type: "ticket_items" }]);
  await expect.poll(() => dialog.impact?.refusals.length).toBe(1);
  expect(button(dialog).disabled).toBe(true);
  read.mockResolvedValue(allowedImpact);
  liveData.invalidate([{ type: "ticket_items" }]);
  await expect.poll(() => dialog.impact?.refusals.length).toBe(0);
  expect(button(dialog).disabled).toBe(false);
});
it("permanent delete refreshes a refusal created after the read", async () => {
  const blocked = {
    ...allowedImpact,
    refusals: [
      { code: "station.work_in_progress", params: { stationId: "bar", count: 3 }, targets: [] },
    ],
  };
  const { screen, api } = await mountDelete({
    getStationDeleteImpact: vi.fn().mockResolvedValueOnce(allowedImpact).mockResolvedValue(blocked),
    deleteStation: vi.fn().mockRejectedValue({
      code: "station.work_in_progress",
      params: { stationId: "bar", count: 3 },
    }),
  });
  const dialog = await openDelete(screen);
  await ready(dialog);
  button(dialog).click();
  await expect.poll(() => dialog.impact?.refusals.length).toBe(1);
  expect(dialog.actionError).toBe("3 dishes are still waiting or being prepared.");
  expect(button(dialog).disabled).toBe(true);
  expect(api.deleteStation).toHaveBeenCalledTimes(1);
});
it.each(["confirm", "retry", "close"])(
  "permanent delete ignores a departed %s callback on a same-render replacement",
  async (kind) => {
    const read = vi.fn().mockResolvedValue(allowedImpact);
    const { screen, api } = await mountDelete({ getStationDeleteImpact: read });
    const old = await openDelete(screen);
    await ready(old);
    old.dispatchEvent(new CustomEvent("wt-close"));
    const nextPromise = openDelete(screen);
    old.dispatchEvent(
      new CustomEvent(
        kind === "confirm"
          ? "wt-delete-confirm"
          : kind === "retry"
            ? "wt-delete-retry"
            : "wt-close",
        { detail: { id: "bar" } },
      ),
    );
    const next = await nextPromise;
    await ready(next);
    expect(next).not.toBe(old);
    expect(next.open).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    expect(api.deleteStation).not.toHaveBeenCalled();
  },
);
it.each([false, true])(
  "permanent delete ignores a departed %s write after reconnecting",
  async (refused) => {
    const write = deferred<DeleteImpact>();
    const { screen, host, api } = await mountDelete({
      deleteStation: vi.fn().mockReturnValue(write.promise),
    });
    const old = await openDelete(screen);
    await ready(old);
    button(old).click();
    screen.remove();
    host.append(screen);
    const next = await openDelete(screen);
    await ready(next);
    if (refused) write.reject({ code: "connection.failed" });
    else write.resolve(allowedImpact);
    await Promise.resolve();
    await screen.updateComplete;
    expect(next.open).toBe(true);
    expect(next.actionError).toBe("");
    expect(api.deleteStation).toHaveBeenCalledTimes(1);
  },
);
it("permanent delete ignores a departed read and not-found closes only that target", async () => {
  const oldRead = deferred<DeleteImpact>();
  const read = vi.fn().mockReturnValueOnce(oldRead.promise).mockResolvedValue(allowedImpact);
  const { screen } = await mountDelete({ getStationDeleteImpact: read });
  const old = await openDelete(screen);
  old.dispatchEvent(new CustomEvent("wt-close"));
  const next = await openDelete(screen);
  await ready(next);
  oldRead.resolve({
    ...allowedImpact,
    refusals: [{ code: "station.is_default", params: {}, targets: [] }],
  });
  await Promise.resolve();
  expect(next.impact).toEqual(allowedImpact);
  read.mockRejectedValue({ code: "station.not_found" });
  next.dispatchEvent(new CustomEvent("wt-delete-retry"));
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-delete-dialog")).toBeNull();
});
it("permanent delete closes after a successful write even when refresh fails", async () => {
  const load = vi
    .fn()
    .mockResolvedValueOnce(stationView)
    .mockRejectedValue({ code: "connection.failed" });
  const { screen, api } = await mountDelete({ load });
  const dialog = await openDelete(screen);
  await ready(dialog);
  button(dialog).click();
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-delete-dialog")).toBeNull();
  await expect
    .poll(() => screen.shadowRoot!.querySelector('[role="alert"]')?.textContent)
    .toContain("could not be loaded");
  expect(api.deleteStation).toHaveBeenCalledTimes(1);
});
