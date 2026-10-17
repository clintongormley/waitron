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
import type { DeleteImpact } from "@waitron/shared";
import { StaffingApi, type ListedStaffRole, type StaffPerson, type StaffRole } from "./client.js";
import { HOLDER_NAMES_SHOWN, type StaffRolesScreen } from "./staff-roles-screen.js";
import { STAFFING_STRINGS } from "./strings.js";
import "./staff-roles-screen.js";

const BASE = "/management-api/staffing/staff-roles";

/** A staff role with what uses it, which only its delete-impact read reports. */
type Role = StaffRole & { blockCount: number; shiftCount: number };

const waiter: Role = {
  id: "role-w",
  name: "Waiter",
  colour: "green",
  position: 0,
  holderIds: ["p-ana", "p-marc"],
  blockCount: 0,
  shiftCount: 0,
};
const cook: Role = {
  id: "role-c",
  name: "Cook",
  colour: "red",
  position: 1,
  holderIds: ["p-ana"],
  blockCount: 1,
  shiftCount: 2,
};
const runner: Role = {
  id: "role-r",
  name: "Runner",
  colour: "purple",
  position: 2,
  holderIds: [],
  blockCount: 3,
  shiftCount: 0,
};
const people: StaffPerson[] = [{ personId: "p-ana", displayName: "Ana", status: "active" }];
const holderNameOf: Record<string, string> = { "p-ana": "Ana", "p-marc": "Marc" };

/** What the list read answers for `role`: it does not say what uses it. */
const listed = (
  { id, name, colour, position, holderIds }: Role,
  nameOf: (personId: string) => string = (personId) => holderNameOf[personId] ?? personId,
): ListedStaffRole => ({
  id,
  name,
  colour,
  position,
  holderIds,
  holderNames: holderIds.map(nameOf),
});

/** What the server's delete-impact read answers for `staffRole`. */
function impactOf(staffRole: Role): DeleteImpact {
  const holders = staffRole.holderIds.map((id) => ({
    id,
    name: people.find((person) => person.personId === id)?.displayName ?? id,
  }));
  return {
    target: { id: staffRole.id, name: staffRole.name },
    refusals:
      staffRole.shiftCount > 0
        ? [
            {
              code: "staff_role.in_use",
              params: { staffRoleId: staffRole.id, shiftCount: staffRole.shiftCount },
              targets: [],
            },
          ]
        : [],
    ends: [],
    removes: [
      ...(staffRole.blockCount > 0
        ? [{ key: "staff_role_blocks", count: staffRole.blockCount, targets: [] }]
        : []),
      ...(holders.length > 0
        ? [{ key: "staff_role_holders", count: holders.length, targets: holders }]
        : []),
    ],
  };
}

type Answer = (body: unknown) => unknown;
type Routes = Record<string, Answer>;

