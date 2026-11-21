import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import "./servers-screen.js";
import type { ServersScreen } from "./servers-screen.js";
import type { DashboardApi, ServerListing, ServerRow } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import { codeMessage } from "../i18n/codes.js";

const SELF = "11111111-1111-4111-8111-111111111111";
const OLD = "33333333-3333-4333-8333-333333333333";

const row = (overrides: Partial<ServerRow>): ServerRow => ({
  nodeId: OLD,
  contactUrl: "https://old.venue.example",
  standing: "sell-only",
  isSelf: false,
  removable: false,
  canClear: false,
  requiresRetirementConfirmation: false,
  returnOutstanding: false,
  needsResetStatement: false,
  ...overrides,
});

const listingWith = (old: Partial<ServerRow>): ServerListing => ({
  term: 5,
  authorityFingerprint: null,
  nodes: [
    row({
      nodeId: SELF,
      contactUrl: "https://new.venue.example",
      standing: "serving-primary",
      isSelf: true,
    }),
    row(old),
  ],
});

const waiting = listingWith({ returnOutstanding: true });
const unreturned = listingWith({ removable: true, needsResetStatement: true });
const returned = listingWith({ removable: true });

function stubApi(listing: ServerListing, overrides: Record<string, unknown> = {}): DashboardApi {
  return {
    listServers: vi.fn().mockResolvedValue(listing),
    removeServer: vi.fn().mockResolvedValue({ removed: true, term: 6 }),
    abandonServerReturn: vi
      .fn()
      .mockResolvedValue({ operationId: "op", state: "return_abandoned" }),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: ServersScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await el.shadowRoot!.querySelector("wt-data-table")?.updateComplete;
}

async function mount(api: DashboardApi): Promise<ServersScreen> {
  const { el } = await mountWidget<ServersScreen>("dashboard-servers-screen", { api });
  await flush(el);
  return el;
}

const table = (el: ServersScreen) => el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
const menu = (el: ServersScreen) =>
  table(el).querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
    `tr[data-row-key="${OLD}"] wt-row-actions`,
  );
const dialog = (el: ServersScreen, action: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    `wt-dialog[data-test=${action}-dialog]`,
  )!;
const confirmButton = (el: ServersScreen, action: string) =>
  dialog(el, action).querySelector<HTMLElementTagNameMap["wt-button"]>(
    `wt-button[data-test=confirm-${action}]`,
  )!;
const toggle = (el: ServersScreen, action: string, name: string) =>
  dialog(el, action).querySelector<HTMLElementTagNameMap["wt-switch"]>(
    `wt-switch[data-test=${name}]`,
  );

async function openAction(el: ServersScreen, action: string): Promise<void> {
  menu(el)!.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  menu(el)!.querySelector<HTMLElement>(`[data-test="${action}-${OLD}"]`)!.click();
  await flush(el);
  expect(dialog(el, action).open).toBe(true);
}

async function tick(el: ServersScreen, action: string, name: string): Promise<void> {
  toggle(el, action, name)!.shadowRoot!.querySelector("input")!.click();
  await flush(el);
}

async function confirm(el: ServersScreen, action: string): Promise<void> {
  confirmButton(el, action).click();
  await flush(el);
  await flush(el);
}

const messageIn = async (el: ServersScreen, action: string) =>
  (await formMessageOf(dialog(el, action).querySelector("wt-form-actions")!))?.textContent ?? null;

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

