import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DashboardApi, DailyReportSettingsView } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import "./daily-report-mail-form.js";

type Form = HTMLElementTagNameMap["dashboard-daily-report-mail-form"];

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const OFFLINE = "This browser could not connect to Waitron. Check your connection and try again.";
const RECIPIENTS = [
  { id: "staff-1", name: "Alex" },
  { id: "staff-2", name: "Sam" },
];
const view = (overrides: Partial<DailyReportSettingsView> = {}): DailyReportSettingsView => ({
  enabled: true,
  recipientIds: ["staff-1"],
  revision: 3,
  recipients: RECIPIENTS,
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function mount(api: Partial<DashboardApi>) {
  const { el } = await mountWidget<Form>("dashboard-daily-report-mail-form", {
    api: api as DashboardApi,
  });
  return el;
}

const q = <T extends HTMLElement>(el: Form, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const save = (el: Form) =>
  q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=daily-report-save]")!;
const recipient = (el: Form, name: string) =>
  [
    ...el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-switch"]>(
      "[data-test=daily-report-recipient]",
    ),
  ].find((control) => control.label === name)!;
const message = async (el: Form) =>
  (
    await formMessageOf(q<HTMLElementTagNameMap["wt-form-actions"]>(el, "wt-form-actions")!)
  )?.textContent?.trim() ?? "";

async function flip(el: Form, control: HTMLElement, checked: boolean) {
  control.dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

it("explains a failed read without a form, and shows the form after Retry", async () => {
  const getDailyReportSettings = vi
    .fn()
    .mockRejectedValueOnce({ code: "connection.failed" })
    .mockResolvedValueOnce(view());
  const el = await mount({ getDailyReportSettings });
  await vi.waitFor(() => expect(q(el, "[role=alert]")?.textContent?.trim()).toBe(OFFLINE));
  expect(q(el, "[data-test=daily-report-enabled]")).toBeNull();

  q<HTMLElementTagNameMap["wt-button"]>(el, "wt-button")!.click();
  await vi.waitFor(() => expect(q(el, "[data-test=daily-report-enabled]")).not.toBeNull());
  expect(q(el, "[role=alert]")).toBeNull();
  expect(recipient(el, "Alex").checked).toBe(true);
  expect(getDailyReportSettings).toHaveBeenCalledTimes(2);
});

it("keeps a refused draft and asks for a reload when the settings changed elsewhere", async () => {
  const saveDailyReportSettings = vi.fn().mockRejectedValue({ code: "settings.out_of_date" });
  const el = await mount({
    getDailyReportSettings: vi.fn().mockResolvedValue(view()),
    saveDailyReportSettings,
  });
  await vi.waitFor(() => expect(recipient(el, "Sam")).toBeDefined());
  await flip(el, recipient(el, "Sam"), true);
  save(el).click();
  await vi.waitFor(async () =>
    expect(await message(el)).toBe("These settings changed elsewhere. Reload Email and try again."),
  );
  expect(saveDailyReportSettings).toHaveBeenCalledExactlyOnceWith({
    enabled: true,
    revision: 3,
    recipientIds: ["staff-1", "staff-2"],
  });
  expect(recipient(el, "Sam").checked).toBe(true);
  expect(save(el).disabled).toBe(false);
});

it("shows any other save refusal in the person's language", async () => {
  const el = await mount({
    getDailyReportSettings: vi.fn().mockResolvedValue(view()),
    saveDailyReportSettings: vi.fn().mockRejectedValue({ code: "connection.failed" }),
  });
  await vi.waitFor(() => expect(recipient(el, "Sam")).toBeDefined());
  await flip(el, recipient(el, "Sam"), true);
  save(el).click();
  await vi.waitFor(async () => expect(await message(el)).toBe(OFFLINE));
});

it("asks for a recipient when the only one is switched off, and does not save", async () => {
  const saveDailyReportSettings = vi.fn();
  const el = await mount({
    getDailyReportSettings: vi.fn().mockResolvedValue(view()),
    saveDailyReportSettings,
  });
  await vi.waitFor(() => expect(recipient(el, "Alex")).toBeDefined());
  await flip(el, recipient(el, "Alex"), false);
  expect(recipient(el, "Alex").checked).toBe(false);
  expect(el.shadowRoot!.textContent).toContain(
    "Choose at least one person who can view Sales & takings.",
  );
  expect(save(el).disabled).toBe(true);
  expect(save(el).variant).toBe("secondary");
  save(el).click();
  await el.updateComplete;
  expect(saveDailyReportSettings).not.toHaveBeenCalled();
});

it("ignores changes and a second Save while a save is being sent", async () => {
  const sending = deferred<DailyReportSettingsView>();
  const saveDailyReportSettings = vi.fn().mockReturnValue(sending.promise);
  const el = await mount({
    getDailyReportSettings: vi.fn().mockResolvedValue(view()),
    saveDailyReportSettings,
  });
  const enabled = () =>
    q<HTMLElementTagNameMap["wt-switch"]>(el, "[data-test=daily-report-enabled]")!;
  await vi.waitFor(() => expect(enabled()).not.toBeNull());
  await flip(el, enabled(), false);
  save(el).click();
  await el.updateComplete;
  expect(enabled().disabled).toBe(true);

  await flip(el, enabled(), true);
  expect(enabled().checked).toBe(false);
  expect(q(el, "fieldset")).toBeNull();
  save(el).click();
  await el.updateComplete;
  expect(saveDailyReportSettings).toHaveBeenCalledOnce();

  sending.resolve({ enabled: false, recipientIds: ["staff-1"], revision: 4, recipients: [] });
  await vi.waitFor(() => expect(enabled().disabled).toBe(false));
  expect(save(el).disabled).toBe(true);
});

it.each([
  ["answers", (load: ReturnType<typeof deferred<DailyReportSettingsView>>) => load.resolve(view())],
  [
    "fails",
    (load: ReturnType<typeof deferred<DailyReportSettingsView>>) =>
      load.reject({ code: "connection.failed" }),
  ],
])("draws nothing from a read that %s after the form left the page", async (_, finish) => {
  const load = deferred<DailyReportSettingsView>();
  const el = await mount({ getDailyReportSettings: vi.fn().mockReturnValue(load.promise) });
  el.remove();
  finish(load);
  await load.promise.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(q(el, "[data-test=daily-report-enabled]")).toBeNull();
  expect(q(el, "[role=alert]")).toBeNull();
});

it.each([
  [
    "answers",
    (save: ReturnType<typeof deferred<DailyReportSettingsView>>) =>
      save.resolve(view({ enabled: false, revision: 4 })),
  ],
  [
    "fails",
    (save: ReturnType<typeof deferred<DailyReportSettingsView>>) =>
      save.reject({ code: "connection.failed" }),
  ],
])(
  "leaves the form's own save alone when an earlier save %s after the form left and came back",
  async (_, finish) => {
    const earlier = deferred<DailyReportSettingsView>();
    const later = deferred<DailyReportSettingsView>();
    const saveDailyReportSettings = vi
      .fn()
      .mockReturnValueOnce(earlier.promise)
      .mockReturnValueOnce(later.promise);
    const el = await mount({
      getDailyReportSettings: vi.fn().mockResolvedValue(view()),
      saveDailyReportSettings,
    });
    const enabled = () =>
      q<HTMLElementTagNameMap["wt-switch"]>(el, "[data-test=daily-report-enabled]");
    await vi.waitFor(() => expect(enabled()).not.toBeNull());
    await flip(el, enabled()!, false);
    save(el).click();
    const host = el.parentElement!;
    el.remove();
    host.append(el);
    await vi.waitFor(() => expect(recipient(el, "Sam")).toBeDefined());
    await flip(el, recipient(el, "Sam"), true);
    save(el).click();
    await el.updateComplete;
    expect(enabled()!.disabled).toBe(true);

    finish(earlier);
    await earlier.promise.catch(() => undefined);
    await el.updateComplete;
    expect(enabled()!.disabled).toBe(true);
    expect(enabled()!.checked).toBe(true);
    expect(recipient(el, "Sam").checked).toBe(true);
    expect(await message(el)).toBe("");

    later.resolve(view({ recipientIds: ["staff-1", "staff-2"], revision: 4 }));
    await vi.waitFor(() => expect(enabled()!.disabled).toBe(false));
    expect(save(el).disabled).toBe(true);
    expect(saveDailyReportSettings).toHaveBeenNthCalledWith(2, {
      enabled: true,
      revision: 3,
      recipientIds: ["staff-1", "staff-2"],
    });
  },
);
