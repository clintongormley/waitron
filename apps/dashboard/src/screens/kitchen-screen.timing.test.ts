import { LiveData, setLocale } from "@waitron/dashboard-kit";
import type { WtInput } from "@waitron/ui";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { DashboardApi } from "../api/client.js";
import { KitchenScreen } from "./kitchen-screen.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
const defaults = { warmAfterMinutes: 3, overdueAfterMinutes: 7, forgottenAfterMinutes: 12 };
function api(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getBumpMode: vi.fn().mockResolvedValue({ mode: "line" }),
    getFireControl: vi.fn().mockResolvedValue({ mode: "waiter" }),
    listCourses: vi.fn().mockResolvedValue([]),
    getKitchenTimingDefaults: vi.fn().mockResolvedValue({ ...defaults }),
    setKitchenTimingDefaults: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}
const q = (el: KitchenScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);
async function mount(a: DashboardApi = api(), readOnly = false) {
  setLocale("en");
  const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api: a, readOnly });
  await vi.waitFor(() =>
    expect(q(el, '[data-test="timing-values"]')?.textContent ?? "").toContain("3"),
  );
  return el;
}
async function open(el: KitchenScreen) {
  q(el, '[data-test="edit-timing"]')!.click();
  await el.updateComplete;
}
async function change(el: KitchenScreen, name: string, value: string) {
  const input = q(el, `wt-input[name="${name}"]`) as WtInput;
  input.value = value;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}
