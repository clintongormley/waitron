import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import {
  LiveData,
  codeMessage,
  currentLocale,
  setLocale,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
import { applyTokens, type DataTableColumn } from "@waitron/ui";
import { chooseOptions, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import { StaffingApi, type StaffPerson, type StaffRole } from "./client.js";
import type { StaffRolesScreen } from "./staff-roles-screen.js";
import "./staff-roles-screen.js";

const BASE = "/management-api/staffing/staff-roles";

const waiter: StaffRole = {
  id: "role-w",
  name: "Waiter",
  colour: "green",
  position: 0,
  holderIds: ["p-ana", "p-marc"],
  blockCount: 0,
  shiftCount: 0,
};
const cook: StaffRole = {
  id: "role-c",
  name: "Cook",
  colour: "red",
  position: 1,
  holderIds: ["p-ana"],
  blockCount: 1,
  shiftCount: 2,
};
const runner: StaffRole = {
  id: "role-r",
  name: "Runner",
  colour: "purple",
  position: 2,
  holderIds: [],
  blockCount: 3,
  shiftCount: 0,
};
const people: StaffPerson[] = [{ personId: "p-ana", displayName: "Ana", status: "active" }];

type Answer = (body: unknown) => unknown;
type Routes = Record<string, Answer>;

/** A request that answers `"<METHOD> <path>"` from `routes`, and lists `roles` for the page's read. */
function fakeRequest(roles: () => StaffRole[], routes: Routes = {}) {
  return vi.fn(async (path: string, method: string = "GET", body?: unknown) => {
    const route = routes[`${method} ${path}`];
    if (route) return route(body);
    if (method === "GET" && path === BASE) return { staffRoles: roles() };
    if (method === "GET" && path === "/management-api/staff") return people;
    if (method === "PUT" && path === `${BASE}/order`) return undefined;
    if (method === "DELETE") return undefined;
    throw new Error(`unexpected ${method} ${path}`);
  });
}

let el: StaffRolesScreen;
let host: HTMLElement;
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  host?.remove();
  setLocale(locale);
  sessionStorage.clear();
  localStorage.clear();
});

