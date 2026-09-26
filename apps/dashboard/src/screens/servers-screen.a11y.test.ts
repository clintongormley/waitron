import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
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
    },
    {
      nodeId: STANDBY,
      contactUrl: "https://standby.venue.example:8443",
      standing: "serving-secondary",
      isSelf: false,
      removable: true,
    },
    {
      nodeId: "33333333-3333-4333-8333-333333333333",
      contactUrl: "https://old.venue.example",
      standing: "sell-only",
      isSelf: false,
      removable: false,
    },
    {
      nodeId: "44444444-4444-4444-8444-444444444444",
      contactUrl: "",
      standing: "evicted",
      isSelf: false,
      removable: false,
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

async function openRemove(el: ServersScreen, nodeId = STANDBY): Promise<void> {
  el.shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLElement>(`[data-test="remove-${nodeId}"]`)!
    .click();
  await flush(el);
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("servers-screen a11y (%s theme)", (theme) => {
  it("renders the list of servers accessibly", async () => {
    const { el, host } = await mountWidget<ServersScreen>(
      "dashboard-servers-screen",
      { api: stubApi() },
      theme,
    );
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
