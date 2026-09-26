import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "../widgets/test-helpers.js";
import "./servers-screen.js";
import type { ServersScreen } from "./servers-screen.js";
import type { DashboardApi, ServerListing } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import { codeMessage } from "../i18n/codes.js";

const SELF = "11111111-1111-4111-8111-111111111111";
const STANDBY = "22222222-2222-4222-8222-222222222222";
const FORMER = "33333333-3333-4333-8333-333333333333";
const REMOVED = "44444444-4444-4444-8444-444444444444";
const BLANK = "55555555-5555-4555-8555-555555555555";

const listing: ServerListing = {
  term: 3,
  nodes: [
    {
      nodeId: SELF,
      contactUrl: "https://till.venue.example",
      standing: "serving-primary",
      isSelf: true,
      removable: false,
      canClear: false,
    },
    {
      nodeId: STANDBY,
      contactUrl: "https://standby.venue.example:8443",
      standing: "serving-secondary",
      isSelf: false,
      removable: true,
      canClear: false,
    },
    {
      nodeId: FORMER,
      contactUrl: "https://old.venue.example",
      standing: "sell-only",
      isSelf: false,
      removable: false,
      canClear: false,
    },
    {
      nodeId: REMOVED,
      contactUrl: "",
      standing: "evicted",
      isSelf: false,
      removable: false,
      canClear: true,
    },
  ],
};

const afterRemoval: ServerListing = {
  term: 4,
  nodes: listing.nodes.map((n) =>
    n.nodeId === STANDBY ? { ...n, standing: "evicted", removable: false, canClear: true } : n,
  ),
};

function stubApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}): DashboardApi {
  return {
    listServers: vi.fn().mockResolvedValue(listing),
    removeServer: vi.fn().mockResolvedValue({ removed: true, term: 4 }),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: ServersScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  const table = el.shadowRoot!.querySelector("wt-data-table");
  if (table) await table.updateComplete;
}

async function mount(api = stubApi()): Promise<ServersScreen> {
  const { el } = await mountWidget<ServersScreen>("dashboard-servers-screen", { api });
  await flush(el);
  return el;
}

function tableRoot(el: ServersScreen): ShadowRoot {
  return el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
}

function inTable(el: ServersScreen, testId: string): HTMLElement | null {
  return tableRoot(el).querySelector<HTMLElement>(`[data-test="${testId}"]`);
}

function dialog(el: ServersScreen): HTMLElementTagNameMap["wt-dialog"] {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    "wt-dialog[data-test=remove-dialog]",
  )!;
}

function rowMenu(
  el: ServersScreen,
  nodeId: string,
): HTMLElementTagNameMap["wt-row-actions"] | null {
  return tableRoot(el).querySelector(`tr[data-row-key="${nodeId}"] wt-row-actions`);
}

function menuTrigger(el: ServersScreen, nodeId: string): HTMLButtonElement {
  return rowMenu(el, nodeId)!.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
}

async function openRemove(el: ServersScreen, nodeId = STANDBY): Promise<void> {
  menuTrigger(el, nodeId).click();
  const remove = rowMenu(el, nodeId)!.querySelector<HTMLElement>(`[data-test="remove-${nodeId}"]`)!;
  remove.click();
  await flush(el);
}

async function confirmRemove(el: ServersScreen): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-remove]")!.click();
  await flush(el);
  await flush(el);
}

beforeEach(() => {
  setLocale("en");
  sessionStorage.clear();
});
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