/** A request that answers `"<METHOD> <path>"` from `routes`, and lists `roles` for the page's read. */
function fakeRequest(roles: () => Role[], routes: Routes = {}) {
  return vi.fn(async (path: string, method: string = "GET", body?: unknown) => {
    const route = routes[`${method} ${path}`];
    if (route) return route(body);
    if (method === "GET" && path === BASE)
      return { staffRoles: roles().map((role) => listed(role)) };
    if (method === "GET" && path === "/management-api/staff") return people;
    const impact = /^\/management-api\/staffing\/staff-roles\/([^/]+)\/delete-impact$/.exec(path);
    if (method === "GET" && impact)
      return impactOf(roles().find((listed) => listed.id === decodeURIComponent(impact[1]!))!);
    if (method === "PUT" && path === `${BASE}/order`) return undefined;
    if (method === "DELETE")
      return impactOf(roles().find((listed) => path === `${BASE}/${listed.id}`)!);
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
const deleteDialog = () =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-delete-dialog"]>(
    "wt-delete-dialog[data-test=delete-staff-role]",
  );
const inDialog = <T extends Element = HTMLElementTagNameMap["wt-button"]>(selector: string) =>
  deleteDialog()!.shadowRoot!.querySelector<T>(selector)!;
const confirmDelete = () => inDialog("[data-test=delete-confirm]");
const dialogText = () => deleteDialog()!.shadowRoot!.textContent!.replace(/\s+/g, " ");
const dialogLines = () =>
  [...deleteDialog()!.shadowRoot!.querySelectorAll("li")].map((line) => line.textContent!.trim());
const alertText = (test: string) =>
  el.shadowRoot!.querySelector(`[data-test=${test}]`)?.textContent?.trim() ?? "";
const GONE = "That staff role could not be found. It may have been deleted";

async function choose(test: string) {
  const item = menuItem(test);
  expect(item, test).not.toBeNull();
  const menu = item!.closest("wt-row-actions")!;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await userEvent.click(item!);
  await settle();
}

async function deleteMessage() {
  const actions = inDialog<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions");
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}

/** Presses Delete in the dialog and waits for it to close itself. */
async function confirmAndClose() {
  const dialog = deleteDialog()!;
  confirmDelete().click();
  await vi.waitFor(() => expect(dialog.isConnected).toBe(false));
  await settle();
}

describe("the staff roles page", () => {
  it("lists each staff role's swatch and name, and who holds it, in position order", async () => {
    await mount(fakeRequest(() => [runner, waiter, cook]));
    expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe("Staff roles");
    expect(rowKeys()).toEqual(["role-w", "role-c", "role-r"]);
    expect(
      (table()!.columns as readonly DataTableColumn<StaffRole>[]).map((column) => column.key),
    ).toEqual(["name", "people", "actions"]);
    expect(cells("role-w").slice(0, 2)).toEqual(["Waiter", "Ana, Marc"]);
    expect(cells("role-c").slice(0, 2)).toEqual(["Cook", "Ana"]);
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

  it("names the first holders and says how many more there are, to a reader too", async () => {
    const holders = (count: number) =>
      Array.from({ length: count }, (_, index) => `p-${String(index + 1).padStart(2, "0")}`);
    const nameOf = (personId: string) => `Person ${personId.slice(2)}`;
    const many = { ...waiter, holderIds: holders(HOLDER_NAMES_SHOWN + 2) };
    const exact = { ...cook, holderIds: holders(HOLDER_NAMES_SHOWN) };
    const request = () =>
      fakeRequest(() => [many, exact], {
        [`GET ${BASE}`]: () => ({ staffRoles: [many, exact].map((role) => listed(role, nameOf)) }),
      });
    const shown = holders(HOLDER_NAMES_SHOWN).map(nameOf).join(", ");
    for (const readOnly of [false, true]) {
      host?.remove();
      await mount(request(), { readOnly });
      expect(cells("role-w")[1], `readOnly ${readOnly}`).toBe(`${shown} plus 2 more`);
      expect(cells("role-c")[1], `readOnly ${readOnly}`).toBe(shown);
    }
    host.remove();
    setLocale("es");
    await mount(request());
    expect(cells("role-w")[1]).toBe(`${shown} y 2 más`);
    expect(cells("role-c")[1]).toBe(shown);
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
    answer({ staffRoles: [listed(waiter)] });
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
        return { staffRoles: [listed(waiter)] };
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
        return { staffRoles: [listed(waiter)] };
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

  it("refreshes a renamed holder in the delete warning and in the list, and refreshes the holders", async () => {
    let roles = [{ ...runner, blockCount: 0, holderIds: ["p-ana"] }];
    let holderName = "Ana";
    const liveData = new LiveData();
    const request = await mount(
      fakeRequest(() => roles, {
        [`GET ${BASE}`]: () => ({
          staffRoles: roles.map((role) =>
            listed(role, (personId) =>
              personId === "p-ana" ? holderName : holderNameOf[personId]!,
            ),
          ),
        }),
        [`GET ${BASE}/role-r/delete-impact`]: () => ({
          ...impactOf(roles[0]!),
          removes: [
            {
              key: "staff_role_holders",
              count: roles[0]!.holderIds.length,
              targets: roles[0]!.holderIds.map((id) => ({
                id,
                name: id === "p-ana" ? holderName : id,
              })),
            },
          ],
        }),
      }),
      { liveData },
    );
    const listReads = () => request.mock.calls.filter(([path]) => path === BASE).length;
    await choose("delete-role-r");
    expect(dialogLines()).toEqual(["Removes it from 1 person: Ana."]);
    expect(cells("role-r")[1]).toBe("Ana");
    expect(listReads()).toBe(1);

    holderName = "Ana Ruiz";
    liveData.invalidate([{ type: "persons" }]);
    await vi.waitFor(() => expect(dialogLines()).toEqual(["Removes it from 1 person: Ana Ruiz."]));
    await vi.waitFor(() => expect(cells("role-r")[1]).toBe("Ana Ruiz"));
    expect(listReads()).toBe(2);

    roles = [{ ...runner, blockCount: 0, holderIds: ["p-ana", "p-marc"] }];
    liveData.invalidate([{ type: "person_staff_roles" }]);
    await vi.waitFor(() => expect(cells("role-r")[1]).toBe("Ana Ruiz, Marc"));
    expect(listReads()).toBe(3);
    liveData.clear();
  });

  it("opens the dialog for a new staff role from Add staff role", async () => {
    await mount(fakeRequest(() => [waiter]));
    const add = el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-staff-role]")!;
    expect(add.textContent!.trim()).toBe("Add staff role");
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
    expect(dialog().staffRole).toEqual(listed(cook));
  });

  it("hands a new staff role's dialog the staff roles, so it starts on a colour none uses", async () => {
    await mount(fakeRequest(() => [waiter, cook, runner]));
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=new-staff-role]")!);
    await settle();
    expect(dialog().staffRoles).toEqual([waiter, cook, runner].map((role) => listed(role)));
    const colour = dialog().shadowRoot!.querySelector<HTMLElementTagNameMap["wt-colour-chooser"]>(
      "wt-colour-chooser[name=colour]",
    )!;
    expect(colour.value).toBe("orange");
  });

  it("hands an edited staff role's dialog every staff role, its own included", async () => {
    await mount(fakeRequest(() => [waiter, cook, runner]));
    await choose("edit-role-c");
    expect(dialog().staffRoles).toEqual([waiter, cook, runner].map((role) => listed(role)));
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
    await confirmAndClose();
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
    ["Add staff role", "new"],
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

  it("asks with the shared delete dialog, naming the staff role and the blocks and people it removes", async () => {
    const withAna = { ...runner, holderIds: ["p-ana"] };
    const request = await mount(fakeRequest(() => [waiter, withAna]));
    await choose("delete-role-r");
    expect(request).toHaveBeenCalledWith(`${BASE}/role-r/delete-impact`, "GET", undefined, {
      passive: true,
    });
    const dialog = deleteDialog()!;
    expect(dialog.open).toBe(true);
    expect(inDialog<HTMLElementTagNameMap["wt-modal"]>("wt-modal").heading).toBe(
      "Delete staff role",
    );
    expect(inDialog("[data-target]").textContent).toBe("Runner");
    expect(dialogLines()).toEqual([
      "Removes 3 painted staffing blocks.",
      "Removes it from 1 person: Ana.",
    ]);
    expect(dialogText()).toContain("Settings removed");
    expect(dialogText()).toContain("This cannot be undone.");
    expect(confirmDelete().variant).toBe("danger");
    expect(confirmDelete().disabled).toBe(false);
    await confirmAndClose();
    expect(request).toHaveBeenCalledWith(`${BASE}/role-r`, "DELETE");
    expect(deleteDialog()).toBeNull();
  });

  it("says a staff role with shifts cannot be deleted, and draws Delete quiet and disabled", async () => {
    await mount(fakeRequest(() => [cook]));
    await choose("delete-role-c");
    expect(inDialog("[data-target]").textContent).toBe("Cook");
    expect(dialogText()).toContain("Why this cannot be deleted");
    expect(dialogLines()).toContain("2 shifts use this staff role.");
    expect(confirmDelete().disabled).toBe(true);
    expect(confirmDelete().variant).toBe("secondary");
  });

  it("shows the in-use refusal when the shifts were assigned after the impact was read, and leaves Delete usable", async () => {
    const request = await mount(
      fakeRequest(() => [{ ...cook, shiftCount: 0 }], {
        [`DELETE ${BASE}/role-c`]: () => {
          throw { code: "staff_role.in_use", params: { staffRoleId: "role-c", shiftCount: 1 } };
        },
      }),
    );
    await choose("delete-role-c");
    expect(dialogLines()).toEqual([
      "Removes 1 painted staffing block.",
      "Removes it from 1 person: Ana.",
    ]);
    expect(confirmDelete().variant).toBe("danger");
    confirmDelete().click();
    await settle();
    expect(request).toHaveBeenCalledWith(`${BASE}/role-c`, "DELETE");
    expect(await deleteMessage()).toBe(
      `Could not delete the staff role: ${codeMessage("staff_role.in_use")}`,
    );
    expect(confirmDelete().disabled).toBe(false);
    expect(deleteDialog()).not.toBeNull();
  });

  it("names a single shift in the singular, in English and Spanish, and closes on Cancel", async () => {
    setLocale("es");
    await mount(fakeRequest(() => [{ ...cook, shiftCount: 1, blockCount: 0, holderIds: [] }]));
    await choose("delete-role-c");
    // The Spanish line is read from the catalogue: its word for a shift is on the English-only list.
    expect(dialogLines()).toEqual([STAFFING_STRINGS.es["staffing.role.delete_shifts_one"]]);
    expect(dialogText()).toContain("Por qué no se puede eliminar");
    host.remove();
    setLocale("en");
    await mount(fakeRequest(() => [{ ...cook, shiftCount: 1, blockCount: 0, holderIds: [] }]));
    await choose("delete-role-c");
    expect(dialogLines()).toEqual(["1 shift uses this staff role."]);
    inDialog<HTMLElement>("[data-test=delete-cancel]").click();
    await settle();
    expect(deleteDialog()).toBeNull();
  });

  it("names what a delete removes in Spanish", async () => {
    setLocale("es");
    await mount(fakeRequest(() => [{ ...runner, blockCount: 1, holderIds: ["p-ana", "p-x"] }]));
    await choose("delete-role-r");
    expect(dialogLines()).toEqual([
      "Quita 1 bloque de personal pintado.",
      "Se lo quita a 2 personas: Ana, p-x.",
    ]);
  });

  it("says when the impact cannot be read, holds Delete, and reads again on Try again", async () => {
    let fail = true;
    const request = await mount(
      fakeRequest(() => [runner], {
        [`GET ${BASE}/role-r/delete-impact`]: () => {
          if (fail) throw { code: "connection.failed" };
          return impactOf(runner);
        },
      }),
    );
    await choose("delete-role-r");
    expect(await deleteMessage()).toBe(
      `Could not load what deleting it would change: ${codeMessage("connection.failed")}`,
    );
    expect(confirmDelete().disabled).toBe(true);
    fail = false;
    inDialog<HTMLElement>("[data-test=delete-retry]").click();
    await settle();
    expect(dialogLines()).toEqual(["Removes 3 painted staffing blocks."]);
    expect(await deleteMessage()).toBe("");
    expect(confirmDelete().disabled).toBe(false);
    expect(
      request.mock.calls.filter(([path]) => path === `${BASE}/role-r/delete-impact`),
    ).toHaveLength(2);
  });

  it("shows the impact loading until its read answers", async () => {
    let answer!: (value: DeleteImpact) => void;
    await mount(
      fakeRequest(() => [runner], {
        [`GET ${BASE}/role-r/delete-impact`]: () =>
          new Promise<DeleteImpact>((resolve) => (answer = resolve)),
      }),
    );
    await choose("delete-role-r");
    expect(deleteDialog()!.loading).toBe(true);
    expect(dialogText()).toContain("Checking what deleting this staff role would change…");
    expect(confirmDelete().disabled).toBe(true);
    answer(impactOf(runner));
    await settle();
    expect(deleteDialog()!.loading).toBe(false);
    expect(confirmDelete().disabled).toBe(false);
  });

  it("reads the impact again when a shift starts using the staff role elsewhere", async () => {
    let roles = [runner];
    const liveData = new LiveData();
    await mount(
      fakeRequest(() => roles),
      { liveData },
    );
    await choose("delete-role-r");
    expect(confirmDelete().disabled).toBe(false);
    roles = [{ ...runner, shiftCount: 1 }];
    liveData.invalidate([{ type: "shift_assignments" }]);
    await vi.waitFor(() => expect(dialogLines()).toContain("1 shift uses this staff role."));
    expect(confirmDelete().disabled).toBe(true);
    liveData.clear();
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
    confirmDelete().click();
    confirmDelete().click();
    await settle();
    confirmDelete().click();
    answer();
    await settle();
    expect(request.mock.calls.filter(([, method]) => method === "DELETE")).toHaveLength(1);
  });

  it("closes the delete question, says why and reads the list again when the impact read finds the staff role gone", async () => {
    let roles = [waiter, runner];
    const request = await mount(
      fakeRequest(() => roles, {
        [`GET ${BASE}/role-r/delete-impact`]: () => {
          throw { code: "staff_role.not_found" };
        },
      }),
    );
    const reads = () =>
      request.mock.calls.filter(([path, method]) => path === BASE && (method ?? "GET") === "GET")
        .length;
    const before = reads();
    roles = [waiter];
    await choose("delete-role-r");
    expect(deleteDialog()).toBeNull();
    expect(reads()).toBe(before + 1);
    expect(rowKeys()).toEqual(["role-w"]);
    expect(alertText("action-alert")).toBe(GONE);
  });

  it("ignores the impact read finding the staff role gone while its own delete is in flight", async () => {
    let answer!: (impact: DeleteImpact) => void;
    let gone = false;
    const liveData = new LiveData();
    const request = await mount(
      fakeRequest(() => [waiter], {
        [`GET ${BASE}/role-w/delete-impact`]: () => {
          if (gone) throw { code: "staff_role.not_found" };
          return impactOf(waiter);
        },
        [`DELETE ${BASE}/role-w`]: () => new Promise<DeleteImpact>((resolve) => (answer = resolve)),
      }),
      { liveData },
    );
    await choose("delete-role-w");
    confirmDelete().click();
    await settle();
    gone = true;
    liveData.invalidate([{ type: "staff_roles" }]);
    await vi.waitFor(() =>
      expect(
        request.mock.calls.filter(([path]) => path === `${BASE}/role-w/delete-impact`),
      ).toHaveLength(2),
    );
    await settle();
    expect(deleteDialog()!.submitting).toBe(true);
    expect(deleteDialog()!.readError).toBe("");
    answer(impactOf(waiter));
    await settle();
    expect(deleteDialog()).toBeNull();
    expect(alertText("action-alert")).toBe("");
    liveData.clear();
  });

  it("closes the delete question, says why and reads the list again when the delete finds the staff role gone", async () => {
    let roles = [waiter, runner];
    const request = await mount(
      fakeRequest(() => roles, {
        [`DELETE ${BASE}/role-r`]: () => {
          throw { code: "staff_role.not_found", params: { staffRoleId: "role-r" } };
        },
      }),
    );
    const reads = () =>
      request.mock.calls.filter(([path, method]) => path === BASE && (method ?? "GET") === "GET")
        .length;
    await choose("delete-role-r");
    const before = reads();
    roles = [waiter];
    confirmDelete().click();
    await settle();
    expect(request).toHaveBeenCalledWith(`${BASE}/role-r`, "DELETE");
    expect(deleteDialog()).toBeNull();
    expect(reads()).toBe(before + 1);
    expect(rowKeys()).toEqual(["role-w"]);
    expect(alertText("action-alert")).toBe(GONE);
  });

  it("keeps the delete question open when asked to close while its delete is in flight, then closes it on success", async () => {
    let answer!: (impact: DeleteImpact) => void;
    const request = await mount(
      fakeRequest(() => [waiter, runner], {
        [`DELETE ${BASE}/role-r`]: () => new Promise<DeleteImpact>((resolve) => (answer = resolve)),
      }),
    );
    const reads = () =>
      request.mock.calls.filter(([path, method]) => path === BASE && (method ?? "GET") === "GET")
        .length;
    await choose("delete-role-r");
    confirmDelete().click();
    await settle();
    deleteDialog()!.dispatchEvent(
      new CustomEvent("wt-close", { detail: {}, bubbles: true, composed: true }),
    );
    await settle();
    expect(deleteDialog()).not.toBeNull();
    expect(deleteDialog()!.submitting).toBe(true);
    const before = reads();
    answer(impactOf(runner));
    await settle();
    expect(deleteDialog()).toBeNull();
    expect(reads()).toBe(before + 1);
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
      confirmDelete().click();
      await settle();
      el.remove();
      if (outcome === "answers") settleDelete.resolve();
      else settleDelete.reject({ code: "staff_role.in_use" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      host.append(el);
      await settle();
      expect(deleteDialog()).toBeNull();
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
      { name: "Runner", colour: "red" },
      { name: "Cook", colour: "red" },
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
    await mount(fakeRequest(() => [waiter, runner]));
    expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe("Roles de personal");
    expect(cells("role-w").slice(0, 2)).toEqual(["Waiter", "Ana, Marc"]);
    expect(cells("role-r").slice(0, 2)).toEqual(["Runner", "Nadie"]);
    expect(el.shadowRoot!.querySelector("[data-test=new-staff-role]")!.textContent!.trim()).toBe(
      "Añadir rol de personal",
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