async function save(el: KitchenScreen) {
  q(el, '[data-test="save-timing"]')!.click();
  await el.updateComplete;
}
it("loads saved late flags and saves the three defaults together", async () => {
  const a = api({
    getKitchenTimingDefaults: vi.fn().mockResolvedValueOnce(defaults).mockResolvedValue({
      warmAfterMinutes: 4,
      overdueAfterMinutes: 8,
      forgottenAfterMinutes: 16,
    }),
  });
  const el = await mount(a);
  expect(q(el, '[data-test="timing-values"]')!.textContent).toContain("7");
  expect(q(el, '[data-test="timing-values"]')!.textContent).toContain("12");
  await open(el);
  for (const [name, value] of [
    ["warmAfterMinutes", "4"],
    ["overdueAfterMinutes", "8"],
    ["forgottenAfterMinutes", "16"],
  ]) {
    expect(q(el, `wt-input[name="${name}"]`)!.hasAttribute("required")).toBe(true);
    await change(el, name!, value!);
  }
  await save(el);
  await vi.waitFor(() => expect(q(el, '[data-test="timing-form"]')).toBeNull());
  expect(a.setKitchenTimingDefaults).toHaveBeenCalledExactlyOnceWith({
    warmAfterMinutes: 4,
    overdueAfterMinutes: 8,
    forgottenAfterMinutes: 16,
  });
  await vi.waitFor(() => expect(q(el, '[data-test="timing-values"]')!.textContent).toContain("16"));
  expect(el.shadowRoot!.querySelectorAll("h1")).toHaveLength(0);
});
it("shows every invalid whole-minute field after submission and re-enables Save when fixed", async () => {
  const a = api();
  const el = await mount(a);
  await open(el);
  await change(el, "warmAfterMinutes", "");
  await change(el, "overdueAfterMinutes", "1.5");
  await change(el, "forgottenAfterMinutes", "2147483648");
  await vi.waitFor(() =>
    expect(
      (q(el, '[data-test="save-timing"]') as HTMLElement & { disabled: boolean }).disabled,
    ).toBe(false),
  );
  await save(el);
  expect(a.setKitchenTimingDefaults).not.toHaveBeenCalled();
  for (const name of ["warmAfterMinutes", "overdueAfterMinutes", "forgottenAfterMinutes"])
    expect((q(el, `wt-input[name="${name}"]`) as WtInput).error).toBe(t("kitchen.timing_positive"));
  expect(
    q(el, "wt-form-actions")!.shadowRoot!.querySelector('[role="alert"]')?.textContent ?? "",
  ).toBe(t("form.fix_fields"));
  expect((q(el, '[data-test="save-timing"]') as HTMLElement & { disabled: boolean }).disabled).toBe(
    true,
  );
  expect(a.setKitchenTimingDefaults).not.toHaveBeenCalled();
  await change(el, "warmAfterMinutes", "4");
  await change(el, "overdueAfterMinutes", "7");
  await change(el, "forgottenAfterMinutes", "12");
  expect((q(el, '[data-test="save-timing"]') as HTMLElement & { disabled: boolean }).disabled).toBe(
    false,
  );
  expect(
    q(el, "wt-form-actions")!.shadowRoot!.querySelector('[role="alert"]')?.textContent ?? "",
  ).toBe("");
});
it.each([
  ["overdueAfterMinutes", "3", "kitchen.timing_after_warm"],
  ["forgottenAfterMinutes", "7", "kitchen.timing_after_overdue"],
] as const)("refuses unordered %s locally beside that field", async (name, value, message) => {
  const a = api();
  const el = await mount(a);
  await open(el);
  await change(el, name, value);
  await save(el);
  expect(a.setKitchenTimingDefaults).not.toHaveBeenCalled();
  expect((q(el, `wt-input[name="${name}"]`) as WtInput).error).toBe(t(message));
  expect(a.setKitchenTimingDefaults).not.toHaveBeenCalled();
});
it("names the station a venue change would break, marks the returned field and permits retry", async () => {
  const a = api({
    setKitchenTimingDefaults: vi
      .fn()
      .mockRejectedValueOnce({
        code: "station.thresholds_invalid",
        params: { field: "overdueAfterMinutes", stationId: "grill", name: "Grill" },
      })
      .mockResolvedValue(undefined),
  });
  const el = await mount(a);
  await open(el);
  await change(el, "overdueAfterMinutes", "8");
  await save(el);
  await vi.waitFor(() =>
    expect((q(el, 'wt-input[name="overdueAfterMinutes"]') as WtInput).error).toContain("Grill"),
  );
  expect(q(el, '[data-test="timing-form"]')).not.toBeNull();
  await vi.waitFor(() =>
    expect(
      (q(el, '[data-test="save-timing"]') as HTMLElement & { disabled: boolean }).disabled,
    ).toBe(false),
  );
  await save(el);
  await vi.waitFor(() => expect(q(el, '[data-test="timing-form"]')).toBeNull());
  expect(a.setKitchenTimingDefaults).toHaveBeenCalledTimes(2);
});
it("keeps a refusal and typed values when a failed read recovers", async () => {
  const liveData = new LiveData();
  const a = api({
    liveData,
    getKitchenTimingDefaults: vi
      .fn()
      .mockResolvedValueOnce(defaults)
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockResolvedValue({
        warmAfterMinutes: 4,
        overdueAfterMinutes: 9,
        forgottenAfterMinutes: 18,
      }),
    setKitchenTimingDefaults: vi.fn().mockRejectedValue({ code: "connection.failed" }),
  });
  const el = await mount(a);
  await open(el);
  await change(el, "warmAfterMinutes", "2");
  liveData.refresh();
  await vi.waitFor(() =>
    expect(q(el, '[data-test="kitchen-error"]')?.textContent).toBe(
      codeMessage("connection.failed"),
    ),
  );
  await save(el);
  await vi.waitFor(() =>
    expect(
      q(el, "wt-form-actions")!.shadowRoot!.querySelector('[role="alert"]')?.textContent ?? "",
    ).toBe(codeMessage("connection.failed")),
  );
  liveData.refresh();
  await vi.waitFor(() => expect(a.getKitchenTimingDefaults).toHaveBeenCalledTimes(3));
  expect((q(el, 'wt-input[name="warmAfterMinutes"]') as WtInput).value).toBe("2");
  expect(
    q(el, "wt-form-actions")!.shadowRoot!.querySelector('[role="alert"]')?.textContent ?? "",
  ).toBe(codeMessage("connection.failed"));
  await vi.waitFor(() => expect(q(el, '[data-test="kitchen-error"]')).toBeNull());
});
it("closes a successful save even when refreshing defaults fails", async () => {
  const a = api({
    getKitchenTimingDefaults: vi
      .fn()
      .mockResolvedValueOnce(defaults)
      .mockRejectedValue({ code: "connection.failed" }),
  });
  const el = await mount(a);
  await open(el);
  await change(el, "warmAfterMinutes", "4");
  await save(el);
  await vi.waitFor(() => expect(q(el, '[data-test="timing-form"]')).toBeNull());
  await vi.waitFor(() =>
    expect(q(el, '[data-test="kitchen-error"]')?.textContent).toBe(
      codeMessage("connection.failed"),
    ),
  );
  expect(a.setKitchenTimingDefaults).toHaveBeenCalledTimes(1);
});
it("Cancel discards the draft and resets validation on reopening", async () => {
  const a = api();
  const el = await mount(a);
  await open(el);
  await change(el, "warmAfterMinutes", "0");
  await save(el);
  q(el, '[data-test="cancel-timing"]')!.click();
  await el.updateComplete;
  await open(el);
  expect((q(el, 'wt-input[name="warmAfterMinutes"]') as WtInput).value).toBe("3");
  expect((q(el, 'wt-input[name="warmAfterMinutes"]') as WtInput).error).toBe("");
  expect(a.setKitchenTimingDefaults).not.toHaveBeenCalled();
});
it("shows supervisor defaults without editing or write controls", async () => {
  const a = api();
  const el = await mount(a, true);
  expect(q(el, '[data-test="edit-timing"]')).toBeNull();
  expect(q(el, '[data-test="timing-values"]')!.textContent).toContain("12");
  expect(a.setKitchenTimingDefaults).not.toHaveBeenCalled();
});

