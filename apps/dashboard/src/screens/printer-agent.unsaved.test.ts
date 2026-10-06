import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons, type WtModal } from "@waitron/ui";
import type { DashboardApi, PrintAgentRow } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { PrintersScreen } from "./printers-screen.js";

registerIcons(DASHBOARD_ICONS);
const agent: PrintAgentRow = {
  id: "a1",
  name: "Kitchen box",
  active: true,
  host: "kitchen.local",
  nodeId: null,
  lastSeenAt: null,
  setupUrl: null,
  enrolledAt: "2026-08-20T09:00:00.000Z",
};
const other = { ...agent, id: "a2", name: "Bar box" };
class AgentLeaveApp extends LitElement {
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
customElements.define("printer-agent-leave-test-app", AgentLeaveApp);
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
  const { el: app } = await mountWidget<AgentLeaveApp>("printer-agent-leave-test-app", {
    api: {
      listAgents: async () => [agent, other],
      listPrinters: async () => [],
      listRecentJobs: async () => [],
      listPrinterProfiles: async () => [],
      pairingMode: async () => ({
        open: false,
        openUntil: null,
        deviceAddress: "https://waitron.local",
      }),
      joinRequests: async () => [],
      listDiscoveredPrinters: async () => [],
      updateAgent: async () => {},
      ...overrides,
    } as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-printers-screen")!;
  await expect.poll(() => q(screen, "[data-test=edit-agent-a1]")).not.toBeNull();
  await open(screen, "a1");
  return { app, screen };
}
async function open(screen: PrintersScreen, id: string) {
  q(screen, `[data-test=edit-agent-${id}]`)!.click();
  await screen.updateComplete;
  await modal(screen)!.updateComplete;
}
function modal(screen: PrintersScreen) {
  return q(screen, "[data-test=edit-agent-modal]") as WtModal | null;
}
function input(screen: PrintersScreen) {
  return q(screen, "[data-test=edit-agent-name]") as HTMLElementTagNameMap["wt-input"];
}
function change(screen: PrintersScreen, value: string) {
  input(screen).dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}
async function choose(app: AgentLeaveApp, decision: "keep" | "discard") {
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}

for (const route of ["cancel", "escape"] as const) {
  it(`agent ${route} keeps the name until Discard closes once`, async () => {
    const { app, screen } = await mount();
    change(screen, "New box");
    await screen.updateComplete;
    await input(screen).updateComplete;
    const native = input(screen).shadowRoot!.querySelector("input")!;
    native.focus();
    let closes = 0;
    modal(screen)!.addEventListener("wt-close", () => closes++);
    const dismiss = async () => {
      if (route === "cancel") q(screen, "[data-test=cancel-edit-agent]")!.click();
      else await userEvent.keyboard("{Escape}");
    };
    await dismiss();
    await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
    expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await choose(app, "keep");
    expect(input(screen).value).toBe("New box");
    expect(closes).toBe(0);
    await expect.poll(() => input(screen).shadowRoot!.activeElement).toBe(native);
    await dismiss();
    await choose(app, "discard");
    await expect.poll(() => modal(screen)).toBeNull();
    expect(closes).toBe(1);
    expect(unload()).toBe(false);
    await open(screen, "a1");
    expect(input(screen).value).toBe("Kitchen box");
  });
}
it("agent unload follows normalized name edits and reverts", async () => {
  const { screen } = await mount();
  expect(unload()).toBe(false);
  change(screen, "New box");
  expect(unload()).toBe(true);
  change(screen, "  Kitchen box  ");
  expect(unload()).toBe(false);
  q(screen, "[data-test=cancel-edit-agent]")!.click();
  await expect.poll(() => modal(screen)).toBeNull();
});
it("agent pending save blocks native dismissal and inputs; refusal preserves the draft", async () => {
  let refuse!: (reason: unknown) => void;
  const { app, screen } = await mount({
    updateAgent: () =>
      new Promise((_, reject) => {
        refuse = reject;
      }),
  });
  change(screen, "New box");
  q(screen, "[data-test=save-agent]")!.click();
  await screen.updateComplete;
  await modal(screen)!.updateComplete;
  await input(screen).updateComplete;
  expect(input(screen).disabled).toBe(true);
  expect(modal(screen)!.dismissible).toBe(false);
  await userEvent.keyboard("{Escape}");
  q(screen, "[data-test=cancel-edit-agent]")!.click();
  expect(modal(screen)!.open).toBe(true);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  refuse({ code: "connection.failed" });
  await expect.poll(() => input(screen).disabled).toBe(false);
  expect(input(screen).value).toBe("New box");
  expect(unload()).toBe(true);
  q(screen, "[data-test=cancel-edit-agent]")!.click();
  await choose(app, "keep");
});
it("agent success clears its warning before a refused refresh", async () => {
  let reads = 0;
  let dirtyAtRefresh: boolean | undefined;
  let received: unknown;
  const mounted = await mount({
    listAgents: async () => {
      if (++reads === 1) return [agent, other];
      dirtyAtRefresh = unload();
      throw { code: "connection.failed" };
    },
    updateAgent: async (id, body) => {
      received = { id, body };
    },
  });
  change(mounted.screen, "  Saved box  ");
  expect(unload()).toBe(true);
  q(mounted.screen, "[data-test=save-agent]")!.click();
  await expect.poll(() => dirtyAtRefresh).toBe(false);
  expect(received).toEqual({ id: "a1", body: { name: "Saved box" } });
  await expect.poll(() => modal(mounted.screen)).toBeNull();
  expect(q(mounted.screen, "[data-test=printer-refresh-error]")?.textContent).toContain(
    t("printers.refresh_failed"),
  );
});
it("a newer delivered agent name stays dirty against the submitted name", async () => {
  let finish!: () => void;
  const { screen } = await mount({
    updateAgent: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  change(screen, "Saved box");
  q(screen, "[data-test=save-agent]")!.click();
  await screen.updateComplete;
  change(screen, "Newer box");
  finish();
  await expect.poll(() => input(screen)?.disabled).toBe(false);
  expect(modal(screen)!.open).toBe(true);
  expect(input(screen).value).toBe("Newer box");
  expect(unload()).toBe(true);
  change(screen, "Saved box");
  expect(unload()).toBe(false);
});
for (const result of ["success", "refusal"] as const) {
  it(`a departed agent ${result} leaves the replacement editor alone`, async () => {
    let finish!: () => void;
    let refuse!: (reason: unknown) => void;
    const { app, screen } = await mount({
      updateAgent: () =>
        new Promise<void>((resolve, reject) => {
          finish = resolve;
          refuse = reject;
        }),
    });
    change(screen, "Saved box");
    q(screen, "[data-test=save-agent]")!.click();
    await screen.updateComplete;
    await open(screen, "a2");
    change(screen, "New bar");
    if (result === "success") finish();
    else refuse({ code: "connection.failed" });
    await expect.poll(() => input(screen)?.disabled).toBe(false);
    expect(modal(screen)!.open).toBe(true);
    expect(input(screen).value).toBe("New bar");
    expect(unload()).toBe(true);
    expect(screen.shadowRoot!.textContent).not.toContain(codeMessage("connection.failed"));
    change(screen, "Bar box");
    expect(app.leave.coordinator.isDirty()).toBe(false);
  });
}
it("replacing an agent cancels the old discard question", async () => {
  const { app, screen } = await mount();
  change(screen, "New box");
  q(screen, "[data-test=cancel-edit-agent]")!.click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  await open(screen, "a2");
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(input(screen).value).toBe("Bar box");
  expect(unload()).toBe(false);
});
it("disconnect removes agent unload protection and the question", async () => {
  const { app, screen } = await mount();
  change(screen, "New box");
  expect(unload()).toBe(true);
  q(screen, "[data-test=cancel-edit-agent]")!.click();
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  screen.remove();
  expect(unload()).toBe(false);
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});
it("an earlier native close report cannot dismiss a reopened agent editor", async () => {
  const { app, screen } = await mount();
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
  q(screen, "[data-test=cancel-edit-agent]")!.click();
  await expect.poll(() => held).toBe(true);
  await open(screen, "a2");
  expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  change(screen, "Changed bar");
  native.dispatchEvent(new Event("close"));
  await screen.updateComplete;
  expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(input(screen).value).toBe("Changed bar");
  expect(app.leave.coordinator.isDirty()).toBe(true);
});
it("agent success completes even while its native close report is delayed", async () => {
  let reads = 0;
  const { app, screen } = await mount({
    listAgents: async () => {
      reads++;
      return [agent, other];
    },
  });
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
  change(screen, "Saved box");
  q(screen, "[data-test=save-agent]")!.click();
  await expect.poll(() => held).toBe(true);
  await expect.poll(() => reads).toBeGreaterThan(1);
  await expect.poll(() => modal(screen)).toBeNull();
  await open(screen, "a2");
  change(screen, "Changed bar");
  native.dispatchEvent(new Event("close"));
  await screen.updateComplete;
  expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(input(screen).value).toBe("Changed bar");
  expect(app.leave.coordinator.isDirty()).toBe(true);
});
