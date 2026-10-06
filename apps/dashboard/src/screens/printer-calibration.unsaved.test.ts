import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons, type WtModal } from "@waitron/ui";
import type { DashboardApi, Printer } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { PrintersScreen } from "./printers-screen.js";

registerIcons(DASHBOARD_ICONS);
const printer: Printer = {
  id: "p1",
  name: "Kitchen",
  transport: "network_tcp",
  host: "10.0.0.9",
  port: 9100,
  localKey: null,
  pollId: null,
  watcherId: null,
  paperWidth: "80mm",
  resolution: "180dpi",
  hasCashDrawer: false,
  pendingJobs: 0,
  lastPrintAt: null,
  lastPrintAgentId: null,
  active: true,
};
const other = { ...printer, id: "p2", name: "Bar" };
class CalibrationLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-printers-screen .api=${this.api}></dashboard-printers-screen
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("printer-calibration-leave-test-app", CalibrationLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
function q(screen: PrintersScreen, selector: string): HTMLElement | null {
  function find(root: ShadowRoot | HTMLElement): HTMLElement | null {
    const found = root.querySelector<HTMLElement>(selector);
    if (found) return found;
    for (const child of root.querySelectorAll<HTMLElement>("*")) {
      if (child.shadowRoot) {
        const nested = find(child.shadowRoot);
        if (nested) return nested;
      }
    }
    return null;
  }
  return find(screen.shadowRoot!);
}
async function mount(overrides: Partial<DashboardApi> = {}) {
  setLocale("en-GB");
  const { el: app } = await mountWidget<CalibrationLeaveApp>("printer-calibration-leave-test-app", {
    api: {
      listAgents: async () => [],
      listPrinters: async () => [printer, other],
      listRecentJobs: async () => [],
      listPrinterProfiles: async () => [],
      pairingMode: async () => ({
        open: false,
        openUntil: null,
        deviceAddress: "https://waitron.local",
      }),
      joinRequests: async () => [],
      listDiscoveredPrinters: async () => [],
      updatePrinter: async () => {},
      testPrint: async () => ({ jobId: "ruler" }),
      sampleReceipt: async () => ({ jobId: "sample" }),
      testPrinterDrawer: async () => ({ jobId: "drawer" }),
      ...overrides,
    } as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-printers-screen")!;
  await expect.poll(() => q(screen, "[data-test=printer-row-p1]")).not.toBeNull();
  await open(screen, "p1");
  return { app, screen };
}
async function open(screen: PrintersScreen, id: string) {
  const row = q(screen, `[data-test=printer-row-${id}]`);
  if (row) row.click();
  else {
    q(screen, "[data-test=all-printers-link]")!.click();
    await screen.updateComplete;
    await expect.poll(() => q(screen, `[data-test=printer-row-${id}]`)).not.toBeNull();
    q(screen, `[data-test=printer-row-${id}]`)!.click();
  }
  await screen.updateComplete;
  q(screen, "[data-test=printer-section-calibration]")!
    .shadowRoot!.querySelector<HTMLButtonElement>("button")!
    .click();
  await screen.updateComplete;
  q(screen, "[data-test=calibrate-printer-details]")!.click();
  await screen.updateComplete;
  await modal(screen)!.updateComplete;
}
function modal(screen: PrintersScreen) {
  return q(screen, "[data-test=edit-printer-modal]") as WtModal | null;
}
function field(screen: PrintersScreen, name: string) {
  return q(screen, `[name="${name}"]`) as HTMLElement & {
    value: string;
    checked: boolean;
    updateComplete: Promise<unknown>;
  };
}
function change(screen: PrintersScreen, name: string, value: string | boolean) {
  field(screen, name).dispatchEvent(
    new CustomEvent("wt-change", {
      detail: typeof value === "boolean" ? { checked: value } : { value },
    }),
  );
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
async function choose(app: CalibrationLeaveApp, decision: "keep" | "discard") {
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open, { timeout: 1000 }).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}
async function lastStep(screen: PrintersScreen) {
  for (let i = 0; i < 2; i++) {
    q(screen, "[data-test=calibration-next]")!.click();
    await screen.updateComplete;
  }
}

for (const route of ["cancel", "escape"] as const) {
  it(`calibration ${route} retains settings and focus until Discard`, async () => {
    const { app, screen } = await mount();
    change(screen, "printer-paper-width", "58mm");
    await screen.updateComplete;
    await field(screen, "printer-paper-width").updateComplete;
    const control = field(
      screen,
      "printer-paper-width",
    ).shadowRoot!.querySelector<HTMLButtonElement>("button")!;
    control.focus();
    let closes = 0;
    modal(screen)!.addEventListener("wt-close", () => closes++);
    const dismiss = async () => {
      if (route === "cancel") q(screen, "[data-test=cancel-edit-printer]")!.click();
      else await userEvent.keyboard("{Escape}");
    };
    await dismiss();
    await choose(app, "keep");
    expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(field(screen, "printer-paper-width").value).toBe("58mm");
    expect(closes).toBe(0);
    await expect
      .poll(() => field(screen, "printer-paper-width").shadowRoot!.activeElement)
      .toBe(control);
    await dismiss();
    await choose(app, "discard");
    await expect.poll(() => modal(screen)).toBeNull();
    expect(closes).toBe(1);
    expect(unload()).toBe(false);
    q(screen, "[data-test=calibrate-printer-details]")!.click();
    await screen.updateComplete;
    expect(field(screen, "printer-paper-width").value).toBe("80mm");
  });
}
for (const [name, changed, initial] of [
  ["printer-paper-width", "58mm", "80mm"],
  ["printer-resolution", "203dpi", "180dpi"],
  ["printer-cash-drawer", true, false],
] as const) {
  it(`calibration unload tracks ${name} and its revert`, async () => {
    const { app, screen } = await mount();
    expect(unload()).toBe(false);
    change(screen, name, changed);
    expect(unload()).toBe(true);
    change(screen, name, initial);
    expect(unload()).toBe(false);
    q(screen, "[data-test=cancel-edit-printer]")!.click();
    await expect.poll(() => modal(screen)).toBeNull();
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  });
}
it("calibration steps and test results alone are exempt", async () => {
  const { app, screen } = await mount();
  change(screen, "printer-ruler-number", "512");
  q(screen, "[data-test=print-ruler-p1]")!.click();
  await expect
    .poll(() => q(screen, "[data-test=print-ruler-p1]")!.hasAttribute("loading"))
    .toBe(false);
  await lastStep(screen);
  expect(unload()).toBe(false);
  q(screen, "[data-test=calibration-back]")!.click();
  await screen.updateComplete;
  expect(field(screen, "printer-ruler-number").value).toBe("512");
  q(screen, "[data-test=cancel-edit-printer]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});
it("ruler-derived paper settings stay dirty across wizard steps", async () => {
  const { app, screen } = await mount();
  change(screen, "printer-ruler-number", "360");
  await screen.updateComplete;
  expect(field(screen, "printer-paper-width").value).toBe("58mm");
  await lastStep(screen);
  expect(unload()).toBe(true);
  q(screen, "[data-test=cancel-edit-printer]")!.click();
  await choose(app, "keep");
  expect(q(screen, "[data-test=calibration-step-3]")!.checkVisibility()).toBe(true);
});
it("calibration success commits before a refused refresh", async () => {
  let reads = 0;
  let dirtyAtRefresh: boolean | undefined;
  let received: unknown;
  const { app, screen } = await mount({
    listPrinters: async () => {
      if (++reads > 1) {
        dirtyAtRefresh = unload();
        throw { code: "connection.failed" };
      }
      return [printer, other];
    },
    updatePrinter: async (id, patch) => {
      received = { id, patch };
    },
  });
  change(screen, "printer-paper-width", "58mm");
  change(screen, "printer-resolution", "203dpi");
  change(screen, "printer-cash-drawer", true);
  await lastStep(screen);
  q(screen, "[data-test=save-printer-p1]")!.click();
  await expect.poll(() => q(screen, "[data-test=printer-refresh-error]")).not.toBeNull();
  expect(received).toEqual({
    id: "p1",
    patch: { paperWidth: "58mm", resolution: "203dpi", hasCashDrawer: true },
  });
  expect(dirtyAtRefresh).toBe(false);
  expect(unload()).toBe(false);
  expect(modal(screen)).toBeNull();
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});
it("a refused calibration save preserves settings and warning", async () => {
  const { app, screen } = await mount({
    updatePrinter: async () => {
      throw { code: "connection.failed" };
    },
  });
  change(screen, "printer-paper-width", "58mm");
  await lastStep(screen);
  q(screen, "[data-test=save-printer-p1]")!.click();
  await expect
    .poll(
      () =>
        (
          q(
            screen,
            "[data-test=edit-printer-modal] wt-form-actions",
          ) as HTMLElementTagNameMap["wt-form-actions"]
        ).error,
    )
    .toContain(codeMessage("connection.failed"));
  expect(field(screen, "printer-paper-width").value).toBe("58mm");
  expect(unload()).toBe(true);
  q(screen, "[data-test=cancel-edit-printer]")!.click();
  await choose(app, "keep");
});
it("a successful captured calibration retains newer input and compares against saved settings", async () => {
  let finish!: () => void;
  let received: unknown;
  const { app, screen } = await mount({
    updatePrinter: async (_id, patch) => {
      received = patch;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  });
  change(screen, "printer-paper-width", "58mm");
  await lastStep(screen);
  q(screen, "[data-test=save-printer-p1]")!.click();
  await expect.poll(() => typeof finish).toBe("function");
  change(screen, "printer-resolution", "203dpi");
  finish();
  await expect
    .poll(() => q(screen, "[data-test=save-printer-p1]")?.hasAttribute("loading"))
    .toBe(false);
  expect(received).toEqual({ paperWidth: "58mm" });
  expect(modal(screen)).not.toBeNull();
  expect(field(screen, "printer-resolution").value).toBe("203dpi");
  expect(unload()).toBe(true);
  change(screen, "printer-resolution", "180dpi");
  expect(unload()).toBe(false);
  q(screen, "[data-test=cancel-edit-printer]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});
it("calibration disconnect cancels the question and unload protection", async () => {
  const { app, screen } = await mount();
  change(screen, "printer-paper-width", "58mm");
  expect(unload()).toBe(true);
  q(screen, "[data-test=cancel-edit-printer]")!.click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  screen.remove();
  expect(unload()).toBe(false);
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});
it("calibration retains direct dismissal during a submitted save", async () => {
  let finish!: () => void;
  const { app, screen } = await mount({
    updatePrinter: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  change(screen, "printer-paper-width", "58mm");
  await lastStep(screen);
  q(screen, "[data-test=save-printer-p1]")!.click();
  await expect.poll(() => typeof finish).toBe("function");
  q(screen, "[data-test=cancel-edit-printer]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  expect(unload()).toBe(false);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  finish();
});
it("calibration retains direct dismissal while a ruler command runs", async () => {
  let finish!: (value: { jobId: string }) => void;
  const { app, screen } = await mount({
    testPrint: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  change(screen, "printer-paper-width", "58mm");
  q(screen, "[data-test=print-ruler-p1]")!.click();
  await expect.poll(() => typeof finish).toBe("function");
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => modal(screen)).toBeNull();
  expect(unload()).toBe(false);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  finish({ jobId: "ruler" });
});

it("a second calibration save sends only the still-unsaved settings", async () => {
  let finish!: () => void;
  const writes: unknown[] = [];
  const { screen } = await mount({
    updatePrinter: async (_id, patch) => {
      writes.push(patch);
      if (writes.length === 1)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
    },
  });
  change(screen, "printer-paper-width", "58mm");
  await lastStep(screen);
  q(screen, "[data-test=save-printer-p1]")!.click();
  await expect.poll(() => typeof finish).toBe("function");
  change(screen, "printer-resolution", "203dpi");
  finish();
  await expect
    .poll(() => q(screen, "[data-test=save-printer-p1]")?.hasAttribute("loading"))
    .toBe(false);
  q(screen, "[data-test=save-printer-p1]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
  expect(writes).toEqual([{ paperWidth: "58mm" }, { resolution: "203dpi" }]);
  expect(unload()).toBe(false);
});
for (const result of ["success", "refusal"] as const) {
  it(`a departed calibration ${result} cannot close or mark another printer`, async () => {
    let finish!: () => void;
    let refuse!: (error: unknown) => void;
    const { app, screen } = await mount({
      updatePrinter: () =>
        new Promise<void>((resolve, reject) => {
          finish = resolve;
          refuse = reject;
        }),
    });
    change(screen, "printer-paper-width", "58mm");
    await lastStep(screen);
    q(screen, "[data-test=save-printer-p1]")!.click();
    await expect.poll(() => typeof finish).toBe("function");
    q(screen, "[data-test=cancel-edit-printer]")!.click();
    await expect.poll(() => modal(screen)).toBeNull();
    await open(screen, "p2");
    change(screen, "printer-resolution", "203dpi");
    if (result === "success") finish();
    else refuse({ code: "connection.failed" });
    await screen.updateComplete;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(modal(screen)).not.toBeNull();
    expect(modal(screen)!.heading).toContain("Bar");
    expect(field(screen, "printer-resolution").value).toBe("203dpi");
    expect(
      (
        q(
          screen,
          "[data-test=edit-printer-modal] wt-form-actions",
        ) as HTMLElementTagNameMap["wt-form-actions"]
      ).error,
    ).toBe("");
    expect(unload()).toBe(true);
    change(screen, "printer-resolution", "180dpi");
    expect(unload()).toBe(false);
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  });
}
it("replacing a calibration cancels its outstanding question", async () => {
  const { app, screen } = await mount();
  change(screen, "printer-paper-width", "58mm");
  q(screen, "[data-test=cancel-edit-printer]")!.click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  q(screen, "[data-test=calibrate-printer-details]")!.click();
  await screen.updateComplete;
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(field(screen, "printer-paper-width").value).toBe("80mm");
  expect(unload()).toBe(false);
  expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
});
it("an old native close cannot dismiss reopened calibration", async () => {
  const { screen } = await mount();
  const old = modal(screen)!;
  const native = old.shadowRoot!.querySelector("dialog")!;
  let held = false;
  native.addEventListener(
    "close",
    (event) => {
      event.stopImmediatePropagation();
      held = true;
    },
    { capture: true, once: true },
  );
  q(screen, "[data-test=cancel-edit-printer]")!.click();
  await expect.poll(() => held).toBe(true);
  q(screen, "[data-test=calibrate-printer-details]")!.click();
  await screen.updateComplete;
  change(screen, "printer-paper-width", "58mm");
  native.dispatchEvent(new Event("close"));
  await screen.updateComplete;
  expect(modal(screen)).not.toBeNull();
  expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(field(screen, "printer-paper-width").value).toBe("58mm");
  expect(unload()).toBe(true);
});
it("a saved calibration finishes without waiting for its native close report", async () => {
  const { screen } = await mount();
  const native = modal(screen)!.shadowRoot!.querySelector("dialog")!;
  let held = false;
  native.addEventListener(
    "close",
    (event) => {
      event.stopImmediatePropagation();
      held = true;
    },
    { capture: true, once: true },
  );
  change(screen, "printer-paper-width", "58mm");
  await lastStep(screen);
  q(screen, "[data-test=save-printer-p1]")!.click();
  await expect.poll(() => held).toBe(true);
  await expect.poll(() => modal(screen)).toBeNull();
  expect(unload()).toBe(false);
  await open(screen, "p2");
  change(screen, "printer-resolution", "203dpi");
  native.dispatchEvent(new Event("close"));
  await screen.updateComplete;
  expect(modal(screen)).not.toBeNull();
  expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(field(screen, "printer-resolution").value).toBe("203dpi");
  expect(unload()).toBe(true);
});
it("a completed hardware test refresh leaves calibration edits dirty", async () => {
  let reads = 0;
  const { app, screen } = await mount({
    listPrinters: async () => {
      reads++;
      return [printer, other];
    },
  });
  change(screen, "printer-paper-width", "58mm");
  q(screen, "[data-test=print-ruler-p1]")!.click();
  await expect.poll(() => reads).toBeGreaterThan(1);
  expect(field(screen, "printer-paper-width").value).toBe("58mm");
  expect(unload()).toBe(true);
  q(screen, "[data-test=cancel-edit-printer]")!.click();
  await choose(app, "keep");
});
for (const command of ["sample", "drawer"] as const) {
  it(`calibration retains direct dismissal during a ${command} command`, async () => {
    let finish!: (value: { jobId: string }) => void;
    const pending = () =>
      new Promise<{ jobId: string }>((resolve) => {
        finish = resolve;
      });
    const { app, screen } = await mount(
      command === "sample" ? { sampleReceipt: pending } : { testPrinterDrawer: pending },
    );
    change(screen, "printer-paper-width", "58mm");
    q(screen, "[data-test=calibration-next]")!.click();
    await screen.updateComplete;
    if (command === "drawer") {
      q(screen, "[data-test=calibration-next]")!.click();
      await screen.updateComplete;
      change(screen, "printer-cash-drawer", true);
      await screen.updateComplete;
    }
    q(
      screen,
      command === "sample"
        ? "[data-test=print-sample-receipt-p1]"
        : "[data-test=test-printer-drawer]",
    )!.click();
    await expect.poll(() => typeof finish).toBe("function");
    q(screen, "[data-test=cancel-edit-printer]")!.click();
    await expect.poll(() => modal(screen)).toBeNull();
    expect(unload()).toBe(false);
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    finish({ jobId: command });
  });
}
