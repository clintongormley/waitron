import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { registerIcons } from "@waitron/ui";
import type { DashboardApi, AccessRole } from "../api/client.js";
import { DASHBOARD_ICONS } from "../icons.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { AccessRolesScreen } from "./access-roles-screen.js";
import "./access-roles-screen.js";

registerIcons(DASHBOARD_ICONS);
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
const grants = ["payment.take", "report.view", "person.admin", "node.manage", "future.inspect"];
const roles: AccessRole[] = [
  { id: "staff", builtInKey: "staff", name: null, permissions: ["payment.take"], holderCount: 3 },
  { id: "admin", builtInKey: "admin", name: null, permissions: grants, holderCount: 1 },
  {
    id: "accounts",
    builtInKey: null,
    name: "Accountant",
    permissions: ["report.view"],
    holderCount: 2,
  },
];
function api(overrides: Partial<DashboardApi> = {}) {
  return {
    listAccessRoles: vi.fn().mockResolvedValue(roles),
    ...overrides,
  } as unknown as DashboardApi;
}
function q(el: AccessRolesScreen, id: string) {
  return el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${id}"]`)!;
}
function change(el: AccessRolesScreen, id: string, value: string | boolean) {
  q(el, id).dispatchEvent(
    new CustomEvent("wt-change", {
      detail: typeof value === "boolean" ? { checked: value } : { value },
    }),
  );
}
async function mount(overrides: Partial<DashboardApi> = {}, permissions = grants) {
  setLocale("en-GB");
  const { el, host } = await mountWidget<AccessRolesScreen>("dashboard-access-roles-screen", {
    api: api(overrides),
    viewerPermissions: permissions,
    viewerRoleIds: ["admin"],
  });
  await expect.poll(() => el.shadowRoot!.querySelector("wt-data-table")?.rows.length).toBe(3);
  return { el, host };
}
async function edit(el: AccessRolesScreen, id: string) {
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  table.rowClick!(roles.find((r) => r.id === id)!);
  await el.updateComplete;
}
it("creates a role with the selected permissions, then closes before a failed refresh", async () => {
  const create = vi.fn().mockResolvedValue({ id: "new" });
  const list = vi
    .fn()
    .mockResolvedValueOnce(roles)
    .mockRejectedValue({ code: "management.failed" });
  const { el } = await mount({ createAccessRole: create, listAccessRoles: list });
  q(el, "create").click();
  await el.updateComplete;
  expect((q(el, "save") as HTMLElementTagNameMap["wt-button"]).disabled).toBe(true);
  change(el, "role-name", "Accounts");
  change(el, "permission-payment.take", true);
  change(el, "permission-report.view", true);
  await el.updateComplete;
  q(el, "save").click();
  await expect
    .poll(() => create.mock.calls)
    .toEqual([[{ name: "Accounts", permissions: ["payment.take", "report.view"] }]]);
  await expect.poll(() => q(el, "editor")).toBeNull();
  await expect.poll(() => q(el, "load-error")?.textContent).toContain(t("access_roles.load_error"));
});
it("shows labelled areas, disables unheld permissions and falls back to the module ID", async () => {
  const { el } = await mount({}, ["payment.take", "person.admin"]);
  q(el, "create").click();
  await el.updateComplete;
  const sw = q(el, "permission-node.manage") as HTMLElementTagNameMap["wt-switch"];
  await sw.updateComplete;
  expect(sw.shadowRoot!.querySelector("input")!.disabled).toBe(true);
  expect((q(el, "permission-payment.take") as HTMLElementTagNameMap["wt-switch"]).disabled).toBe(
    false,
  );
  expect(q(el, "permission-payment.take").getAttribute("label")).toBe("Take payments");
  expect(q(el, "permission-future.inspect").getAttribute("label")).toBe("future.inspect");
  expect([...el.shadowRoot!.querySelectorAll("h2")].map((h) => h.textContent)).toEqual([
    "Sales",
    "Reports and tax",
    "People and rota",
    "Venue and system",
  ]);
});
it("locks every Admin permission and hides built-in rename and delete", async () => {
  const { el } = await mount();
  await edit(el, "admin");
  const switches = [...el.shadowRoot!.querySelectorAll("wt-switch")];
  expect(switches).toHaveLength(5);
  for (const sw of switches) {
    await sw.updateComplete;
    const input = sw.shadowRoot!.querySelector("input")!;
    expect(input.checked).toBe(true);
    expect(input.disabled).toBe(true);
  }
  expect(q(el, "role-name")).toBeNull();
  expect(q(el, "save")).toBeNull();
  expect(el.shadowRoot!.textContent).toContain("Admin always has every permission.");
  expect(q(el, "delete")).toBeNull();
});
it("copies the source ticks with a new name in one confirmation", async () => {
  const create = vi.fn().mockResolvedValue({ id: "copy" });
  const { el } = await mount({ createAccessRole: create });
  await edit(el, "accounts");
  q(el, "copy").click();
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await dialog.updateComplete;
  expect(create).not.toHaveBeenCalled();
  change(el, "copy-name", "Bookkeeper");
  await el.updateComplete;
  q(el, "copy-confirm").click();
  await expect
    .poll(() => create.mock.calls)
    .toEqual([[{ name: "Bookkeeper", permissions: ["report.view"], copiedFrom: "accounts" }]]);
});
it("names the affected people in the only delete confirmation", async () => {
  const remove = vi.fn().mockResolvedValue({ removedFrom: 2 });
  const { el } = await mount({ deleteAccessRole: remove });
  await edit(el, "accounts");
  q(el, "delete").click();
  await el.updateComplete;
  expect(q(el, "delete-message").textContent?.trim()).toBe(
    "2 people hold Accountant. Deleting it takes it away from them.",
  );
  expect(remove).not.toHaveBeenCalled();
  q(el, "delete-confirm").click();
  await expect.poll(() => remove.mock.calls).toEqual([["accounts"]]);
  await expect.poll(() => q(el, "editor")).toBeNull();
});
it("keeps a stale permission draft and its expected snapshot for retry", async () => {
  const save = vi.fn().mockRejectedValue({ code: "role.changed" });
  const { el } = await mount({ setAccessRolePermissions: save });
  await edit(el, "accounts");
  change(el, "permission-payment.take", true);
  await el.updateComplete;
  q(el, "save").click();
  await expect
    .poll(() => save.mock.calls)
    .toEqual([["accounts", ["payment.take", "report.view"], ["report.view"]]]);
  await expect.poll(() => q(el, "form-actions")?.getAttribute("error")).toBeTruthy();
  const sw = q(el, "permission-payment.take") as HTMLElementTagNameMap["wt-switch"];
  await sw.updateComplete;
  expect(sw.shadowRoot!.querySelector("input")!.checked).toBe(true);
  expect((q(el, "save") as HTMLElementTagNameMap["wt-button"]).disabled).toBe(false);
});
it("retains a successful rename when the permission write is refused", async () => {
  const rename = vi.fn().mockResolvedValue(undefined);
  const save = vi.fn().mockRejectedValueOnce({ code: "role.changed" }).mockResolvedValue(undefined);
  const { el } = await mount({ renameAccessRole: rename, setAccessRolePermissions: save });
  await edit(el, "accounts");
  change(el, "role-name", "Books");
  change(el, "permission-payment.take", true);
  await el.updateComplete;
  q(el, "save").click();
  await expect.poll(() => q(el, "form-actions")?.getAttribute("error")).toBeTruthy();
  q(el, "save").click();
  await expect.poll(() => q(el, "editor")).toBeNull();
  expect(rename.mock.calls).toEqual([["accounts", "Books", "Accountant"]]);
  expect(save).toHaveBeenCalledTimes(2);
});
it("puts a name refusal beside the name and leaves retry available", async () => {
  const { el } = await mount({
    createAccessRole: vi.fn().mockRejectedValue({ code: "role.name_taken" }),
  });
  q(el, "create").click();
  await el.updateComplete;
  change(el, "role-name", "Accountant");
  await el.updateComplete;
  q(el, "save").click();
  await expect
    .poll(() => (q(el, "role-name") as HTMLElementTagNameMap["wt-input"]).error)
    .toBeTruthy();
  expect((q(el, "save") as HTMLElementTagNameMap["wt-button"]).disabled).toBe(false);
});
it("fits the role detail at phone width", async () => {
  await page.viewport(390, 844);
  try {
    const { el } = await mount();
    await edit(el, "accounts");
    expect(el.scrollWidth).toBeLessThanOrEqual(390);
  } finally {
    await page.viewport(1280, 768);
  }
});

