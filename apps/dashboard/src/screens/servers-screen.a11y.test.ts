import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import "./servers-screen.js";
import type { ServersScreen } from "./servers-screen.js";
import type { DashboardApi, ServerListing } from "../api/client.js";

const STANDBY = "22222222-2222-4222-8222-222222222222";

const listing: ServerListing = {
  term: 3,
  nodes: [
    {
      nodeId: "11111111-1111-4111-8111-111111111111",
      contactUrl: "https://till.venue.example",
      standing: "serving-primary",
      isSelf: true,
      removable: false,
      canClear: false,
      requiresRetirementConfirmation: false,
      returnOutstanding: false,
      needsResetStatement: false,
      reset: null,
      canReset: false,
      returnScenario: null,
      recoveredRecordsBackup: null,
      oldBoxHoldsMore: null,
    },
    {
      nodeId: STANDBY,
      contactUrl: "https://standby.venue.example:8443",
      standing: "serving-secondary",
      isSelf: false,
      removable: true,
      canClear: false,
      requiresRetirementConfirmation: false,
      returnOutstanding: false,
      needsResetStatement: false,
      reset: null,
      canReset: false,
      returnScenario: null,
      recoveredRecordsBackup: null,
      oldBoxHoldsMore: null,
    },
    {
      nodeId: "33333333-3333-4333-8333-333333333333",
      contactUrl: "https://old.venue.example",
      standing: "sell-only",
      isSelf: false,
      removable: false,
      canClear: false,
      requiresRetirementConfirmation: false,
      returnOutstanding: false,
      needsResetStatement: false,
      reset: null,
      canReset: false,
      returnScenario: null,
      recoveredRecordsBackup: null,
      oldBoxHoldsMore: null,
    },
    {
      nodeId: "44444444-4444-4444-8444-444444444444",
      contactUrl: "",
      standing: "evicted",
      isSelf: false,
      removable: false,
      canClear: true,
      requiresRetirementConfirmation: false,
      returnOutstanding: false,
      needsResetStatement: false,
      reset: null,
      canReset: false,
      returnScenario: null,
      recoveredRecordsBackup: null,
      oldBoxHoldsMore: null,
    },
  ],
};

function stubApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}): DashboardApi {
  return {
    listServers: vi.fn().mockResolvedValue(listing),
    removeServer: vi.fn().mockRejectedValue({ code: "membership.standby_joined" }),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: ServersScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await el.shadowRoot!.querySelector("wt-data-table")?.updateComplete;
}

function rowMenu(el: ServersScreen, nodeId: string): HTMLElementTagNameMap["wt-row-actions"] {
  return el
    .shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector(`tr[data-row-key="${nodeId}"] wt-row-actions`)!;
}

async function openRemove(el: ServersScreen, nodeId = STANDBY): Promise<void> {
  rowMenu(el, nodeId).shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  rowMenu(el, nodeId).querySelector<HTMLElement>(`[data-test="remove-${nodeId}"]`)!.click();
  await flush(el);
  const dialog = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    "wt-dialog[data-test=remove-dialog]",
  )!;
  expect(dialog.open).toBe(true);
  expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
}

const REMOVED = "44444444-4444-4444-8444-444444444444";

// The server marks `canClear` only on a removed row, and only while this server is the primary.
const clearable: ServerListing = {
  term: 4,
  nodes: listing.nodes.map((n) => ({ ...n, canClear: n.nodeId === REMOVED })),
};