describe("servers screen list", () => {
  it("names each machine's role in words and marks which one is this server", async () => {
    const el = await mount();
    expect(inTable(el, `role-${SELF}`)!.textContent!.trim()).toBe(t("servers.standing.primary"));
    expect(inTable(el, `role-${STANDBY}`)!.textContent!.trim()).toBe(t("servers.standing.standby"));
    expect(inTable(el, `role-${FORMER}`)!.textContent!.trim()).toBe(
      t("servers.standing.sell_only"),
    );
    expect(inTable(el, `role-${REMOVED}`)!.textContent!.trim()).toBe(t("servers.standing.removed"));
    // Four different words, so a screen that printed one word for every row fails above.
    expect(
      new Set(
        ["primary", "standby", "sell_only", "removed"].map((s) =>
          t(`servers.standing.${s}` as Parameters<typeof t>[0]),
        ),
      ).size,
    ).toBe(4);

    expect(inTable(el, `self-${SELF}`)!.textContent!.trim()).toBe(t("servers.this_server"));
    for (const other of [STANDBY, FORMER, REMOVED]) expect(inTable(el, `self-${other}`)).toBeNull();
  });

  it("shows each address, and a translated placeholder where a machine gave none", async () => {
    const el = await mount();
    expect(inTable(el, `address-${STANDBY}`)!.textContent!.trim()).toBe(
      "https://standby.venue.example:8443",
    );
    expect(inTable(el, `address-${REMOVED}`)!.textContent!.trim()).toBe(t("servers.no_address"));
  });

  it("offers Remove, in a row menu, only on the rows the server says can be removed", async () => {
    const el = await mount();
    expect(rowMenu(el, STANDBY)!.querySelector(`[data-test="remove-${STANDBY}"]`)).not.toBeNull();
    for (const other of [SELF, FORMER]) expect(rowMenu(el, other)).toBeNull();
    // The removed row keeps a menu, because the server marks it clearable.
    for (const other of [SELF, FORMER, REMOVED]) expect(inTable(el, `remove-${other}`)).toBeNull();
  });

  it("names the address in the row menu's accessible name", async () => {
    const el = await mount();
    const menu = rowMenu(el, STANDBY)!;
    expect(menu.getAttribute("label")).toBe(
      `${t("servers.actions")}: https://standby.venue.example:8443`,
    );
    expect(menuTrigger(el, STANDBY).getAttribute("aria-label")).toBe(menu.getAttribute("label"));
    expect(menu.querySelector(`[data-test="remove-${STANDBY}"]`)!.getAttribute("align")).toBe(
      "start",
    );
  });

  it.each(["en", "es-ES"] as const)(
    "words the menu item and the confirm button with the same verb, in %s",
    async (locale) => {
      setLocale(locale);
      const el = await mount();
      const item = rowMenu(el, STANDBY)!.querySelector(`[data-test="remove-${STANDBY}"]`)!;
      await openRemove(el);
      const confirm = el.shadowRoot!.querySelector("[data-test=confirm-remove]")!;
      expect(item.textContent!.trim()).toBe(t("servers.remove"));
      expect(confirm.textContent!.trim()).toBe(t("servers.remove"));
    },
  );

  it("words Remove as Retirar in Spanish, matching the rest of the screen", () => {
    expect(es["servers.remove"]).toBe("Retirar");
    expect(es["servers.remove"]).not.toBe(es["action.remove"]);
  });

  it("paints the this-server tag from the muted text token, inside the table's shadow root", async () => {
    const el = await mount();
    const tag = inTable(el, `self-${SELF}`)!;
    const address = inTable(el, `address-${SELF}`)!;
    // Resolve the token through a probe in the same tree, so the comparison is colour to colour.
    const probe = document.createElement("span");
    probe.style.color = "var(--wt-color-text-muted)";
    el.shadowRoot!.append(probe);
    const muted = getComputedStyle(probe).color;
    probe.remove();
    probe.style.fontSize = "var(--wt-font-size-sm)";
    el.shadowRoot!.append(probe);
    const small = getComputedStyle(probe).fontSize;
    probe.remove();
    expect(getComputedStyle(tag).color).toBe(muted);
    expect(getComputedStyle(tag).borderTopStyle).toBe("solid");
    expect(getComputedStyle(tag).fontSize).toBe(small);
    // The control: the address is at the body size, so the tag's size is the part rule's doing.
    expect(getComputedStyle(address).fontSize).not.toBe(small);
    // The control: the address beside it is NOT muted, so the tag's colour is the part rule's doing.
    expect(getComputedStyle(address).color).not.toBe(muted);
  });

  it("shows the empty message when this server holds no list", async () => {
    const el = await mount(
      stubApi({ listServers: vi.fn().mockResolvedValue({ term: null, nodes: [] }) }),
    );
    expect(tableRoot(el).textContent).toContain(t("servers.empty"));
  });

  it("shows a manager the not-permitted message rather than a list", async () => {
    const el = await mount(
      stubApi({
        listServers: vi
          .fn()
          .mockRejectedValue({ code: "authorization.not_permitted", status: 403 }),
      }),
    );
    const alert = tableRoot(el).querySelector("[role=alert]");
    expect(alert!.textContent!.trim()).toBe(codeMessage("authorization.not_permitted"));
  });

  it("refreshes the list when the membership chart changes elsewhere", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const el = await mount(api);
    expect(inTable(el, `remove-${STANDBY}`)).not.toBeNull();
    vi.mocked(api.listServers).mockResolvedValue(afterRemoval);
    liveData.invalidate([{ type: "node_membership", id: "changed-elsewhere" }]);
    await vi.waitFor(async () => {
      await flush(el);
      expect(inTable(el, `role-${STANDBY}`)!.textContent!.trim()).toBe(
        t("servers.standing.removed"),
      );
    });
    expect(api.listServers).toHaveBeenCalledTimes(2);
  });
  it("shows a short machine id on every row, beside the address or its placeholder", async () => {
    const el = await mount();
    for (const id of [SELF, STANDBY, FORMER, REMOVED]) {
      const tag = inTable(el, `machine-${id}`)!;
      expect(tag.textContent!.replace(/\s+/g, " ").trim()).toBe(
        `${t("servers.machine")} ${id.slice(0, 8)}`,
      );
    }
  });

  it("paints the machine id in the monospace font token", async () => {
    const el = await mount();
    const id = inTable(el, `machine-id-${STANDBY}`)!;
    const probe = document.createElement("span");
    probe.style.fontFamily = "var(--wt-font-family-mono)";
    el.shadowRoot!.append(probe);
    const mono = getComputedStyle(probe).fontFamily;
    probe.remove();
    expect(getComputedStyle(id).fontFamily).toBe(mono);
    expect(getComputedStyle(inTable(el, `address-${STANDBY}`)!).fontFamily).not.toBe(mono);
  });

  it("names a removable machine with no address by its short id, on the row menu and in the confirmation", async () => {
    const withBlank: ServerListing = {
      term: 3,
      nodes: [
        ...listing.nodes,
        {
          nodeId: BLANK,
          contactUrl: "",
          standing: "serving-secondary",
          isSelf: false,
          removable: true,
          canClear: false,
        },
      ],
    };
    const el = await mount(stubApi({ listServers: vi.fn().mockResolvedValue(withBlank) }));
    expect(rowMenu(el, BLANK)!.getAttribute("label")).toBe(
      `${t("servers.actions")}: ${t("servers.machine")} 55555555`,
    );
    await openRemove(el, BLANK);
    const body = dialog(el).textContent!.replace(/\s+/g, " ");
    expect(body).toContain(t("servers.no_address"));
    expect(body).toContain(`${t("servers.machine")} 55555555`);
  });

  it("says why nothing can be removed when this server is not the primary", async () => {
    const onStandby: ServerListing = {
      term: 3,
      nodes: listing.nodes.map((n) => ({
        ...n,
        isSelf: n.nodeId === STANDBY,
        removable: false,
        canClear: false,
      })),
    };
    const el = await mount(stubApi({ listServers: vi.fn().mockResolvedValue(onStandby) }));
    expect(el.shadowRoot!.querySelector("[data-test=not-primary]")!.textContent!.trim()).toBe(
      t("servers.not_primary"),
    );
  });

  it("says the same when no listed machine is this server", async () => {
    const notListed: ServerListing = {
      term: 3,
      nodes: listing.nodes.map((n) => ({ ...n, isSelf: false, removable: false, canClear: false })),
    };
    const el = await mount(stubApi({ listServers: vi.fn().mockResolvedValue(notListed) }));
    expect(el.shadowRoot!.querySelector("[data-test=not-primary]")).not.toBeNull();
  });

  it("gives no not-primary note on the primary, on an empty list, or after a load failure", async () => {
    const onPrimary = await mount();
    expect(onPrimary.shadowRoot!.querySelector("[data-test=not-primary]")).toBeNull();
    cleanupWidgets();
    // `listServers` answers an empty list whenever no chart is held, primary or not.
    const empty = await mount(
      stubApi({ listServers: vi.fn().mockResolvedValue({ term: null, nodes: [] }) }),
    );
    expect(empty.shadowRoot!.querySelector("[data-test=not-primary]")).toBeNull();
    cleanupWidgets();
    const failed = await mount(
      stubApi({ listServers: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
    );
    expect(failed.shadowRoot!.querySelector("[data-test=not-primary]")).toBeNull();
  });

  it("does not promise that a till never tries a removed machine, in either language", () => {
    for (const key of ["servers.intro", "servers.remove_explanation"] as const) {
      expect(en[key]).toContain("so tills stop trying to reach it");
      expect(en[key]).not.toMatch(/never try/);
      expect(es[key]).toContain("para que las cajas dejen de intentar conectar con él");
      expect(es[key]).not.toMatch(/nunca intenten/);
    }
  });
});

describe("servers screen removal", () => {
  it("opens a confirmation naming the address, and Remove posts that machine's id then refreshes", async () => {
    const api = stubApi();
    const el = await mount(api);
    await openRemove(el);
    expect(dialog(el).open).toBe(true);
    expect(el.shadowRoot!.querySelector("[data-test=remove-address]")!.textContent!.trim()).toBe(
      "https://standby.venue.example:8443",
    );
    expect(api.removeServer).not.toHaveBeenCalled();

    vi.mocked(api.listServers).mockResolvedValue(afterRemoval);
    await confirmRemove(el);
    expect(api.removeServer).toHaveBeenCalledExactlyOnceWith(STANDBY);
    expect(api.listServers).toHaveBeenCalledTimes(2);
    expect(dialog(el).open).toBe(false);
    expect(inTable(el, `role-${STANDBY}`)!.textContent!.trim()).toBe(t("servers.standing.removed"));
    expect(inTable(el, `remove-${STANDBY}`)).toBeNull();
    expect(rowMenu(el, STANDBY)!.querySelector(`[data-test="clear-${STANDBY}"]`)).not.toBeNull();
  });

  it("returns focus to the row's menu when the confirmation is cancelled or dismissed", async () => {
    const el = await mount();
    for (const close of [
      () => el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-remove]")!.click(),
      () =>
        dialog(el).dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true })),
    ]) {
      // Real clicks, because a click is what moves focus onto the Remove item the popover then hides.
      await userEvent.click(menuTrigger(el, STANDBY));
      await userEvent.click(inTable(el, `remove-${STANDBY}`)!);
      await flush(el);
      expect(dialog(el).open).toBe(true);
      close();
      await flush(el);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(dialog(el).open).toBe(false);
      expect(rowMenu(el, STANDBY)!.shadowRoot!.activeElement).toBe(menuTrigger(el, STANDBY));
      menuTrigger(el, STANDBY).blur();
      expect(rowMenu(el, STANDBY)!.shadowRoot!.activeElement).toBeNull();
    }
  });

  it("moves focus to the screen's heading after a removal, because the Remove item it came from is gone", async () => {
    const api = stubApi();
    const el = await mount(api);
    // Real clicks, because a click is what moves focus onto the Remove item the popover then hides.
    await userEvent.click(menuTrigger(el, STANDBY));
    await userEvent.click(inTable(el, `remove-${STANDBY}`)!);
    await flush(el);
    // A refresh slower than the dialog's close, as a real network's can be.
    vi.mocked(api.listServers).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(afterRemoval), 200)),
    );
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-remove]")!);
    await vi.waitFor(async () => {
      await flush(el);
      expect(dialog(el).open).toBe(false);
      expect(inTable(el, `remove-${STANDBY}`)).toBeNull();
      expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("h1"));
    });
  });

  it("Cancel closes the confirmation without posting anything", async () => {
    const api = stubApi();
    const el = await mount(api);
    await openRemove(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-remove]")!.click();
    await flush(el);
    await closeReportsDelivered();
    await flush(el);
    expect(dialog(el).open).toBe(false);
    expect(api.removeServer).not.toHaveBeenCalled();
  });

  it("dismissing the confirmation with Escape posts nothing", async () => {
    const api = stubApi();
    const el = await mount(api);
    await openRemove(el);
    dialog(el).dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    await flush(el);
    expect(dialog(el).open).toBe(false);
    expect(api.removeServer).not.toHaveBeenCalled();
  });

  it.each([
    "membership.node_not_found",
    "membership.not_primary",
    "membership.node_is_primary",
    "membership.node_has_served",
    "membership.standby_joined",
    "membership.write_contended",
  ])("shows the refusal %s in its own words inside the confirmation", async (code) => {
    const api = stubApi({ removeServer: vi.fn().mockRejectedValue({ code, status: 409 }) });
    const el = await mount(api);
    await openRemove(el);
    await confirmRemove(el);
    expect(dialog(el).open).toBe(true);
    const alert = dialog(el).querySelector("[role=alert]");
    expect(alert!.textContent!.trim()).toBe(codeMessage(code));
    expect(codeMessage(code)).not.toBe(codeMessage("server.internal"));
    // A refused write is not a load failure: the list stays as it was.
    expect(tableRoot(el).querySelector("[role=alert]")).toBeNull();
    expect(api.listServers).toHaveBeenCalledTimes(1);
  });

  it("a removal that succeeded but whose refresh failed closes the confirmation and reports a load failure", async () => {
    const api = stubApi();
    const el = await mount(api);
    await openRemove(el);
    vi.mocked(api.listServers).mockRejectedValue({ code: "connection.failed" });
    await confirmRemove(el);
    expect(api.removeServer).toHaveBeenCalledOnce();
    expect(dialog(el).open).toBe(false);
    expect(dialog(el).querySelector("[role=alert]")).toBeNull();
    const alert = tableRoot(el).querySelector("[role=alert]");
    expect(alert!.textContent!.trim()).toBe(codeMessage("connection.failed"));
  });

  it("a second press while the removal is in flight posts once", async () => {
    let finish!: (value: { removed: boolean; term: number }) => void;
    const api = stubApi({
      removeServer: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const el = await mount(api);
    await openRemove(el);
    const confirm = el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-remove]")!;
    confirm.click();
    confirm.click();
    await flush(el);
    expect(api.removeServer).toHaveBeenCalledOnce();
    finish({ removed: true, term: 4 });
    await flush(el);
  });

  it("Escape pressed while the removal is in flight keeps the confirmation open, so its refusal is still shown", async () => {
    let refuse!: (error: unknown) => void;
    const api = stubApi({
      removeServer: vi.fn(
        () =>
          new Promise((_, reject) => {
            refuse = reject;
          }),
      ),
    });
    const el = await mount(api);
    await openRemove(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-remove]")!.click();
    await flush(el);
    await userEvent.keyboard("{Escape}");
    await closeReportsDelivered();
    await flush(el);
    const native = dialog(el).shadowRoot!.querySelector("dialog")!;
    expect(native.open).toBe(true);
    refuse({ code: "membership.standby_joined" });
    await flush(el);
    expect(native.open).toBe(true);
    expect(dialog(el).open).toBe(true);
    expect(dialog(el).querySelector("[role=alert]")!.textContent!.trim()).toBe(
      codeMessage("membership.standby_joined"),
    );
  });

  it("clears an earlier refusal when the confirmation is opened again", async () => {
    const api = stubApi({
      removeServer: vi.fn().mockRejectedValue({ code: "membership.standby_joined" }),
    });
    const el = await mount(api);
    await openRemove(el);
    await confirmRemove(el);
    expect(dialog(el).querySelector("[role=alert]")).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-remove]")!.click();
    await flush(el);
    await openRemove(el);
    expect(dialog(el).querySelector("[role=alert]")).toBeNull();
  });
});