it("submits a new role with Enter and focuses a missing required name", async () => {
  const create = vi.fn().mockResolvedValue({ id: "new" });
  const { el } = await mount({ createAccessRole: create });
  q(el, "create").click();
  await el.updateComplete;
  change(el, "permission-payment.take", true);
  await el.updateComplete;
  q(el, "save").click();
  await el.updateComplete;
  const name = q(el, "role-name") as HTMLElementTagNameMap["wt-input"];
  await name.updateComplete;
  await expect
    .poll(() => name.shadowRoot!.activeElement)
    .toBe(name.shadowRoot!.querySelector("input"));
  expect(create).not.toHaveBeenCalled();
  change(el, "role-name", "Cashier");
  await el.updateComplete;
  name
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await expect
    .poll(() => create.mock.calls)
    .toEqual([[{ name: "Cashier", permissions: ["payment.take"] }]]);
});
it("submits a named copy with Enter", async () => {
  const create = vi.fn().mockResolvedValue({ id: "copy" });
  const { el } = await mount({ createAccessRole: create });
  await edit(el, "accounts");
  q(el, "copy").click();
  await el.updateComplete;
  change(el, "copy-name", "Books");
  await el.updateComplete;
  const copyName = q(el, "copy-name") as HTMLElementTagNameMap["wt-input"];
  await copyName.updateComplete;
  copyName
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await expect
    .poll(() => create.mock.calls)
    .toEqual([[{ name: "Books", permissions: ["report.view"], copiedFrom: "accounts" }]]);
});
