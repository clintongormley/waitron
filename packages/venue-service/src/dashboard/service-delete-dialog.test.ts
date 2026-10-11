import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { DeleteImpact } from "@waitron/shared";
import {
  allowedImpact,
  deferred,
  mountDelete,
  openDelete,
  view,
} from "../../test/service-delete-test-helpers.js";
const button = (dialog: HTMLElementTagNameMap["wt-delete-dialog"], kind = "confirm") =>
  dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `[data-test="delete-${kind}"]`,
  )!;
async function ready(dialog: HTMLElementTagNameMap["wt-delete-dialog"]) {
  await expect.poll(() => dialog.loading).toBe(false);
  await dialog.updateComplete;
}
it("permanent delete cannot confirm a pending or failed read and retries it", async () => {
  const read = deferred<DeleteImpact>();
  const next = deferred<DeleteImpact>();
  const { screen, api } = await mountDelete({
    getDepartmentDeleteImpact: vi
      .fn()
      .mockReturnValueOnce(read.promise)
      .mockReturnValue(next.promise),
  });
  const dialog = await openDelete(screen);
  dialog.dispatchEvent(new CustomEvent("wt-delete-confirm", { detail: { id: "d1" } }));
  expect(api.deleteDepartment).not.toHaveBeenCalled();
  read.reject({ code: "connection.failed" });
  await expect.poll(() => dialog.readError).not.toBe("");
  button(dialog, "retry").click();
  await expect.poll(() => dialog.loading).toBe(true);
  next.resolve(allowedImpact);
  await ready(dialog);
  expect(dialog.readError).toBe("");
  expect(button(dialog).disabled).toBe(false);
});
it("permanent delete rejects an impact for another target", async () => {
  const { screen, api } = await mountDelete({
    getDepartmentDeleteImpact: vi
      .fn()
      .mockResolvedValue({ ...allowedImpact, target: { id: "other", name: "Other" } }),
  });
  const dialog = await openDelete(screen);
  await expect.poll(() => dialog.readError).not.toBe("");
  expect(button(dialog).disabled).toBe(true);
  expect(api.deleteDepartment).not.toHaveBeenCalled();
});
it("permanent delete sends only the captured id once and prevents pending dismissal", async () => {
  const write = deferred<DeleteImpact>();
  const { screen, api } = await mountDelete({
    deleteDepartment: vi.fn().mockReturnValue(write.promise),
  });
  const dialog = await openDelete(screen);
  await ready(dialog);
  button(dialog).click();
  dialog.dispatchEvent(new CustomEvent("wt-delete-confirm", { detail: { id: "d1" } }));
  dialog.dispatchEvent(new CustomEvent("wt-close"));
  await screen.updateComplete;
  expect(api.deleteDepartment).toHaveBeenCalledExactlyOnceWith("d1");
  expect(screen.shadowRoot!.querySelector("wt-delete-dialog")).toBe(dialog);
  expect(await dialog.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel")).toBe(false);
  write.resolve(allowedImpact);
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-delete-dialog")).toBeNull();
});
it("permanent delete keeps independent action and read errors, recovering only the read", async () => {
  const read = vi.fn().mockResolvedValue(allowedImpact);
  const { screen } = await mountDelete({
    getDepartmentDeleteImpact: read,
    deleteDepartment: vi.fn().mockRejectedValue({ code: "connection.failed" }),
  });
  const dialog = await openDelete(screen);
  await ready(dialog);
  button(dialog).click();
  await expect.poll(() => dialog.actionError).not.toBe("");
  read.mockRejectedValueOnce({ code: "connection.failed" });
  dialog.dispatchEvent(new CustomEvent("wt-delete-retry"));
  await expect.poll(() => dialog.readError).not.toBe("");
  button(dialog, "retry").click();
  await expect.poll(() => dialog.readError).toBe("");
  expect(dialog.actionError).not.toBe("");
  expect(button(dialog).disabled).toBe(false);
});
it("permanent delete refreshes a refusal created after the read", async () => {
  const blocked = {
    ...allowedImpact,
    refusals: [
      {
        code: "department.order_in_progress",
        params: { departmentId: "d1", count: 3 },
        targets: [],
      },
    ],
  };
  const { screen, api } = await mountDelete({
    getDepartmentDeleteImpact: vi
      .fn()
      .mockResolvedValueOnce(allowedImpact)
      .mockResolvedValue(blocked),
    deleteDepartment: vi.fn().mockRejectedValue({
      code: "department.order_in_progress",
      params: { departmentId: "d1", count: 3 },
    }),
  });
  const dialog = await openDelete(screen);
  await ready(dialog);
  button(dialog).click();
  await expect.poll(() => dialog.impact?.refusals.length).toBe(1);
  expect(dialog.actionError).toBe("An order is still open or placed in this department.");
  expect(button(dialog).disabled).toBe(true);
  expect(api.deleteDepartment).toHaveBeenCalledTimes(1);
});
it.each(["confirm", "retry", "close"])(
  "permanent delete ignores a departed %s callback on a same-render replacement",
  async (kind) => {
    const read = vi.fn().mockResolvedValue(allowedImpact);
    const { screen, api } = await mountDelete({ getDepartmentDeleteImpact: read });
    const old = await openDelete(screen);
    await ready(old);
    old.dispatchEvent(new CustomEvent("wt-close"));
    const nextPromise = openDelete(screen);
    old.dispatchEvent(
      new CustomEvent(
        kind === "confirm"
          ? "wt-delete-confirm"
          : kind === "retry"
            ? "wt-delete-retry"
            : "wt-close",
        { detail: { id: "d1" } },
      ),
    );
    const next = await nextPromise;
    await ready(next);
    expect(next).not.toBe(old);
    expect(next.open).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    expect(api.deleteDepartment).not.toHaveBeenCalled();
  },
);
it.each(["confirm", "retry"] as const)(
  "permanent delete ignores a detached native %s control after a same-render replacement",
  async (kind) => {
    const read = vi.fn();
    if (kind === "retry") read.mockRejectedValueOnce({ code: "connection.failed" });
    else read.mockResolvedValueOnce(allowedImpact);
    read.mockResolvedValue(allowedImpact);
    const { screen, api } = await mountDelete({ getDepartmentDeleteImpact: read });
    const old = await openDelete(screen);
    await ready(old);
    if (kind === "retry") await expect.poll(() => old.readError).not.toBe("");
    const oldHost = button(old, kind);
    await oldHost.updateComplete;
    const native = oldHost.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
    expect(native.disabled).toBe(false);
    old.dispatchEvent(new CustomEvent("wt-close"));
    const opening = openDelete(screen);
    const next = await opening;
    await ready(next);
    native.click();
    await screen.updateComplete;
    await next.updateComplete;
    expect(screen.shadowRoot!.querySelector("wt-delete-dialog")).toBe(next);
    expect(next.open).toBe(true);
    expect(next.impact).toEqual(allowedImpact);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls).toEqual([["d1"], ["d1"]]);
    expect(api.deleteDepartment).not.toHaveBeenCalled();
    expect(next).not.toBe(old);
    expect(native.isConnected).toBe(false);
  },
);
it.each([false, true])(
  "permanent delete ignores a departed %s write after reconnecting",
  async (refused) => {
    const write = deferred<DeleteImpact>();
    const { screen, host, api } = await mountDelete({
      deleteDepartment: vi.fn().mockReturnValue(write.promise),
    });
    const old = await openDelete(screen);
    await ready(old);
    button(old).click();
    screen.remove();
    host.append(screen);
    const next = await openDelete(screen);
    await ready(next);
    if (refused) write.reject({ code: "connection.failed" });
    else write.resolve(allowedImpact);
    await Promise.resolve();
    await screen.updateComplete;
    expect(next.open).toBe(true);
    expect(next.actionError).toBe("");
    expect(api.deleteDepartment).toHaveBeenCalledTimes(1);
  },
);
it.each(["resolved", "rejected"] as const)(
  "permanent delete ignores a %s old write after reconnecting with the same dialog object",
  async (outcome) => {
    const write = deferred<DeleteImpact>();
    const saved = vi.fn();
    const { screen, host, api } = await mountDelete({
      deleteDepartment: vi.fn().mockReturnValue(write.promise),
    });
    screen.addEventListener("saved", saved);
    const old = await openDelete(screen);
    await ready(old);
    const retained = screen.dialog;
    button(old).click();
    await expect.poll(() => old.submitting).toBe(true);
    screen.remove();
    host.append(screen);
    await screen.updateComplete;
    const next = screen.shadowRoot!.querySelector("wt-delete-dialog")!;
    expect(next).not.toBe(old);
    expect(screen.dialog).toBe(retained);
    await ready(next);
    const modal = next.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    const confirm = button(next);
    await confirm.updateComplete;
    expect(confirm.shadowRoot!.querySelector("button")!.disabled).toBe(false);
    if (outcome === "rejected") write.reject({ code: "connection.failed" });
    else write.resolve(allowedImpact);
    await write.promise.catch(() => {});
    await screen.updateComplete;
    await next.updateComplete;
    expect(screen.dialog).toBe(retained);
    expect(screen.shadowRoot!.querySelector("wt-delete-dialog")).toBe(next);
    expect(next.open).toBe(true);
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect(next.actionError).toBe("");
    expect(next.readError).toBe("");
    expect(next.submitting).toBe(false);
    expect(saved).not.toHaveBeenCalled();
    expect(api.deleteDepartment).toHaveBeenCalledExactlyOnceWith("d1");
  },
);
it("permanent delete ignores a departed read and not-found closes only that target", async () => {
  const oldRead = deferred<DeleteImpact>();
  const read = vi.fn().mockReturnValueOnce(oldRead.promise).mockResolvedValue(allowedImpact);
  const { screen } = await mountDelete({ getDepartmentDeleteImpact: read });
  const old = await openDelete(screen);
  old.dispatchEvent(new CustomEvent("wt-close"));
  const next = await openDelete(screen);
  await ready(next);
  oldRead.resolve({
    ...allowedImpact,
    refusals: [{ code: "department.last_active", params: {}, targets: [] }],
  });
  await Promise.resolve();
  expect(next.impact).toEqual(allowedImpact);
  read.mockRejectedValue({ code: "department.not_found" });
  next.dispatchEvent(new CustomEvent("wt-delete-retry"));
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-delete-dialog")).toBeNull();
});

