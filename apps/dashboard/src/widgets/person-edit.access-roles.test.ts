import { afterEach, expect, it, vi } from "vitest";
import { chooseOptions } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { DashboardApi, type AccessRole, type PersonSummary } from "../api/client.js";
import { PersonEdit } from "./person-edit.js";
import { useLocale } from "../testing/locale-setup.js";
useLocale("en-GB");

const roles: AccessRole[] = [
  {
    id: "manager",
    builtInKey: "manager",
    name: null,
    permissions: ["person.admin"],
    holderCount: 1,
  },
  { id: "waiter", builtInKey: "staff", name: null, permissions: [], holderCount: 1 },
  { id: "admin", builtInKey: "admin", name: null, permissions: [], holderCount: 1 },
  { id: "cash", builtInKey: null, name: "Cash", permissions: ["take-cash"], holderCount: 1 },
];
const person: PersonSummary = {
  personId: "p1",
  displayName: "Ada",
  firstNames: "Ada",
  lastNames: "Lovelace",
  email: "ada@example.com",
  telephone: null,
  roleIds: ["manager"],
  status: "active",
  hasPassword: true,
  hasTotp: false,
};
afterEach(cleanupWidgets);
async function mount(held = ["manager"], viewerAdmin = true, stale = false) {
  let current = held;
  const calls: unknown[][] = [];
  const api = Object.assign(new DashboardApi(""), {
    listAccessRoles: async () => roles,
    listStaff: async () => [{ ...person, roleIds: current }],
    setPersonAccessRoles: async (...args: unknown[]) => {
      calls.push(args);
      if (stale) {
        current = ["waiter"];
        throw { code: "person.roles_changed" };
      }
      return { roleIds: args[1] as string[] };
    },
  });
  const { el } = await mountWidget<PersonEdit>("dashboard-person-edit", {
    person: { ...person, roleIds: held },
    api,
    open: true,
    canAdminister: true,
    viewerAdmin,
    viewerPermissions: ["person.admin"],
  });
  const field = () =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>('[name="accessRoles"]')!;
  await expect.poll(() => field()?.disabled).toBe(false);
  return { el, field, calls };
}
it("saves two access-role tags with the membership baseline independently of details", async () => {
  const { el, field, calls } = await mount();
  await chooseOptions(field(), ["manager", "waiter"]);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelectorAll("[data-access-role]")).toHaveLength(2);
  const details = vi.fn();
  el.addEventListener("save-person", details);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-access-roles"]')!.click();
  await expect.poll(() => calls).toEqual([["p1", ["manager", "waiter"], ["manager"]]]);
  expect(details).not.toHaveBeenCalled();
  await expect
    .poll(
      () =>
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
          '[data-test="save-access-roles"]',
        )!.disabled,
    )
    .toBe(true);
});
it("holds forbidden roles as locked tags and omits them from offered choices", async () => {
  const { el, field, calls } = await mount(["admin", "cash", "manager"], false);
  expect(field().options.map((r) => r.value)).toEqual(["manager", "waiter"]);
  for (const id of ["admin", "cash"]) {
    const tag = el.shadowRoot!.querySelector(`[data-access-role="${id}"]`)!;
    expect(tag.textContent).not.toBe("");
    expect(tag.querySelector("wt-button")).toBeNull();
  }
  await chooseOptions(field(), ["waiter"]);
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-access-roles"]')!.click();
  await expect
    .poll(() => calls)
    .toEqual([["p1", ["admin", "cash", "waiter"], ["admin", "cash", "manager"]]]);
});
it("keeps a stale draft until explicit reload reads the new membership", async () => {
  const { el, field, calls } = await mount(["manager"], true, true);
  await chooseOptions(field(), ["manager", "waiter"]);
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-access-roles"]')!.click();
  await expect.poll(() => calls.length).toBe(1);
  await expect
    .poll(() => el.shadowRoot!.querySelector('[data-test="reload-access-roles"]'))
    .not.toBeNull();
  expect(field().values).toEqual(["manager", "waiter"]);
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="reload-access-roles"]')!.click();
  await expect
    .poll(
      () =>
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
          '[data-test="save-access-roles"]',
        )!.disabled,
    )
    .toBe(true);
  expect(field().values).toEqual(["waiter"]);
});
it("keeps another person's email readable but read-only for a Manager", async () => {
  const { el } = await mount(["manager"], false);
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="email"]')!;
  await field.updateComplete;
  expect(field.shadowRoot!.querySelector("input")!.readOnly).toBe(true);
  expect(field.shadowRoot!.querySelector("input")!.disabled).toBe(false);
  el.currentPersonId = "p1";
  await el.updateComplete;
  await field.updateComplete;
  expect(field.shadowRoot!.querySelector("input")!.readOnly).toBe(false);
});

it("a name-only save does not write access-role memberships", async () => {
  const { el, calls } = await mount();
  const saved = vi.fn();
  el.addEventListener("save-person", saved);
  el.shadowRoot!.querySelector('[name="given-name"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Augusta" } }),
  );
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
  expect(saved).toHaveBeenCalledOnce();
  expect((saved.mock.calls[0]![0] as CustomEvent).detail).toEqual({
    displayName: "Ada",
    firstNames: "Augusta",
    lastNames: "Lovelace",
    email: "ada@example.com",
    telephone: null,
    status: "active",
  });
  expect(calls).toEqual([]);
});

it("reports saved memberships and reopens with those roles selected", async () => {
  const { el, field } = await mount();
  const saved = vi.fn();
  el.addEventListener("access-roles-saved", saved);
  await chooseOptions(field(), ["waiter"]);
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="save-access-roles"]')!.click();
  await expect.poll(() => saved.mock.calls.length).toBe(1);
  expect((saved.mock.calls[0]![0] as CustomEvent).detail).toEqual({
    personId: "p1",
    roleIds: ["waiter"],
  });
  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  await expect.poll(() => field().values).toEqual(["waiter"]);
});
