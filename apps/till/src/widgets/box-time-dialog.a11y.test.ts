import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./box-time-dialog.js";
import type { BoxTimeApi, TillBoxTimeDialog } from "./box-time-dialog.js";

const TILL_AT = Date.UTC(2026, 9, 31, 16, 45);

afterEach(() => {
  vi.restoreAllMocks();
  cleanupWidgets();
});

function api(boxAt: number, confirm: BoxTimeApi["boxClockConfirm"]): BoxTimeApi {
  return {
    boxClockChallenge: () =>
      Promise.resolve({ challengeId: "c1", boxAt: new Date(boxAt).toISOString() }),
    boxClockConfirm: confirm,
    listAdjustmentApprovers: () => Promise.resolve([{ personId: "p1", displayName: "Alex Admin" }]),
  };
}

const confirmed: BoxTimeApi["boxClockConfirm"] = () =>
  Promise.resolve({
    confirmationId: "k1",
    stepMs: 0,
    confirmedAt: new Date(TILL_AT).toISOString(),
  });

async function settle(el: TillBoxTimeDialog): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

async function press(el: TillBoxTimeDialog, name: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-box-time="${name}"]`)!.click();
  await settle(el);
}

describe.each(["light", "dark"] as const)("till-box-time-dialog a11y (%s theme)", (theme) => {
  async function open(boxAt: number, confirm: BoxTimeApi["boxClockConfirm"] = confirmed) {
    vi.spyOn(Date, "now").mockReturnValue(TILL_AT);
    const { el, host } = await mountWidget<TillBoxTimeDialog>(
      "till-box-time-dialog",
      { api: api(boxAt, confirm) },
      theme,
    );
    await settle(el);
    return { el, host };
  }

  it("has no violations when this till differs", async () => {
    const { host } = await open(Date.UTC(2001, 0, 2, 3, 4));
    await expectNoA11yViolations(host);
  });

  it("has no violations when this till agrees", async () => {
    const { host } = await open(TILL_AT - 10_000);
    await expectNoA11yViolations(host);
  });

  it("has no violations with a refusal above the buttons", async () => {
    const { el, host } = await open(TILL_AT, () =>
      Promise.reject({ code: "clock.set_refused", reason: "stale" }),
    );
    await press(el, "primary");
    await expectNoA11yViolations(host);
  });

  it("has no violations with the administrator sign-in open", async () => {
    const { el, host } = await open(TILL_AT, () =>
      Promise.reject({ code: "clock.set_refused", reason: "not_start_up" }),
    );
    await press(el, "primary");
    await press(el, "admin");
    await expectNoA11yViolations(host);
  });

  it("has no violations once the time is confirmed", async () => {
    const { el, host } = await open(TILL_AT);
    await press(el, "primary");
    await expectNoA11yViolations(host);
  });
});