it("refreshes saved defaults when their source changes, preserving an open draft", async () => {
  const liveData = new LiveData();
  const a = api({
    liveData,
    getKitchenTimingDefaults: vi.fn().mockResolvedValueOnce(defaults).mockResolvedValue({
      warmAfterMinutes: 4,
      overdueAfterMinutes: 9,
      forgottenAfterMinutes: 18,
    }),
  });
  const el = await mount(a);
  await open(el);
  await change(el, "warmAfterMinutes", "2");
  liveData.invalidate([{ type: "kitchen_timing_defaults", id: "venue" }]);
  await vi.waitFor(() => expect(a.getKitchenTimingDefaults).toHaveBeenCalledTimes(2));
  expect((q(el, 'wt-input[name="warmAfterMinutes"]') as WtInput).value).toBe("2");
  q(el, '[data-test="cancel-timing"]')!.click();
  await el.updateComplete;
  await vi.waitFor(() => expect(q(el, '[data-test="timing-values"]')!.textContent).toContain("18"));
  await open(el);
  expect((q(el, 'wt-input[name="warmAfterMinutes"]') as WtInput).value).toBe("4");
});
it("Escape discards late-flag edits and Enter saves the next valid draft", async () => {
  const a = api();
  const el = await mount(a);
  await open(el);
  await change(el, "warmAfterMinutes", "2");
  q(el, 'wt-input[name="warmAfterMinutes"]')!
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
  await el.updateComplete;
  expect(q(el, '[data-test="timing-form"]')).toBeNull();
  expect(a.setKitchenTimingDefaults).not.toHaveBeenCalled();
  await open(el);
  await change(el, "warmAfterMinutes", "1");
  q(el, 'wt-input[name="warmAfterMinutes"]')!
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await vi.waitFor(() =>
    expect(a.setKitchenTimingDefaults).toHaveBeenCalledExactlyOnceWith({
      warmAfterMinutes: 1,
      overdueAfterMinutes: 7,
      forgottenAfterMinutes: 12,
    }),
  );
  await vi.waitFor(() => expect(q(el, '[data-test="timing-form"]')).toBeNull());
});
it("a pending defaults read shows loading then its refusal and recovers without invented values", async () => {
  const liveData = new LiveData();
  let refuse!: (error: unknown) => void;
  const a = api({
    liveData,
    getKitchenTimingDefaults: vi
      .fn()
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          refuse = reject;
        }),
      )
      .mockResolvedValue(defaults),
  });
  setLocale("en");
  const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api: a });
  expect(el.shadowRoot!.textContent).toContain("Loading late flags…");
  expect(q(el, '[data-test="timing-values"]')).toBeNull();
  expect(q(el, '[data-test="edit-timing"]')).toBeNull();
  refuse({ code: "connection.failed" });
  await vi.waitFor(() =>
    expect(q(el, '[data-test="kitchen-error"]')?.textContent).toBe(
      codeMessage("connection.failed"),
    ),
  );
  liveData.refresh();
  await vi.waitFor(() => expect(q(el, '[data-test="timing-values"]')?.textContent).toContain("12"));
  await vi.waitFor(() => expect(q(el, '[data-test="kitchen-error"]')).toBeNull());
});
it("sends one defaults write while Save is pending and cannot discard its draft", async () => {
  let complete!: () => void;
  const a = api({
    setKitchenTimingDefaults: vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    ),
  });
  const el = await mount(a);
  await open(el);
  await change(el, "warmAfterMinutes", "4");
  await save(el);
  await save(el);
  expect(a.setKitchenTimingDefaults).toHaveBeenCalledTimes(1);
  expect(q(el, '[data-test="save-timing"]')!.shadowRoot!.querySelector("button")!.disabled).toBe(
    true,
  );
  expect(q(el, '[data-test="cancel-timing"]')!.shadowRoot!.querySelector("button")!.disabled).toBe(
    true,
  );
  q(el, 'wt-input[name="warmAfterMinutes"]')!
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
  await el.updateComplete;
  expect(q(el, '[data-test="timing-form"]')).not.toBeNull();
  complete();
  await vi.waitFor(() => expect(q(el, '[data-test="timing-form"]')).toBeNull());
});
