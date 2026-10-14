import { LitElement, html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import { LeaveController, type WtInput } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import "./node-recovery-panel.js";
import type { NodeRecoveryPanel } from "./node-recovery-panel.js";

class RecoveryLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-node-recovery .api=${this.api}></dashboard-node-recovery
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("recovery-leave-test-app", RecoveryLeaveApp);
afterEach(cleanupWidgets);

it("protects the typed node key and selected register, and discarding clears their native controls", async () => {
  const { el: app } = await mountWidget<RecoveryLeaveApp>("recovery-leave-test-app", {
    api: {} as DashboardApi,
  });
  const panel = app.shadowRoot!.querySelector<NodeRecoveryPanel>("dashboard-node-recovery")!;
  await panel.updateComplete;
  const key = panel.shadowRoot!.querySelector<WtInput>("wt-input")!;
  key.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "private-node-key" } }));
  const file = panel.shadowRoot!.querySelector<HTMLInputElement>("input[type=file]")!;
  const files = new DataTransfer();
  files.items.add(new File(["{}"], "register.json"));
  file.files = files.files;
  file.dispatchEvent(new Event("change"));
  await panel.updateComplete;
  let proceeded = false;
  const leaving = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {
      proceeded = true;
    },
  });
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(warning.open).toBe(true));
  expect(proceeded).toBe(false);
  warning.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(await leaving).toBe("proceeded");
  await panel.updateComplete;
  expect(key.shadowRoot!.querySelector<HTMLInputElement>("input")!.value).toBe("");
  expect(file.files).toHaveLength(0);
});

it("discarding during a request prevents its old key from returning in a late download", async () => {
  let complete!: (value: unknown) => void;
  const api = {
    createNodeRecoveryPack: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<RecoveryLeaveApp>("recovery-leave-test-app", { api });
  const panel = app.shadowRoot!.querySelector<NodeRecoveryPanel>("dashboard-node-recovery")!;
  await panel.updateComplete;
  panel
    .shadowRoot!.querySelector<WtInput>("wt-input")!
    .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "private-node-key" } }));
  const picker = panel.shadowRoot!.querySelector<HTMLInputElement>("input[type=file]")!;
  const files = new DataTransfer();
  files.items.add(new File(["{}"], "register.json"));
  picker.files = files.files;
  picker.dispatchEvent(new Event("change"));
  await panel.updateComplete;
  (panel.shadowRoot!.querySelector("wt-button") as HTMLElement).click();
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  const leaving = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(warning.open).toBe(true));
  warning.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(await leaving).toBe("proceeded");
  complete({
    version: 1,
    kind: "node-recovery-pack",
    createdAt: "2026-10-14T10:00:00.000Z",
    nodeRecovery: { nodeId: "n", name: "old", secret: "private-node-key" },
    modules: {},
    warnings: [],
  });
  await vi.waitFor(() =>
    expect(panel.shadowRoot!.querySelector<WtInput>("wt-input")!.disabled).toBe(false),
  );
  expect(panel.shadowRoot!.querySelector("a")).toBeNull();
});