async function settle() {
  for (let i = 0; i < 4; i++) {
    await el.updateComplete;
    await table()?.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function mount(
  request: ReturnType<typeof fakeRequest>,
  options: { liveData?: LiveData; readOnly?: boolean } = {},
) {
  host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  el = document.createElement("dashboard-staff-roles-screen");
  el.api = new StaffingApi(request as unknown as DashboardRequest, options.liveData);
  el.readOnly = options.readOnly ?? false;
  host.append(el);
  await settle();
  return request;
}

const table = () =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-data-table"]>(
    "wt-data-table[data-test=staff-roles]",
  );
const rows = () => [
  ...table()!.shadowRoot!.querySelectorAll<HTMLElement>("tbody tr[data-row-key]"),
];
const rowKeys = () => rows().map((row) => row.dataset.rowKey);
const row = (id: string) => rows().find((found) => found.dataset.rowKey === id)!;
const cells = (id: string) =>
  [...row(id).querySelectorAll("td")].map((cell) => cell.textContent!.trim());
const menuItem = (test: string) =>
  table()!.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test="${test}"]`);
const dialog = () => el.shadowRoot!.querySelector("staff-role-dialog")!;
const deleteModal = () =>
  el.shadowRoot!.querySelector<HTMLElement>("wt-modal[data-test=delete-staff-role]");
const alertText = (test: string) =>
  el.shadowRoot!.querySelector(`[data-test=${test}]`)?.textContent?.trim() ?? "";

async function choose(test: string) {
  const item = menuItem(test);
  expect(item, test).not.toBeNull();
  const menu = item!.closest("wt-row-actions")!;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await userEvent.click(item!);
  await settle();
}

async function deleteMessage() {
  const actions = deleteModal()!.querySelector("wt-form-actions")!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}

describe("the staff roles page", () => {
  it("lists each staff role's swatch and name, and its holder count, in position order", async () => {
    await mount(fakeRequest(() => [runner, waiter, cook]));
    expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe("Staff roles");
    expect(rowKeys()).toEqual(["role-w", "role-c", "role-r"]);
    expect(
      (table()!.columns as readonly DataTableColumn<StaffRole>[]).map((column) => column.key),
    ).toEqual(["name", "people", "actions"]);
    expect(cells("role-w").slice(0, 2)).toEqual(["Waiter", "2 people"]);
    expect(cells("role-c").slice(0, 2)).toEqual(["Cook", "1 person"]);
    expect(cells("role-r").slice(0, 2)).toEqual(["Runner", "No people"]);
    const nameCell = row("role-c").querySelector("td")!;
    const swatch = nameCell.querySelector<HTMLElement>("[part~=swatch]")!;
    expect(nameCell.textContent!.trim()).toBe("Cook");
    expect(swatch.parentElement!.firstElementChild).toBe(swatch);
    expect(swatch.getAttribute("part")).toBe("swatch swatch-red");
    const painted = getComputedStyle(swatch).backgroundColor;
    const probe = document.createElement("span");
    probe.style.background = "var(--wt-color-palette-red)";
    host.append(probe);
    expect(painted).toBe(getComputedStyle(probe).backgroundColor);
    expect(painted).not.toBe(
      getComputedStyle(row("role-w").querySelector("[part~=swatch]")!).backgroundColor,
    );
  });

  it("centres the swatch on the name, and keeps the name on the row's text line", async () => {
    await mount(fakeRequest(() => [waiter]));
    const [nameCell, peopleCell] = [...row("role-w").querySelectorAll("td")];
    const textBox = (cell: Element) => {
      const range = document.createRange();
      const text = [...cell.querySelectorAll("*"), cell]
        .flatMap((node) => [...node.childNodes])
        .find((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== "")!;
      range.selectNodeContents(text);
      return range.getBoundingClientRect();
    };
    const name = textBox(nameCell!);
    const people = textBox(peopleCell!);
    expect(Math.abs(name.bottom - people.bottom)).toBeLessThan(0.5);
    const swatch = nameCell!.querySelector("[part~=swatch]")!.getBoundingClientRect();
    expect(swatch.width).toBeGreaterThan(0);
    expect(Math.abs((swatch.top + swatch.bottom) / 2 - (name.top + name.bottom) / 2)).toBeLessThan(
      1.5,
    );
    expect(swatch.right).toBeLessThan(name.left);
  });

  it("pins the actions column to the end", async () => {
    await mount(fakeRequest(() => [waiter]));
    const columns = table()!.columns as readonly DataTableColumn<StaffRole>[];
    expect(columns.at(-1)).toMatchObject({ key: "actions", pinned: "end" });
    expect(row("role-w").querySelector("wt-row-actions")!.getAttribute("label")).toBe(
      "Actions for Waiter",
    );
  });

  it("shows the table's loading message until the first read answers", async () => {
    let answer!: (value: unknown) => void;
    const request = fakeRequest(() => [waiter], {
      [`GET ${BASE}`]: () => new Promise((resolve) => (answer = resolve)),
    });
    await mount(request);
    expect(table()!.loading).toBe(true);
    expect(table()!.loadingMessage).toBe("Loading staff roles…");
    answer({ staffRoles: [waiter] });
    await settle();
    expect(table()!.loading).toBe(false);
    expect(rowKeys()).toEqual(["role-w"]);
  });

  it("says when there are no staff roles yet", async () => {
    await mount(fakeRequest(() => []));
    expect(table()!.emptyMessage).toBe("No staff roles yet.");
    expect(table()!.shadowRoot!.textContent).toContain("No staff roles yet.");
  });

  it("says why the staff roles could not be loaded, and clears it once a read answers", async () => {
    let fail = true;
    const request = fakeRequest(() => [waiter], {
      [`GET ${BASE}`]: () => {
        if (fail) throw { code: "connection.failed" };
        return { staffRoles: [waiter] };
      },
    });
    const liveData = new LiveData();
    await mount(request, { liveData });
    const message = `Could not load the staff roles: ${codeMessage("connection.failed")}`;
    expect(table()!.errorMessage).toBe(message);
    fail = false;
    liveData.invalidate([{ type: "staff_roles" }]);
    await vi.waitFor(() => expect(rowKeys()).toEqual(["role-w"]));
    expect(table()!.errorMessage).toBe("");
    expect(alertText("load-alert")).toBe("");
    liveData.clear();
  });

  it("keeps the list and says so above it when a later read fails", async () => {
    let fail = false;
    const request = fakeRequest(() => [waiter], {
      [`GET ${BASE}`]: () => {
        if (fail) throw { code: "connection.failed" };
        return { staffRoles: [waiter] };
      },
    });
    const liveData = new LiveData();
    await mount(request, { liveData });
    fail = true;
    liveData.invalidate([{ type: "staff_roles" }]);
    await vi.waitFor(() =>
      expect(alertText("load-alert")).toBe(
        `Could not load the staff roles: ${codeMessage("connection.failed")}`,
      ),
    );
    expect(rowKeys()).toEqual(["role-w"]);
    expect(table()!.errorMessage).toBe("");
    liveData.clear();
  });

  it("refreshes from the live query when a staff role changes elsewhere", async () => {
    let roles = [waiter];
    const liveData = new LiveData();
    await mount(
      fakeRequest(() => roles),
      { liveData },
    );
    roles = [waiter, { ...cook, position: 1 }];
    liveData.invalidate([{ type: "person_staff_roles" }]);
    await vi.waitFor(() => expect(rowKeys()).toEqual(["role-w", "role-c"]));
    liveData.clear();
  });

  it("opens the dialog for a new staff role from + New staff role", async () => {
    await mount(fakeRequest(() => [waiter]));
    const add = el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-staff-role]")!;
    expect(add.textContent!.trim()).toBe("+ New staff role");
    expect(dialog().open).toBe(false);
    await userEvent.click(add);
    await settle();
    expect(dialog().open).toBe(true);
    expect(dialog().staffRole).toBeUndefined();
  });

  it("opens the dialog on a staff role from its Edit action", async () => {
    await mount(fakeRequest(() => [waiter, cook]));
    await choose("edit-role-c");
    expect(dialog().open).toBe(true);
    expect(dialog().staffRole).toEqual(cook);
  });

  it("does not read the list again when the dialog is cancelled", async () => {
    const request = await mount(fakeRequest(() => [waiter]));
    await choose("edit-role-w");
    const reads = () =>
      request.mock.calls.filter(([path, method]) => path === BASE && (method ?? "GET") === "GET")
        .length;
    const before = reads();
    const closed = new Promise((resolve) =>
      dialog()
        .shadowRoot!.querySelector("wt-modal")!
        .addEventListener("wt-close", resolve, { once: true }),
    );
    dialog().shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-staff-role]")!.click();
    await closed;
    await settle();
    expect(dialog().open).toBe(false);
    expect(reads()).toBe(before);
  });

  it("with no live updates, reads again when a dialog that wrote closes, even with no saved event", async () => {
    const request = await mount(
      fakeRequest(() => [waiter], {
        [`POST ${BASE}`]: () => ({ ...runner, holderIds: [] }),
        [`PUT ${BASE}/role-r/holders`]: () => {
          throw { code: "connection.failed" };
        },
      }),
    );
    const reads = () =>
      request.mock.calls.filter(([path, method]) => path === BASE && (method ?? "GET") === "GET")
        .length;
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-staff-role]")!);
    await settle();
    const saved = vi.fn();
    el.addEventListener("staff-role-saved", saved);
    const inner = dialog();
    inner.shadowRoot!.querySelector("wt-input[name=name]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Runner" },
        bubbles: true,
        composed: true,
      }),
    );
    await inner.updateComplete;
    await chooseOptions(inner.shadowRoot!.querySelector("wt-combobox[name=people]")!, ["p-ana"]);
    await inner.updateComplete;
    inner.shadowRoot!.querySelector<HTMLElement>("[data-test=save-staff-role]")!.click();
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(`${BASE}/role-r/holders`, "PUT", {
        personIds: ["p-ana"],
      }),
    );
    await settle();
    const before = reads();
    const closed = new Promise((resolve) =>
      inner.shadowRoot!.querySelector("wt-modal")!.addEventListener("wt-close", resolve, {
        once: true,
      }),
    );
    inner.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-staff-role]")!.click();
    await closed;
    await settle();
    expect(saved).not.toHaveBeenCalled();
    expect(reads()).toBe(before + 1);
  });

  it("with live updates, leaves the refresh after a write to the live layer", async () => {
    const liveData = new LiveData();
    const request = await mount(
      fakeRequest(() => [waiter, cook]),
      { liveData },
    );
    const reads = () =>
      request.mock.calls.filter(([path, method]) => path === BASE && (method ?? "GET") === "GET")
        .length;
    const before = reads();
    await choose("move-down-role-w");
    await choose("delete-role-w");
    const modal = deleteModal()!;
    const closed = new Promise((resolve) =>
      modal.addEventListener("wt-close", resolve, { once: true }),
    );
    modal.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await closed;
    await settle();
    expect(request).toHaveBeenCalledWith(`${BASE}/role-w`, "DELETE");
    expect(reads()).toBe(before);
    liveData.clear();
  });

  it("moves a staff role up or down with reorder, offering only the moves it can make", async () => {
    const request = await mount(fakeRequest(() => [waiter, cook, runner]));
    expect(menuItem("move-up-role-w")).toBeNull();
    expect(menuItem("move-down-role-r")).toBeNull();
    expect(menuItem("move-down-role-w")!.textContent!.trim()).toBe("Move down");
    await choose("move-down-role-w");
    expect(request).toHaveBeenCalledWith(`${BASE}/order`, "PUT", {
      staffRoleIds: ["role-c", "role-w", "role-r"],
    });
    await choose("move-up-role-r");
    expect(request).toHaveBeenLastCalledWith(BASE, "GET", undefined, { passive: true });
    expect(request).toHaveBeenCalledWith(`${BASE}/order`, "PUT", {
      staffRoleIds: ["role-w", "role-r", "role-c"],
    });
  });

  it("says when a move is refused, and a read's recovery does not clear it", async () => {
    const liveData = new LiveData();
    await mount(
      fakeRequest(() => [waiter, cook], {
        [`PUT ${BASE}/order`]: () => {
          throw { code: "staffing.invalid" };
        },
      }),
      { liveData },
    );
    await choose("move-down-role-w");
    const message = `Could not move the staff role: ${codeMessage("staffing.invalid")}`;
    expect(alertText("action-alert")).toBe(message);
    liveData.invalidate([{ type: "staff_roles" }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await settle();
    expect(alertText("action-alert")).toBe(message);
    await choose("edit-role-c");
    expect(alertText("action-alert")).toBe("");
    liveData.clear();
  });

  it.each([
    ["+ New staff role", "new"],
    ["Delete", "delete"],
  ] as const)("clears a move's refusal when %s starts another action", async (_, action) => {
    await mount(
      fakeRequest(() => [waiter, cook], {
        [`PUT ${BASE}/order`]: () => {
          throw { code: "staffing.invalid" };
        },
      }),
    );
    await choose("move-down-role-w");
    expect(alertText("action-alert")).not.toBe("");
    if (action === "new")
      await userEvent.click(
        el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-staff-role]")!,
      );
    else await choose("delete-role-w");
    await settle();
    expect(alertText("action-alert")).toBe("");
  });

  it("asks before deleting, naming the painted blocks that go with it", async () => {
    const request = await mount(fakeRequest(() => [waiter, runner]));
    await choose("delete-role-r");
    const modal = deleteModal()!;
    expect(modal.getAttribute("heading")).toBe("Delete staff role");
    expect(modal.textContent).toContain("Delete Runner?");
    expect(modal.textContent).toContain("Its 3 painted staffing blocks go too.");
    expect(modal.textContent).not.toContain("shift");
    const closed = new Promise((resolve) =>
      modal.addEventListener("wt-close", resolve, { once: true }),
    );
    modal.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
    await closed;
    await settle();
    expect(request).toHaveBeenCalledWith(`${BASE}/role-r`, "DELETE");
    expect(deleteModal()).toBeNull();
  });

  it("says a staff role with shifts cannot be deleted, and draws Delete quiet and disabled", async () => {
    await mount(fakeRequest(() => [cook]));
    await choose("delete-role-c");
    const modal = deleteModal()!;
    expect(modal.textContent).toContain("Cook can't be deleted while 2 shifts use it.");
    expect(modal.textContent).not.toContain("Delete Cook?");
    expect(modal.textContent).not.toContain("painted");
    const confirm = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=confirm-delete]",
    )!;
    expect(confirm.disabled).toBe(true);
    expect(confirm.variant).toBe("secondary");
  });

  it("shows the in-use refusal when the shifts were assigned after the list was read", async () => {
    const request = await mount(
      fakeRequest(() => [{ ...cook, shiftCount: 0 }], {
        [`DELETE ${BASE}/role-c`]: () => {
          throw { code: "staff_role.in_use", params: { staffRoleId: "role-c" } };
        },
      }),
    );
    await choose("delete-role-c");
    const modal = deleteModal()!;
    expect(modal.textContent).toContain("Delete Cook?");
    const confirm = modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=confirm-delete]",
    )!;
    expect(confirm.variant).toBe("danger");
    confirm.click();
    await settle();
    expect(request).toHaveBeenCalledWith(`${BASE}/role-c`, "DELETE");
    expect(await deleteMessage()).toBe(
      `Could not delete the staff role: ${codeMessage("staff_role.in_use")}`,
    );
    expect(confirm.disabled).toBe(false);
    expect(deleteModal()).not.toBeNull();
  });

  it("names a single shift in the singular, in English and Spanish, and closes on Cancel", async () => {
    setLocale("es");
    await mount(fakeRequest(() => [{ ...cook, shiftCount: 1, blockCount: 0 }]));
    await choose("delete-role-c");
    expect(deleteModal()!.textContent).toContain(
      "No se puede eliminar Cook mientras lo use 1 turno.",
    );
    host.remove();
    setLocale("en");
    await mount(fakeRequest(() => [{ ...cook, shiftCount: 1, blockCount: 0 }]));
    await choose("delete-role-c");
    const modal = deleteModal()!;
    expect(modal.textContent).toContain("Cook can't be deleted while 1 shift uses it.");
    const closed = new Promise((resolve) =>
      modal.addEventListener("wt-close", resolve, { once: true }),
    );
    modal.querySelector<HTMLElement>("[data-test=cancel-delete]")!.click();
    await closed;
    await settle();
    expect(deleteModal()).toBeNull();
  });

  it("sends one reorder for a move pressed twice before it answers", async () => {
    let answer!: () => void;
    const request = await mount(
      fakeRequest(() => [waiter, cook], {
        [`PUT ${BASE}/order`]: () => new Promise<void>((resolve) => (answer = resolve)),
      }),
    );
    menuItem("move-down-role-w")!.click();
    await settle();
    menuItem("move-down-role-w")!.click();
    answer();
    await settle();
    expect(request.mock.calls.filter(([path]) => path === `${BASE}/order`)).toHaveLength(1);
  });

  it("sends one delete for a confirmation pressed again before it answers", async () => {
    let answer!: () => void;
    const request = await mount(
      fakeRequest(() => [waiter], {
        [`DELETE ${BASE}/role-w`]: () => new Promise<void>((resolve) => (answer = resolve)),
      }),
    );
    await choose("delete-role-w");
    const confirm = () => deleteModal()!.querySelector<HTMLElement>("[data-test=confirm-delete]")!;
    confirm().click();
    confirm().click();
    await settle();
    confirm().click();
    answer();
    await settle();
    expect(request.mock.calls.filter(([, method]) => method === "DELETE")).toHaveLength(1);
  });

  it.each(["answers", "is refused"] as const)(
    "drops a delete that %s after the page was taken out",
    async (outcome) => {
      let settleDelete!: { resolve: () => void; reject: (error: unknown) => void };
      await mount(
        fakeRequest(() => [waiter], {
          [`DELETE ${BASE}/role-w`]: () =>
            new Promise<void>((resolve, reject) => (settleDelete = { resolve, reject })),
        }),
      );
      await choose("delete-role-w");
      deleteModal()!.querySelector<HTMLElement>("[data-test=confirm-delete]")!.click();
      await settle();
      el.remove();
      if (outcome === "answers") settleDelete.resolve();
      else settleDelete.reject({ code: "staff_role.in_use" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      host.append(el);
      await settle();
      expect(deleteModal()).toBeNull();
    },
  );

  it("creates the next staff role after a held create answers once the page was taken out and put back", async () => {
    let answer!: (value: StaffRole) => void;
    let creates = 0;
    const request = await mount(
      fakeRequest(() => [waiter], {
        [`POST ${BASE}`]: (body) => {
          creates += 1;
          if (creates === 1) return new Promise<StaffRole>((resolve) => (answer = resolve));
          return { ...cook, ...(body as object), id: "role-cook" };
        },
      }),
    );
    const typeAndSave = async (name: string) => {
      const inner = dialog();
      inner
        .shadowRoot!.querySelector("wt-input[name=name]")!
        .dispatchEvent(
          new CustomEvent("wt-change", { detail: { value: name }, bubbles: true, composed: true }),
        );
      await inner.updateComplete;
      inner.shadowRoot!.querySelector<HTMLElement>("[data-test=save-staff-role]")!.click();
      await settle();
    };
    const add = () => el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-staff-role]")!;
    await userEvent.click(add());
    await settle();
    await typeAndSave("Runner");
    el.remove();
    host.append(el);
    await settle();
    await userEvent.click(add());
    await settle();
    answer({ ...runner, id: "role-runner" });
    await settle();
    await typeAndSave("Cook");
    expect(
      request.mock.calls.filter(([, method]) => method === "POST").map(([, , body]) => body),
    ).toEqual([
      { name: "Runner", colour: "blue" },
      { name: "Cook", colour: "blue" },
    ]);
    expect(request.mock.calls.filter(([, method]) => method === "PUT")).toEqual([]);
  });

  it("offers no changes to a reader", async () => {
    await mount(
      fakeRequest(() => [waiter]),
      { readOnly: true },
    );
    expect(el.shadowRoot!.querySelector("[data-test=new-staff-role]")).toBeNull();
    expect((table()!.columns as readonly DataTableColumn<StaffRole>[]).map((c) => c.key)).toEqual([
      "name",
      "people",
    ]);
    expect(row("role-w").querySelector("wt-row-actions")).toBeNull();
  });

  it("speaks Spanish", async () => {
    setLocale("es");
    await mount(fakeRequest(() => [waiter]));
    expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe("Roles de personal");
    expect(cells("role-w").slice(0, 2)).toEqual(["Waiter", "2 personas"]);
    expect(el.shadowRoot!.querySelector("[data-test=new-staff-role]")!.textContent!.trim()).toBe(
      "+ Nuevo rol de personal",
    );
  });

  it("stops watching when taken out of the page, and reads again when put back", async () => {
    const request = await mount(fakeRequest(() => [waiter]));
    const reads = () =>
      request.mock.calls.filter(([path, method]) => path === BASE && (method ?? "GET") === "GET")
        .length;
    const before = reads();
    el.remove();
    host.append(el);
    await settle();
    expect(reads()).toBe(before + 1);
    expect(rowKeys()).toEqual(["role-w"]);
  });
});
