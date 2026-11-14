import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController, registerIcons } from "@waitron/ui";
import type { DashboardApi } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./access-roles-screen.js";

registerIcons(DASHBOARD_ICONS);
const previousLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(previousLocale);
});
class RoleLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-access-roles-screen
        .api=${this.api}
        .viewerPermissions=${["report.view"]}
      ></dashboard-access-roles-screen>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("role-leave-test-app", RoleLeaveApp);
async function mount() {
  setLocale("en-GB");
  const { el: app } = await mountWidget<RoleLeaveApp>("role-leave-test-app", {
    api: {
      listAccessRoles: async () => [
        {
          id: "admin",
          builtInKey: "admin",
          name: null,
          permissions: ["report.view"],
          holderCount: 1,
        },
      ],
      createAccessRole: vi.fn().mockResolvedValue({ id: "created" }),
    } as unknown as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-access-roles-screen")!;
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-data-table")?.rows.length).toBe(1);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=create]")!.click();
  await screen.updateComplete;
  const name = screen.shadowRoot!.querySelector("wt-input")!;
  name.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Accounts" } }));
  await screen.updateComplete;
  return { app, screen, name };
}
async function choose(app: RoleLeaveApp, decision: "keep" | "discard") {
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => question.open).toBe(true);
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => question.open).toBe(false);
}
it("keeps an edited role on Back, discards on explicit Cancel, and protects application navigation", async () => {
  const { app, screen, name } = await mount();
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=back]")!.click();
  await choose(app, "keep");
  expect(name.value).toBe("Accounts");
  const proceed = vi.fn();
  void app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed });
  await choose(app, "discard");
  await expect.poll(() => proceed.mock.calls.length).toBe(1);
  expect(name.value).toBe("");
  name.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Books" } }));
  await screen.updateComplete;
  screen.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=editor]")).toBeNull();
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});
it("marks successful writes clean before leaving and restores an unsubmitted permission toggle", async () => {
  const { app, screen, name } = await mount();
  name.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "" } }));
  const toggle = screen.shadowRoot!.querySelector("wt-switch")!;
  toggle.dispatchEvent(new CustomEvent("wt-change", { detail: { checked: true } }));
  const proceed = vi.fn();
  void app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed });
  await choose(app, "discard");
  await screen.updateComplete;
  expect(toggle.checked).toBe(false);
  name.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Books" } }));
  await screen.updateComplete;
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=editor]")).toBeNull();
  await app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed });
  expect(proceed).toHaveBeenCalledTimes(2);
});

it("treats a saved name as clean when the refused permission edit is reverted", async () => {
  setLocale("en-GB");
  const account = {
    id: "accounts",
    builtInKey: null,
    name: "Accountant",
    permissions: [],
    holderCount: 2,
  };
  const { el: app } = await mountWidget<RoleLeaveApp>("role-leave-test-app", {
    api: {
      listAccessRoles: async () => [
        account,
        {
          id: "admin",
          builtInKey: "admin",
          name: null,
          permissions: ["report.view"],
          holderCount: 1,
        },
      ],
      renameAccessRole: async () => undefined,
      setAccessRolePermissions: async () => {
        throw { code: "management.failed" };
      },
    } as unknown as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-access-roles-screen")!;
  const q = (id: string) => screen.shadowRoot!.querySelector<HTMLElement>(`[data-test="${id}"]`)!;
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-data-table")?.rows.length).toBe(2);
  screen.shadowRoot!.querySelector("wt-data-table")!.rowClick!(account);
  await screen.updateComplete;
  q("role-name").dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Books" } }));
  q("permission-report.view").dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked: true } }),
  );
  await screen.updateComplete;
  q("save").click();
  await expect.poll(() => q("form-actions").getAttribute("error")).toBeTruthy();
  q("permission-report.view").dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked: false } }),
  );
  await screen.updateComplete;
  expect((q("save") as HTMLElementTagNameMap["wt-button"]).disabled).toBe(true);
  const proceed = vi.fn();
  await app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed });
  expect(proceed).toHaveBeenCalledOnce();
});
it("keeps a draft when Reload is declined and reloads after explicit Discard", async () => {
  setLocale("en-GB");
  const account = {
    id: "accounts",
    builtInKey: null,
    name: "Books",
    permissions: [],
    holderCount: 0,
  };
  const { el: app } = await mountWidget<RoleLeaveApp>("role-leave-test-app", {
    api: {
      listAccessRoles: vi
        .fn()
        .mockResolvedValueOnce([
          account,
          {
            id: "admin",
            builtInKey: "admin",
            name: null,
            permissions: ["report.view"],
            holderCount: 1,
          },
        ])
        .mockResolvedValue([
          { ...account, name: "Ledger" },
          {
            id: "admin",
            builtInKey: "admin",
            name: null,
            permissions: ["report.view"],
            holderCount: 1,
          },
        ]),
    } as unknown as DashboardApi,
  });
  const screen = app.shadowRoot!.querySelector("dashboard-access-roles-screen")!;
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-data-table")?.rows.length).toBe(2);
  screen.shadowRoot!.querySelector("wt-data-table")!.rowClick!(account);
  await screen.updateComplete;
  const field = screen.shadowRoot!.querySelector("wt-input")!;
  field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Draft" } }));
  await screen.updateComplete;
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=reload]")!.click();
  await choose(app, "keep");
  expect(field.value).toBe("Draft");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=reload]")!.click();
  await choose(app, "discard");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-input")?.value).toBe("Ledger");
});

it("protects a copy name on Escape and clears that child draft on Cancel", async () => {
  const { app, screen } = await mount();
  screen.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-data-table")).not.toBeNull();
  screen.shadowRoot!.querySelector("wt-data-table")!.rowClick!({
    id: "admin",
    builtInKey: "admin",
    name: null,
    permissions: ["report.view"],
    holderCount: 1,
  });
  await screen.updateComplete;
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=copy]")!.click();
  await screen.updateComplete;
  const dialog = screen.shadowRoot!.querySelector("wt-dialog")!;
  const field = screen.shadowRoot!.querySelector<HTMLElement>("[data-test=copy-name]")!;
  field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Books" } }));
  await screen.updateComplete;
  const close = dialog.requestClose("escape");
  await choose(app, "keep");
  expect(await close).toBe(false);
  expect((field as HTMLElementTagNameMap["wt-input"]).value).toBe("Books");
  const closed = new Promise<void>((resolve) =>
    dialog.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  await dialog.requestClose("cancel");
  await closed;
  const proceed = vi.fn();
  await app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed });
  expect(proceed).toHaveBeenCalledOnce();
});