describe("servers screen clearing", () => {
  // The server marks `canClear` only on a removed row, and only while this server is the primary.
  const clearable: ServerListing = {
    term: 4,
    nodes: listing.nodes.map((n) => ({ ...n, canClear: n.nodeId === REMOVED })),
  };
  const afterClearing: ServerListing = {
    term: 5,
    nodes: clearable.nodes.filter((n) => n.nodeId !== REMOVED),
  };

  function clearApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}): DashboardApi {
    return stubApi({
      listServers: vi.fn().mockResolvedValue(clearable),
      clearServer: vi.fn().mockResolvedValue({ cleared: true, term: 5 }),
      ...overrides,
    });
  }

  function clearDialog(el: ServersScreen): HTMLElementTagNameMap["wt-dialog"] {
    return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
      "wt-dialog[data-test=clear-dialog]",
    )!;
  }

  async function openClear(el: ServersScreen, nodeId = REMOVED): Promise<void> {
    menuTrigger(el, nodeId).click();
    rowMenu(el, nodeId)!.querySelector<HTMLElement>(`[data-test="clear-${nodeId}"]`)!.click();
    await flush(el);
  }

  async function confirmClear(el: ServersScreen): Promise<void> {
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-clear]")!.click();
    await flush(el);
    await flush(el);
  }

  it("offers Clear, in a row menu, only on the rows the server marks clearable", async () => {
    const el = await mount(clearApi());
    expect(rowMenu(el, REMOVED)!.querySelector(`[data-test="clear-${REMOVED}"]`)).not.toBeNull();
    expect(rowMenu(el, REMOVED)!.querySelector(`[data-test="remove-${REMOVED}"]`)).toBeNull();
    for (const other of [SELF, STANDBY, FORMER]) expect(inTable(el, `clear-${other}`)).toBeNull();
    expect(rowMenu(el, STANDBY)!.querySelector(`[data-test="remove-${STANDBY}"]`)).not.toBeNull();
  });

  it("offers no Clear on a removed row the server does not mark clearable", async () => {
    const notClearable: ServerListing = {
      term: 4,
      nodes: clearable.nodes.map((n) => ({ ...n, canClear: false })),
    };
    const el = await mount(clearApi({ listServers: vi.fn().mockResolvedValue(notClearable) }));
    expect(inTable(el, `role-${REMOVED}`)!.textContent!.trim()).toBe(t("servers.standing.removed"));
    expect(rowMenu(el, REMOVED)).toBeNull();
    expect(inTable(el, `clear-${REMOVED}`)).toBeNull();
  });

  it("opens a confirmation naming the machine, and Clear posts that machine's id then refreshes", async () => {
    const api = clearApi();
    const el = await mount(api);
    await openClear(el);
    expect(clearDialog(el).open).toBe(true);
    expect(dialog(el).open).toBe(false);
    expect(clearDialog(el).getAttribute("heading")).toBe(t("servers.clear_title"));
    const body = clearDialog(el).textContent!.replace(/\s+/g, " ");
    expect(body).toContain(t("servers.no_address"));
    expect(body).toContain(`${t("servers.machine")} 44444444`);
    expect(body).toContain(t("servers.clear_explanation"));
    expect(api.clearServer).not.toHaveBeenCalled();

    vi.mocked(api.listServers).mockResolvedValue(afterClearing);
    await confirmClear(el);
    expect(api.clearServer).toHaveBeenCalledExactlyOnceWith(REMOVED);
    expect(api.removeServer).not.toHaveBeenCalled();
    expect(api.listServers).toHaveBeenCalledTimes(2);
    expect(clearDialog(el).open).toBe(false);
    expect(inTable(el, `role-${REMOVED}`)).toBeNull();
  });

  it("says in both languages that clearing frees the place and the machine stays shut out", () => {
    expect(en["servers.clear_explanation"]).toContain("frees the place");
    expect(en["servers.clear_explanation"]).toContain(
      "It stays shut out: if it tries to come back under its old identity",
    );
    expect(en["servers.clear_explanation"]).toContain("join from scratch");
    expect(es["servers.clear_explanation"]).toContain("libera el sitio");
    expect(es["servers.clear_explanation"]).toContain(
      "La máquina sigue excluida: si intenta volver con su identidad anterior",
    );
    expect(es["servers.clear_explanation"]).toContain("unirse de nuevo desde el principio");
  });

  it.each(["en", "es-ES"] as const)(
    "words the menu item and the confirm button with the same verb, unlike Remove's, in %s",
    async (locale) => {
      setLocale(locale);
      const el = await mount(clearApi());
      const item = rowMenu(el, REMOVED)!.querySelector(`[data-test="clear-${REMOVED}"]`)!;
      await openClear(el);
      const confirm = el.shadowRoot!.querySelector("[data-test=confirm-clear]")!;
      expect(item.textContent!.trim()).toBe(t("servers.clear"));
      expect(confirm.textContent!.trim()).toBe(t("servers.clear"));
      expect(t("servers.clear")).not.toBe(t("servers.remove"));
    },
  );

  it.each([
    "membership.node_not_found",
    "membership.not_primary",
    "membership.node_is_primary",
    "membership.node_not_removed",
    "membership.chart_too_large",
    "membership.revoked_duplicate",
    "membership.revoked_node_listed",
    "membership.write_contended",
  ])("shows the refusal %s in its own words inside the confirmation", async (code) => {
    const api = clearApi({ clearServer: vi.fn().mockRejectedValue({ code, status: 409 }) });
    const el = await mount(api);
    await openClear(el);
    await confirmClear(el);
    expect(clearDialog(el).open).toBe(true);
    const alert = clearDialog(el).querySelector("[role=alert]");
    expect(alert!.textContent!.trim()).toBe(codeMessage(code));
    expect(codeMessage(code)).not.toBe(codeMessage("server.internal"));
    expect(dialog(el).querySelector("[role=alert]")).toBeNull();
    // A refused write is not a load failure: the list stays as it was.
    expect(tableRoot(el).querySelector("[role=alert]")).toBeNull();
    expect(api.listServers).toHaveBeenCalledTimes(1);
  });

  it("a clearing that succeeded but whose refresh failed closes the confirmation and reports a load failure", async () => {
    const api = clearApi();
    const el = await mount(api);
    await openClear(el);
    vi.mocked(api.listServers).mockRejectedValue({ code: "connection.failed" });
    await confirmClear(el);
    expect(api.clearServer).toHaveBeenCalledOnce();
    expect(clearDialog(el).open).toBe(false);
    expect(clearDialog(el).querySelector("[role=alert]")).toBeNull();
    const alert = tableRoot(el).querySelector("[role=alert]");
    expect(alert!.textContent!.trim()).toBe(codeMessage("connection.failed"));
  });

  it("Cancel closes the confirmation without posting anything, and focus returns to the row's menu", async () => {
    const api = clearApi();
    const el = await mount(api);
    await userEvent.click(menuTrigger(el, REMOVED));
    await userEvent.click(inTable(el, `clear-${REMOVED}`)!);
    await flush(el);
    expect(clearDialog(el).open).toBe(true);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-clear]")!.click();
    await flush(el);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(clearDialog(el).open).toBe(false);
    expect(api.clearServer).not.toHaveBeenCalled();
    expect(rowMenu(el, REMOVED)!.shadowRoot!.activeElement).toBe(menuTrigger(el, REMOVED));
  });

  it("moves focus to the screen's heading after clearing, because the row is gone", async () => {
    const api = clearApi();
    const el = await mount(api);
    await userEvent.click(menuTrigger(el, REMOVED));
    await userEvent.click(inTable(el, `clear-${REMOVED}`)!);
    await flush(el);
    vi.mocked(api.listServers).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(afterClearing), 200)),
    );
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-clear]")!);
    await vi.waitFor(async () => {
      await flush(el);
      expect(clearDialog(el).open).toBe(false);
      expect(inTable(el, `role-${REMOVED}`)).toBeNull();
      expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("h1"));
    });
  });

  it("a second press while the clearing is in flight posts once", async () => {
    let finish!: (value: { cleared: boolean; term: number }) => void;
    const api = clearApi({
      clearServer: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const el = await mount(api);
    await openClear(el);
    const confirm = el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-clear]")!;
    confirm.click();
    confirm.click();
    await flush(el);
    expect(api.clearServer).toHaveBeenCalledOnce();
    finish({ cleared: true, term: 5 });
    await flush(el);
  });

  it("does not carry a refused removal's message into the clear confirmation", async () => {
    const api = clearApi({
      removeServer: vi.fn().mockRejectedValue({ code: "membership.standby_joined" }),
    });
    const el = await mount(api);
    await openRemove(el);
    await confirmRemove(el);
    expect(dialog(el).querySelector("[role=alert]")).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-remove]")!.click();
    await flush(el);
    await openClear(el);
    expect(clearDialog(el).open).toBe(true);
    expect(clearDialog(el).querySelector("[role=alert]")).toBeNull();
  });
});