async function openClear(el: ServersScreen): Promise<void> {
  rowMenu(el, REMOVED).shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  rowMenu(el, REMOVED).querySelector<HTMLElement>(`[data-test="clear-${REMOVED}"]`)!.click();
  await flush(el);
  const dialog = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    "wt-dialog[data-test=clear-dialog]",
  )!;
  expect(dialog.open).toBe(true);
  expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("servers-screen a11y (%s theme)", (theme) => {
  it("renders the list of servers accessibly", async () => {
    const { el, host } = await mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      {
        api: stubApi({
          listServers: vi.fn().mockResolvedValue({
            ...listing,
            spare: {
              peerNodeId: STANDBY,
              generation: "gen-1-main-20261114T120000Z",
              state: "following",
              appliedTXID: "0000000000000001",
              uploadedTXID: "0000000000000002",
              lagMs: 61000,
              lastAppliedAt: "2026-11-14T12:00:00.000Z",
              clockAt: null,
            },
          }),
        }),
      },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders a row's open action menu accessibly", async () => {
    const { el, host } = await mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    rowMenu(el, STANDBY).shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders the removal confirmation accessibly", async () => {
    const { el, host } = await mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await openRemove(el);
    await expectNoA11yViolations(host);
  });

  it("renders a joined spare's confirmation, with its declarations, accessibly", async () => {
    const joined: ServerListing = {
      ...listing,
      nodes: listing.nodes.map((n) => ({
        ...n,
        requiresRetirementConfirmation: n.nodeId === STANDBY,
      })),
    };
    const { el, host } = await mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      { api: stubApi({ listServers: vi.fn().mockResolvedValue(joined) }) },
      theme,
    );
    await flush(el);
    await openRemove(el);
    expect(
      el.shadowRoot!.querySelectorAll("wt-dialog[data-test=remove-dialog] wt-switch"),
    ).toHaveLength(2);
    await expectNoA11yViolations(host);
  });

  it("renders a refused removal inside the confirmation accessibly", async () => {
    const { el, host } = await mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    await openRemove(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-remove]")!.click();
    await flush(el);
    await flush(el);
    const actions = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
      "wt-dialog[data-test=remove-dialog] wt-form-actions",
    )!;
    expect(await formMessageOf(actions)).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders a no-address standby's confirmation accessibly", async () => {
    const blank = "55555555-5555-4555-8555-555555555555";
    const withBlank: ServerListing = {
      term: 3,
      nodes: [
        ...listing.nodes,
        {
          nodeId: blank,
          contactUrl: "",
          standing: "serving-secondary",
          isSelf: false,
          removable: true,
          canClear: false,
          requiresRetirementConfirmation: false,
          returnOutstanding: false,
          needsResetStatement: false,
          reset: null,
          canReset: false,
          returnScenario: null,
          recoveredRecordsBackup: null,
          oldBoxHoldsMore: null,
        },
      ],
    };
    const { el, host } = await mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      { api: stubApi({ listServers: vi.fn().mockResolvedValue(withBlank) }) },
      theme,
    );
    await flush(el);
    await openRemove(el, blank);
    await expectNoA11yViolations(host);
  });

  it("renders the clear confirmation for a removed machine accessibly", async () => {
    const { el, host } = await mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      { api: stubApi({ listServers: vi.fn().mockResolvedValue(clearable) }) },
      theme,
    );
    await flush(el);
    await openClear(el);
    await expectNoA11yViolations(host);
  });

  it("renders a refused clearing inside the confirmation accessibly", async () => {
    const { el, host } = await mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      {
        api: stubApi({
          listServers: vi.fn().mockResolvedValue(clearable),
          clearServer: vi.fn().mockRejectedValue({ code: "membership.node_not_removed" }),
        }),
      },
      theme,
    );
    await flush(el);
    await openClear(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-clear]")!.click();
    await flush(el);
    await flush(el);
    const actions = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
      "wt-dialog[data-test=clear-dialog] wt-form-actions",
    )!;
    expect(await formMessageOf(actions)).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders the not-primary note accessibly", async () => {
    const onStandby: ServerListing = {
      term: 3,
      nodes: listing.nodes.map((n) => ({ ...n, isSelf: n.nodeId === STANDBY, removable: false })),
    };
    const { el, host } = await mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      { api: stubApi({ listServers: vi.fn().mockResolvedValue(onStandby) }) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders a load failure accessibly", async () => {
    const { el, host } = await mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      {
        api: stubApi({
          listServers: vi.fn().mockRejectedValue({ code: "authorization.not_permitted" }),
        }),
      },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)("controlled handover form (%s)", (theme) => {
  it.each([true, false])("accessible handover, password=%s", async (hasPassword) => {
    const api = stubApi({
      getProfile: vi.fn().mockResolvedValue({
        displayName: "Owner",
        firstNames: null,
        lastNames: null,
        telephone: null,
        email: "owner@example.com",
        pendingEmail: null,
        locale: "en",
        hasPassword,
        hasTotp: true,
        hasGoogle: false,
        passkeys: [],
      }),
    });
    Object.defineProperty(api, "background", { get: () => api });
    const { el, host } = await mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      { api, canPromote: true },
      theme,
    );
    await flush(el);
    rowMenu(el, STANDBY).shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    rowMenu(el, STANDBY).querySelector<HTMLElement>(`[data-test="handover-${STANDBY}"]`)!.click();
    await vi.waitFor(() =>
      expect(
        (
          el.shadowRoot!.querySelector("[data-test=confirm-handover]") as HTMLElement & {
            disabled: boolean;
          }
        ).disabled,
      ).toBe(!hasPassword),
    );
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)("a former main box's row and dialogs (%s)", (theme) => {
  const FORMER = "33333333-3333-4333-8333-333333333333";
  const withFormer = (changes: Partial<ServerListing["nodes"][number]>): ServerListing => ({
    ...listing,
    nodes: listing.nodes.map((n) => (n.nodeId === FORMER ? { ...n, ...changes } : n)),
  });
  const waiting = withFormer({ returnOutstanding: true });

  async function openOn(el: ServersScreen, action: string): Promise<void> {
    rowMenu(el, FORMER).shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
    rowMenu(el, FORMER).querySelector<HTMLElement>(`[data-test="${action}-${FORMER}"]`)!.click();
    await flush(el);
    const dialog = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
      `wt-dialog[data-test=${action}-dialog]`,
    )!;
    expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  }

  it("renders a row waiting for its records accessibly", async () => {
    const { el, host } = await mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      { api: stubApi({ listServers: vi.fn().mockResolvedValue(waiting) }) },
      theme,
    );
    await flush(el);
    expect(
      el
        .shadowRoot!.querySelector("wt-data-table")!
        .shadowRoot!.querySelector(`[data-test="return-${FORMER}"]`),
    ).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders the Will not return confirmation, and its refusal, accessibly", async () => {
    const { el, host } = await mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      {
        api: stubApi({
          listServers: vi.fn().mockResolvedValue(waiting),
          abandonServerReturn: vi
            .fn()
            .mockRejectedValue({ code: "handover.return_not_outstanding", status: 409 }),
        }),
      },
      theme,
    );
    await flush(el);
    await openOn(el, "abandon");
    await expectNoA11yViolations(host);
    el.shadowRoot!.querySelector("wt-switch[data-test=abandon-confirm]")!
      .shadowRoot!.querySelector("input")!
      .click();
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-abandon]")!.click();
    await flush(el);
    await flush(el);
    const actions = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
      "wt-dialog[data-test=abandon-dialog] wt-form-actions",
    )!;
    expect(await formMessageOf(actions)).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders Wipe and remove after an emergency switch, with its CAUTION line and refusal, accessibly", async () => {
    const { el, host } = await mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      {
        api: stubApi({
          listServers: vi.fn().mockResolvedValue(
            withFormer({
              canReset: true,
              returnScenario: "emergency",
              recoveredRecordsBackup: "awaiting-backup",
              oldBoxHoldsMore: null,
            }),
          ),
          orderServerReset: vi
            .fn()
            .mockRejectedValue({ code: "handover.reset_loss_unaccepted", status: 409 }),
        }),
      },
      theme,
    );
    await flush(el);
    await openOn(el, "reset");
    expect(el.shadowRoot!.querySelector("[data-test=reset-download]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=reset-caution]")).not.toBeNull();
    await expectNoA11yViolations(host);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-reset]")!.click();
    await flush(el);
    await flush(el);
    const actions = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
      "wt-dialog[data-test=reset-dialog] wt-form-actions",
    )!;
    expect(await formMessageOf(actions)).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders Remove with the reset statement accessibly", async () => {
    const { el, host } = await mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      {
        api: stubApi({
          listServers: vi
            .fn()
            .mockResolvedValue(withFormer({ removable: true, needsResetStatement: true })),
        }),
      },
      theme,
    );
    await flush(el);
    await openOn(el, "remove");
    expect(el.shadowRoot!.querySelector("wt-switch[data-test=reset-statement]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});

const JOIN = "66666666-6666-4666-8666-666666666666";
const asking: ServerListing = {
  ...listing,
  joinRequests: [
    {
      id: JOIN,
      address: "192.168.1.23",
      askedAt: "2026-11-21T10:00:00.000Z",
      startedAgain: true,
      newConfirmed: false,
    },
  ],
};

async function openJoin(el: ServersScreen): Promise<HTMLElementTagNameMap["wt-dialog"]> {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="join-check-${JOIN}"]`)!.click();
  await flush(el);
  await flush(el);
  const dialog = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    "wt-dialog[data-test=join-dialog]",
  )!;
  expect(dialog.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  return dialog;
}

describe.each(["light", "dark"] as const)("a box asking to join (%s)", (theme) => {
  const mountAsking = (overrides: Partial<Record<keyof DashboardApi, unknown>> = {}) =>
    mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      {
        api: stubApi({
          listServers: vi.fn().mockResolvedValue(asking),
          checkBoxJoin: vi.fn().mockResolvedValue({ code: "482913", newConfirmed: false }),
          ...overrides,
        }),
      },
      theme,
    );

  it("renders the request in the list accessibly", async () => {
    const { el, host } = await mountAsking();
    await flush(el);
    expect(el.shadowRoot!.querySelector(`[data-test="join-row-${JOIN}"]`)).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders the code and its question accessibly", async () => {
    const { el, host } = await mountAsking();
    await flush(el);
    const dialog = await openJoin(el);
    expect(dialog.querySelector('[data-test="join-question"]')).not.toBeNull();
    expect(dialog.querySelector('[data-test="join-add"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders the wait for the new box's Join accessibly", async () => {
    const { el, host } = await mountAsking();
    await flush(el);
    const dialog = await openJoin(el);
    dialog.querySelector<HTMLElement>('[data-test="join-add"]')!.click();
    await flush(el);
    expect(dialog.querySelector('[data-test="join-waiting"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders a refused No inside the dialog accessibly", async () => {
    const { el, host } = await mountAsking({
      dismissBoxJoin: vi.fn().mockRejectedValue({ code: "mirror.join_in_progress", status: 409 }),
    });
    await flush(el);
    const dialog = await openJoin(el);
    dialog.querySelector<HTMLElement>('[data-test="join-no"]')!.click();
    await flush(el);
    await flush(el);
    expect(await formMessageOf(dialog.querySelector("wt-form-actions")!)).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders a refused Check accessibly", async () => {
    const { el, host } = await mountAsking({
      checkBoxJoin: vi.fn().mockRejectedValue({ code: "mirror.spare_already_joined", status: 409 }),
    });
    await flush(el);
    const dialog = await openJoin(el);
    expect(await formMessageOf(dialog.querySelector("wt-form-actions")!)).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders an approved join accessibly", async () => {
    const { el, host } = await mountAsking({
      checkBoxJoin: vi.fn().mockResolvedValue({ code: "482913", newConfirmed: true }),
      approveBoxJoin: vi.fn().mockResolvedValue(undefined),
    });
    await flush(el);
    const dialog = await openJoin(el);
    dialog.querySelector<HTMLElement>('[data-test="join-add"]')!.click();
    await flush(el);
    await flush(el);
    expect(dialog.querySelector('[data-test="join-approved"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders a refused Dismiss accessibly", async () => {
    const { el, host } = await mountAsking({
      dismissBoxJoin: vi.fn().mockRejectedValue({ code: "mirror.join_in_progress", status: 409 }),
    });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>(`[data-test="join-dismiss-${JOIN}"]`)!.click();
    await flush(el);
    await flush(el);
    expect(el.shadowRoot!.querySelector('[data-test="join-list-error"]')).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
