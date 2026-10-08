import { html } from "lit";
import type { WtFormActions } from "@waitron/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveData, registerCatalogue } from "@waitron/dashboard-kit";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi, ReaderRow } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale } from "../i18n/t.js";
import type { PaymentsScreen } from "./payments-screen.js";
import "./payments-screen.js";

const reader: ReaderRow = {
  id: "counter",
  provider: "acme",
  name: "Counter",
  active: true,
  canEnable: true,
  deviceCount: 0,
  deviceNames: [],
};
registerCatalogue({ en: { "test.acme": "Acme Pay" }, es: { "test.acme": "Acme Pay" } });
function client(rows = [reader], canUnpair = true, overrides: Partial<DashboardApi> = {}) {
  return Object.assign({
    listPaymentProviders: vi
      .fn()
      .mockResolvedValue([{ providerId: "acme", state: "connected", canUnpair }]),
    listReaders: vi.fn().mockResolvedValue(rows),
    listReaderHolders: vi.fn().mockResolvedValue([]),
    readerStatus: vi.fn().mockResolvedValue({ online: false }),
    listStuckPayments: vi.fn().mockResolvedValue([]),
    listStuckBillPayments: vi.fn().mockResolvedValue([]),
    listStuckBillRefunds: vi.fn().mockResolvedValue([]),
    disableReader: vi.fn().mockResolvedValue(undefined),
    enableReader: vi.fn().mockResolvedValue(undefined),
    unpairReader: vi.fn().mockResolvedValue(undefined),
    liveData: new LiveData(),
    ...overrides,
  }) as unknown as DashboardApi;
}
const q = (el: PaymentsScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);
const cell = (el: PaymentsScreen, selector: string) =>
  q(el, "wt-data-table")!.shadowRoot!.querySelector<HTMLElement>(selector);
async function mount(api = client()) {
  const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
    api,
    panels: [
      {
        providerId: "acme",
        displayNameKey: "test.acme",
        strings: { en: {}, es: {} },
        renderConnectForm: () => html``,
        renderAddReader: () => html``,
      },
    ],
  });
  await vi.waitFor(() => expect(q(el, "wt-combobox[name=reader-status-filter]")).not.toBeNull());
  await chooseOption(q(el, "wt-combobox[name=reader-status-filter]")!, "all");
  await vi.waitFor(() => expect(cell(el, "[data-test=details-counter]")).not.toBeNull());
  return el;
}
async function open(el: PaymentsScreen) {
  cell(el, "[data-test=disable-counter]")!.click();
  await el.updateComplete;
}
async function press(el: PaymentsScreen, selector: string) {
  expect(q(el, selector), `Missing action ${selector}`).not.toBeNull();
  q(el, selector)!.click();
  await el.updateComplete;
}
const checkbox = (el: PaymentsScreen) =>
  el.shadowRoot!.querySelector<HTMLInputElement>("input[name=also-unpair]");
async function tick(el: PaymentsScreen, checked: boolean) {
  expect(checkbox(el), "Missing optional unpair checkbox").not.toBeNull();
  checkbox(el)!.checked = checked;
  checkbox(el)!.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
}
beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/manage/payments/view/readers");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