describe("a former main box the last handover waits for", () => {
  it("says on its row that the handover waits for its records, and offers Will not return there only", async () => {
    const el = await mount(stubApi(waiting));
    expect(table(el).querySelector(`[data-test="return-${OLD}"]`)?.textContent?.trim()).toBe(
      en["servers.return_waiting"],
    );
    expect(menu(el)!.querySelector(`[data-test="abandon-${OLD}"]`)?.textContent?.trim()).toBe(
      "Will not return",
    );
    cleanupWidgets();
    const other = await mount(stubApi(returned));
    expect(table(other).querySelector(`[data-test="return-${OLD}"]`)).toBeNull();
    expect(menu(other)!.querySelector(`[data-test="abandon-${OLD}"]`)).toBeNull();
  });

  it("warns what Will not return loses, and keeps it quiet and disabled until the confirmation is ticked", async () => {
    const api = stubApi(waiting);
    const el = await mount(api);
    await openAction(el, "abandon");
    expect(dialog(el, "abandon").heading).toBe(en["servers.abandon_title"]);
    expect(
      dialog(el, "abandon").querySelector("[data-test=abandon-address]")?.textContent?.trim(),
    ).toBe("https://old.venue.example");
    expect(
      dialog(el, "abandon").querySelector("[data-test=abandon-warning]")?.textContent?.trim(),
    ).toBe(en["servers.abandon_explanation"]);
    expect(toggle(el, "abandon", "abandon-confirm")!.label).toBe(
      `${en["servers.abandon_confirm"]} *`,
    );
    expect(confirmButton(el, "abandon").disabled).toBe(true);
    expect(confirmButton(el, "abandon").variant).toBe("secondary");
    await tick(el, "abandon", "abandon-confirm");
    expect(confirmButton(el, "abandon").disabled).toBe(false);
    expect(confirmButton(el, "abandon").variant).toBe("danger");
    vi.mocked(api.listServers).mockResolvedValue(unreturned);
    await confirm(el, "abandon");
    expect(api.abandonServerReturn).toHaveBeenCalledExactlyOnceWith(OLD);
    expect(dialog(el, "abandon").open).toBe(false);
    expect(table(el).querySelector(`[data-test="return-${OLD}"]`)).toBeNull();
  });

  it("keeps the dialog open with the refusal as its one message", async () => {
    const api = stubApi(waiting, {
      abandonServerReturn: vi
        .fn()
        .mockRejectedValue({ code: "handover.return_not_outstanding", status: 409 }),
    });
    const el = await mount(api);
    await openAction(el, "abandon");
    await tick(el, "abandon", "abandon-confirm");
    await confirm(el, "abandon");
    expect(dialog(el, "abandon").open).toBe(true);
    expect(await messageIn(el, "abandon")).toBe(codeMessage("handover.return_not_outstanding"));
  });

  it("Cancel forgets the tick and sends nothing", async () => {
    const api = stubApi(waiting);
    const el = await mount(api);
    await openAction(el, "abandon");
    await tick(el, "abandon", "abandon-confirm");
    dialog(el, "abandon").querySelector<HTMLElement>("[data-test=cancel-abandon]")!.click();
    await flush(el);
    await openAction(el, "abandon");
    expect(toggle(el, "abandon", "abandon-confirm")!.checked).toBe(false);
    expect(confirmButton(el, "abandon").disabled).toBe(true);
    expect(api.abandonServerReturn).not.toHaveBeenCalled();
  });

  it("names the button as the refusal does, and the refusal says what it does, in both languages", () => {
    expect(en["servers.abandon"]).toBe("Will not return");
    expect(es["servers.abandon"]).not.toBe(en["servers.abandon"]);
    for (const [language, words] of [
      ["en", en],
      ["es", es],
    ] as const) {
      expect(codeMessage("handover.return_outstanding", language)).toContain(
        `${words["servers.abandon"]} ${language === "en" ? "stops the wait" : "deja de esperar"}`,
      );
    }
  });
});

describe("removing a former main box", () => {
  it("asks for the reset statement after a warning, and sends it once ticked", async () => {
    const api = stubApi(unreturned);
    const el = await mount(api);
    await openAction(el, "remove");
    expect(dialog(el, "remove").heading).toBe(en["servers.remove_former_title"]);
    expect(
      dialog(el, "remove").querySelector("[data-test=reset-warning]")?.textContent?.trim(),
    ).toBe(en["servers.reset_warning"]);
    expect(toggle(el, "remove", "reset-statement")!.label).toBe(
      `${en["servers.reset_statement"]} *`,
    );
    expect(toggle(el, "remove", "declare-switched-off")).toBeNull();
    expect(confirmButton(el, "remove").disabled).toBe(true);
    await tick(el, "remove", "reset-statement");
    expect(confirmButton(el, "remove").disabled).toBe(false);
    await confirm(el, "remove");
    expect(api.removeServer).toHaveBeenCalledExactlyOnceWith(OLD, { resetStatement: true });
    expect(dialog(el, "remove").open).toBe(false);
  });

  it("removes one whose records came back with no statement", async () => {
    const api = stubApi(returned);
    const el = await mount(api);
    await openAction(el, "remove");
    expect(dialog(el, "remove").heading).toBe(en["servers.remove_former_title"]);
    expect(toggle(el, "remove", "reset-statement")).toBeNull();
    await confirm(el, "remove");
    expect(api.removeServer).toHaveBeenCalledExactlyOnceWith(OLD);
  });

  it("asks for the statement when the list was read before the server needed it", async () => {
    const api = stubApi(returned, {
      removeServer: vi
        .fn()
        .mockRejectedValueOnce({ code: "membership.reset_statement_required", status: 409 })
        .mockResolvedValueOnce({ removed: true, term: 6 }),
    });
    const el = await mount(api);
    await openAction(el, "remove");
    await confirm(el, "remove");
    expect(await messageIn(el, "remove")).toBe(codeMessage("membership.reset_statement_required"));
    expect(toggle(el, "remove", "reset-statement")!.checked).toBe(false);
    expect(confirmButton(el, "remove").disabled).toBe(true);
    await tick(el, "remove", "reset-statement");
    await confirm(el, "remove");
    expect(vi.mocked(api.removeServer).mock.calls).toEqual([
      [OLD],
      [OLD, { resetStatement: true }],
    ]);
    expect(dialog(el, "remove").open).toBe(false);
  });
});