it.each(["department", "zone"] as const)(
  "%s names descendants and uses native Delete without empty groups",
  async (kind) => {
    const impact: DeleteImpact = {
      ...allowedImpact,
      target: kind === "zone" ? { id: "z1", name: "Patio" } : allowedImpact.target,
      removes: [
        {
          key: "tables",
          count: 3,
          targets: [{ id: "private", name: "Table without a today row" }],
        },
        { key: "zones", count: 2, targets: [{ id: "zone", name: "Terrace" }] },
      ],
    };
    const { screen, api } = await mountDelete(
      {
        getDepartmentDeleteImpact: vi.fn().mockResolvedValue(impact),
        getZoneDeleteImpact: vi.fn().mockResolvedValue(impact),
      },
      "light",
      kind,
    );
    const dialog = await openDelete(screen, kind);
    await ready(dialog);
    expect(dialog.shadowRoot!.textContent).toContain(impact.target.name);
    expect(dialog.shadowRoot!.textContent).toContain("Deletes 3 tables.");
    expect(dialog.shadowRoot!.textContent).toContain("Terrace");
    expect(dialog.shadowRoot!.textContent).toContain("This cannot be undone.");
    expect(dialog.shadowRoot!.textContent).not.toContain("private");
    expect(dialog.shadowRoot!.querySelector('[data-group="ends"]')).toBeNull();
    await button(dialog).updateComplete;
    expect(button(dialog).shadowRoot!.querySelector("button")!.disabled).toBe(false);
    button(dialog).click();
    await expect.poll(() => screen.dialog).toBeUndefined();
    expect(kind === "zone" ? api.deleteZone : api.deleteDepartment).toHaveBeenCalledExactlyOnceWith(
      impact.target.id,
    );
  },
);
it("live blocker and recovery change Confirm while preserving action refusal", async () => {
  let apply!: (value: DeleteImpact) => void;
  let fail!: (error: unknown) => void;
  let recover!: () => void;
  const detach = vi.fn();
  const { screen } = await mountDelete({
    watchDepartmentDeleteImpact: vi.fn((_id, a, f, r) => {
      apply = a;
      fail = f;
      recover = r;
      return detach;
    }),
    deleteDepartment: vi.fn().mockRejectedValue({ code: "connection.failed" }),
  });
  const dialog = await openDelete(screen);
  apply(allowedImpact);
  await ready(dialog);
  button(dialog).click();
  await expect.poll(() => dialog.actionError).not.toBe("");
  fail({ code: "connection.failed" });
  await expect.poll(() => dialog.readError).not.toBe("");
  apply({
    ...allowedImpact,
    refusals: [{ code: "department.last_active", params: {}, targets: [] }],
  });
  recover();
  await dialog.updateComplete;
  expect(dialog.readError).toBe("");
  expect(dialog.actionError).not.toBe("");
  expect(button(dialog).disabled).toBe(true);
  apply(allowedImpact);
  await screen.updateComplete;
  await dialog.updateComplete;
  expect(button(dialog).disabled).toBe(false);
  dialog.dispatchEvent(new CustomEvent("wt-close"));
  await screen.updateComplete;
  expect(detach).toHaveBeenCalledOnce();
});
it("native Cancel waits for its close event and sends no deletion", async () => {
  const { screen, api } = await mountDelete();
  const dialog = await openDelete(screen);
  await ready(dialog);
  const closed = new Promise<void>((resolve) =>
    dialog.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  button(dialog, "cancel").click();
  await closed;
  await expect.poll(() => screen.dialog).toBeUndefined();
  expect(api.deleteDepartment).not.toHaveBeenCalled();
});
it("native Escape cannot dismiss a pending Delete", async () => {
  const write = deferred<DeleteImpact>();
  const { screen } = await mountDelete({
    deleteDepartment: vi.fn().mockReturnValue(write.promise),
  });
  const dialog = await openDelete(screen);
  await ready(dialog);
  button(dialog).click();
  await dialog.updateComplete;
  const modal = dialog.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  modal.shadowRoot!.querySelector<HTMLElement>(".body")!.focus();
  await userEvent.keyboard("{Escape}");
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  write.resolve(allowedImpact);
  await expect.poll(() => screen.dialog).toBeUndefined();
});
it("A to B to A openings invalidate the first read and callbacks", async () => {
  const old = deferred<DeleteImpact>();
  const { screen, api } = await mountDelete({
    getDepartmentDeleteImpact: vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(allowedImpact),
  });
  const first = await openDelete(screen);
  const second = await openDelete(screen, "zone");
  await ready(second);
  const next = await openDelete(screen);
  await ready(next);
  old.resolve({
    ...allowedImpact,
    refusals: [{ code: "department.last_active", params: {}, targets: [] }],
  });
  first.dispatchEvent(new CustomEvent("wt-delete-confirm", { detail: { id: "d1" } }));
  await screen.updateComplete;
  await next.updateComplete;
  expect(next.impact).toEqual(allowedImpact);
  expect(api.deleteDepartment).not.toHaveBeenCalled();
  expect(first.isConnected).toBe(false);
});

it.each(["readonly", "refreshing"] as const)(
  "%s confirmation cannot write even from a retained native control",
  async (mode) => {
    const { screen, api } = await mountDelete();
    const dialog = await openDelete(screen);
    await ready(dialog);
    const confirm = button(dialog);
    await confirm.updateComplete;
    const native = confirm.shadowRoot!.querySelector("button")!;
    screen[mode] = true;
    native.click();
    dialog.dispatchEvent(new CustomEvent("wt-delete-confirm", { detail: { id: "d1" } }));
    await screen.updateComplete;
    await dialog.updateComplete;
    expect(api.deleteDepartment).not.toHaveBeenCalled();
    expect(button(dialog).disabled).toBe(true);
  },
);
it("names an order supplied by the impact without exposing its id", async () => {
  const impact = {
    ...allowedImpact,
    refusals: [
      {
        code: "table.delivery_in_progress",
        params: { workingOrderId: "private-order" },
        targets: [{ id: "private-order", name: "Order 73" }],
      },
    ],
  };
  const { screen } = await mountDelete({
    getDepartmentDeleteImpact: vi.fn().mockResolvedValue(impact),
  });
  const dialog = await openDelete(screen);
  await ready(dialog);
  expect(dialog.shadowRoot!.textContent).toContain("Order 73");
  expect(dialog.shadowRoot!.textContent).not.toContain("private-order");
  expect(button(dialog).disabled).toBe(true);
});
async function mountShell(readFailure = false) {
  await import("./venue-departments-shell.js");
  const { host } = await mountDelete();
  host.replaceChildren();
  history.replaceState(null, "", "/manage/venue-operations");
  const shell = document.createElement("venue-departments-shell");
  const { VenueServiceApi } = await import("./client.js");
  let missing = false;
  let reads = 0;
  let failLoad = false;
  const writes: string[] = [];
  shell.api = new VenueServiceApi((async (path: string, method = "GET") => {
    if (method === "DELETE") {
      writes.push(path);
      failLoad = readFailure;
      return allowedImpact;
    }
    if (path.endsWith("/delete-impact")) {
      reads++;
      if (missing) throw { code: "department.not_found" };
      return allowedImpact;
    }
    if (path === "/management-api/venue-service") {
      if (failLoad) throw { code: "connection.failed" };
      return structuredClone(view);
    }
    if (path.startsWith("/management-api/zones?")) return view.floorZones;
    return [];
  }) as import("@waitron/dashboard-kit").DashboardRequest);
  shell.model = structuredClone(view);
  host.append(shell);
  await shell.updateComplete;
  return {
    shell,
    writes,
    get reads() {
      return reads;
    },
    gone() {
      missing = true;
    },
  };
}
async function shellDelete(shell: HTMLElementTagNameMap["venue-departments-shell"]) {
  const list = shell.shadowRoot!.querySelector("departments-list")!;
  await list.updateComplete;
  const table = list.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>('[data-test="delete-department-d1"]')!.click();
  await shell.updateComplete;
  const screen = shell.shadowRoot!.querySelector("department-dialogs")!;
  await screen.updateComplete;
  const dialog = screen.shadowRoot!.querySelector("wt-delete-dialog")!;
  expect(dialog).not.toBeNull();
  await ready(dialog);
  return { screen, dialog };
}
it("shell closes successful Delete before a failed refresh and reports only a load error", async () => {
  const { shell, writes } = await mountShell(true);
  const { screen, dialog } = await shellDelete(shell);
  button(dialog).click();
  await expect.poll(() => screen.dialog).toBeUndefined();
  await expect
    .poll(() => shell.shadowRoot!.querySelector('[role="alert"]')?.textContent)
    .toContain("could not be loaded");
  expect(writes).toEqual(["/management-api/venue-service/departments/d1"]);
  expect(screen.shadowRoot!.querySelector("wt-delete-dialog")).toBeNull();
});
it("shell does not reopen a target deleted elsewhere after reloading choices", async () => {
  const mounted = await mountShell();
  const { screen, dialog } = await shellDelete(mounted.shell);
  mounted.gone();
  dialog.dispatchEvent(new CustomEvent("wt-delete-retry"));
  await expect.poll(() => screen.dialog).toBeUndefined();
  await expect.poll(() => mounted.shell.getAttribute("aria-busy")).toBe("false");
  await mounted.shell.updateComplete;
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("wt-delete-dialog")).toBeNull();
  expect(mounted.reads).toBe(2);
  expect(mounted.writes).toEqual([]);
});
it("shell ignores removed Enable commands and inactive deletion targets", async () => {
  const { shell, writes } = await mountShell();
  const list = shell.shadowRoot!.querySelector("departments-list")!;
  list.dispatchEvent(
    new CustomEvent("enable-department", {
      detail: { departmentId: "d1" },
      bubbles: true,
      composed: true,
    }),
  );
  list.dispatchEvent(
    new CustomEvent("delete-department", {
      detail: { departmentId: "d3" },
      bubbles: true,
      composed: true,
    }),
  );
  await shell.updateComplete;
  expect(writes).toEqual([]);
  expect(shell.shadowRoot!.querySelector("department-dialogs")!.dialog).toBeUndefined();
});
it("an impact without a target is a read failure and cannot enable Delete", async () => {
  const { screen, api } = await mountDelete({
    getDepartmentDeleteImpact: vi.fn().mockResolvedValue({ zones: [] }),
  });
  const dialog = await openDelete(screen);
  await expect.poll(() => dialog.readError).not.toBe("");
  expect(button(dialog).disabled).toBe(true);
  expect(api.deleteDepartment).not.toHaveBeenCalled();
});
it("a watch cannot treat an invalid target as recovery of an earlier read", async () => {
  let apply!: (impact: DeleteImpact) => void;
  let fail!: (error: unknown) => void;
  let recover!: () => void;
  const { screen } = await mountDelete({
    watchDepartmentDeleteImpact: vi.fn((_id, a, f, r) => {
      apply = a;
      fail = f;
      recover = r;
      return () => {};
    }),
  });
  const dialog = await openDelete(screen);
  apply(allowedImpact);
  await ready(dialog);
  fail({ code: "connection.failed" });
  apply({ ...allowedImpact, target: { id: "other", name: "Other" } });
  recover();
  await screen.updateComplete;
  await dialog.updateComplete;
  expect(dialog.readError).not.toBe("");
  expect(button(dialog).disabled).toBe(true);
  apply(allowedImpact);
  await screen.updateComplete;
  await dialog.updateComplete;
  expect(dialog.readError).toBe("");
  expect(button(dialog).disabled).toBe(false);
});
it("a watch not-found during this dialog's Delete cannot end its pending write", async () => {
  let apply!: (impact: DeleteImpact) => void;
  let fail!: (error: unknown) => void;
  const write = deferred<DeleteImpact>();
  const { screen } = await mountDelete({
    watchDepartmentDeleteImpact: vi.fn((_id, a, f) => {
      apply = a;
      fail = f;
      return () => {};
    }),
    deleteDepartment: vi.fn().mockReturnValue(write.promise),
  });
  const dialog = await openDelete(screen);
  apply(allowedImpact);
  await ready(dialog);
  button(dialog).click();
  await screen.updateComplete;
  await dialog.updateComplete;
  fail({ code: "department.not_found" });
  await screen.updateComplete;
  expect(screen.dialog?.kind).toBe("delete-department");
  expect(dialog.submitting).toBe(true);
  write.resolve(allowedImpact);
  await expect.poll(() => screen.dialog).toBeUndefined();
});