describe("Disable and optional provider unpairing", () => {
  it("confirms before disabling, hides standalone Unpair for active readers and cancels without writing", async () => {
    const api = client();
    const el = await mount(api);
    expect(cell(el, "[data-test=unpair-counter]")).toBeNull();
    await open(el);
    expect(api.disableReader).not.toHaveBeenCalled();
    expect(api.unpairReader).not.toHaveBeenCalled();
    expect(q(el, "[data-test=reader-editor]")?.getAttribute("heading")).toContain("Counter");
    expect(checkbox(el)?.checked).toBe(false);
    expect(q(el, "[data-test=confirm-disable]")?.getAttribute("variant")).toBe("danger");
    await press(el, "[data-test=close-reader-editor]");
    await vi.waitFor(() => expect(q(el, "[data-test=reader-editor]")).toBeNull());
    expect(api.disableReader).not.toHaveBeenCalled();
    expect(api.unpairReader).not.toHaveBeenCalled();
  });

  it("disables locally by default and closes before a failed refresh", async () => {
    const api = client();
    const el = await mount(api);
    await open(el);
    vi.mocked(api.listReaders).mockRejectedValue({ code: "server.internal" });
    await press(el, "[data-test=confirm-disable]");
    await vi.waitFor(() => expect(q(el, "[data-test=reader-editor]")).toBeNull());
    expect(api.disableReader).toHaveBeenCalledExactlyOnceWith("counter");
    expect(api.unpairReader).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(q(el, "[role=alert]")?.textContent).toContain(codeMessage("server.internal")),
    );
  });

  it.each(["en", "es-ES"])(
    "explains irreversible unpairing, uses only the unpair route and resets the choice on reopen (%s)",
    async (locale) => {
      setLocale(locale);
      const api = client();
      const el = await mount(api);
      await open(el);
      const body = q(el, "[data-test=reader-editor]")!.textContent!;
      expect(body).toContain(
        locale === "en" ? "Also unpair from Acme Pay" : "Desvincular también de Acme Pay",
      );
      expect(body).toContain(locale === "en" ? "cannot be undone" : "no se puede deshacer");
      expect(body).toContain(locale === "en" ? "pairing code" : "código de vinculación");
      await tick(el, true);
      await press(el, "[data-test=confirm-disable]");
      await vi.waitFor(() => expect(q(el, "[data-test=reader-editor]")).toBeNull());
      expect(api.unpairReader).toHaveBeenCalledExactlyOnceWith("counter");
      expect(api.disableReader).not.toHaveBeenCalled();
      await open(el);
      expect(checkbox(el)?.checked).toBe(false);
    },
  );

  it("rechecks provider capability if it changes after optional unpair was selected", async () => {
    const api = client();
    const el = await mount(api);
    await open(el);
    await tick(el, true);
    vi.mocked(api.listPaymentProviders).mockResolvedValue([
      { providerId: "acme", state: "connected", canUnpair: false },
    ]);
    api.liveData!.refresh();
    await vi.waitFor(() => expect(checkbox(el)).toBeNull());
    await press(el, "[data-test=confirm-disable]");
    await vi.waitFor(() => expect(q(el, "[data-test=reader-editor]")).toBeNull());
    expect(api.disableReader).toHaveBeenCalledExactlyOnceWith("counter");
    expect(api.unpairReader).not.toHaveBeenCalled();
  });

  it("offers only local Disable when the provider cannot unpair", async () => {
    const api = client([reader], false);
    const el = await mount(api);
    await open(el);
    expect(checkbox(el)).toBeNull();
    expect(q(el, "[data-test=reader-editor]")!.textContent).not.toContain("pairing code");
    await press(el, "[data-test=confirm-disable]");
    await vi.waitFor(() => expect(q(el, "[data-test=reader-editor]")).toBeNull());
    expect(api.disableReader).toHaveBeenCalledExactlyOnceWith("counter");
    expect(api.unpairReader).not.toHaveBeenCalled();
  });

  it.each([{ paired: true }, { paired: false }])(
    "offers standalone Unpair only for a disabled paired reader ($paired)",
    async ({ paired }) => {
      const api = client([{ ...reader, active: false, canEnable: paired }]);
      const el = await mount(api);
      await chooseOption(q(el, "wt-combobox[name=reader-status-filter]")!, "disabled");
      await el.updateComplete;
      expect(cell(el, "[data-test=disable-counter]")).toBeNull();
      if (!paired) {
        expect(cell(el, "[data-test=unpair-counter]")).toBeNull();
        return;
      }
      cell(el, "[data-test=unpair-counter]")!.click();
      await el.updateComplete;
      expect(api.unpairReader).not.toHaveBeenCalled();
      expect(q(el, "[data-test=reader-editor]")!.textContent).toContain("cannot be undone");
      expect(checkbox(el)).toBeNull();
      await press(el, "[data-test=confirm-unpair]");
      await vi.waitFor(() => expect(q(el, "[data-test=reader-editor]")).toBeNull());
      expect(api.unpairReader).toHaveBeenCalledExactlyOnceWith("counter");
      expect(api.disableReader).not.toHaveBeenCalled();
    },
  );

  it("keeps a refused unpair visible and permits choosing local disable for the retry", async () => {
    const api = client([reader], true, {
      unpairReader: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const el = await mount(api);
    await open(el);
    await tick(el, true);
    await press(el, "[data-test=confirm-disable]");
    await vi.waitFor(async () =>
      expect(
        (
          await formMessageOf(q(el, "[data-test=reader-editor] wt-form-actions")! as WtFormActions)
        )?.textContent?.trim(),
      ).toBe(codeMessage("server.internal")),
    );
    expect(checkbox(el)?.checked).toBe(true);
    expect(q(el, "[data-test=confirm-disable]")!.hasAttribute("disabled")).toBe(false);
    await tick(el, false);
    await press(el, "[data-test=confirm-disable]");
    await vi.waitFor(() => expect(q(el, "[data-test=reader-editor]")).toBeNull());
    expect(api.disableReader).toHaveBeenCalledExactlyOnceWith("counter");
    expect(api.unpairReader).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate submits and freezes the choice while the request is pending", async () => {
    let done!: () => void;
    const api = client([reader], true, {
      disableReader: vi.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          done = resolve;
        }),
      ),
    });
    const el = await mount(api);
    await open(el);
    await press(el, "[data-test=confirm-disable]");
    expect(checkbox(el)?.disabled).toBe(true);
    expect(q(el, "[data-test=confirm-disable]")!.hasAttribute("disabled")).toBe(true);
    await press(el, "[data-test=confirm-disable]");
    expect(api.disableReader).toHaveBeenCalledTimes(1);
    done();
    await vi.waitFor(() => expect(q(el, "[data-test=reader-editor]")).toBeNull());
  });

  it.each(["success", "failure"])(
    "ignores an old disable's late %s after closing and reopening",
    async (outcome) => {
      let done!: () => void;
      let fail!: (error: unknown) => void;
      const pending = new Promise<void>((resolve, reject) => {
        done = resolve;
        fail = reject;
      });
      const api = client([reader], true, { disableReader: vi.fn().mockReturnValue(pending) });
      const el = await mount(api);
      await open(el);
      await press(el, "[data-test=confirm-disable]");
      await press(el, "[data-test=close-reader-editor]");
      await vi.waitFor(() => expect(q(el, "[data-test=reader-editor]")).toBeNull());
      await open(el);
      await tick(el, true);
      if (outcome === "success") done();
      else fail({ code: "server.internal" });
      await pending.catch(() => undefined);
      await el.updateComplete;
      await vi.waitFor(() =>
        expect(q(el, "[data-test=confirm-disable]")!.hasAttribute("disabled")).toBe(false),
      );
      expect(q(el, "[data-test=reader-editor]")).not.toBeNull();
      expect(checkbox(el)?.checked).toBe(true);
      expect(
        await formMessageOf(q(el, "[data-test=reader-editor] wt-form-actions")! as WtFormActions),
      ).toBeNull();
    },
  );
});
