import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { setHelpMode } from "@waitron/ui";
import type { WtHelpTooltip } from "@waitron/ui";
import type { StationThresholds } from "@waitron/shared";
import type { KitchenNotice, StationQueueGroup } from "../api/client.js";
import { helpBadgeLabel, helpText } from "../i18n/help-strings.js";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  mountWidget,
  pageAt,
  resetPage,
} from "./test-helpers.js";
import "./station-queue.js";
import type { TillStationQueue } from "./station-queue.js";

const THRESHOLDS: StationThresholds = {
  warmAfterMinutes: 5,
  overdueAfterMinutes: 10,
  forgottenAfterMinutes: 15,
};
const SENT = "2026-08-17T10:00:00.000Z";

const dish = (id: string, state: "queued" | "preparing", name: string) => ({
  allergy: null,
  id,
  workingOrderLineId: `wol-${id}`,
  state,
  name,
  quantity: "1.000",
  course: null,
  firedAt: SENT,
  queuedAt: SENT,
});

const groups: StationQueueGroup[] = [
  {
    kitchenNote: null,
    orderId: "wo-1",
    orderNumber: 5,
    label: "Mesa 4",
    queuedAt: SENT,
    status: "placed",
    thresholds: THRESHOLDS,
    bumpMode: "line",
    items: [dish("ti-1", "queued", "Paella"), dish("ti-2", "preparing", "Agua")],
  },
  {
    kitchenNote: null,
    orderId: "wo-2",
    orderNumber: 6,
    label: null,
    queuedAt: SENT,
    status: "placed",
    thresholds: THRESHOLDS,
    bumpMode: "line",
    items: [dish("ti-3", "preparing", "Vino")],
  },
];

const notices: KitchenNotice[] = [
  {
    id: "kn-void",
    stationId: "st-1",
    workingOrderId: "wo-1",
    orderLabel: "#5 · Mesa 4",
    kind: "void",
    lineName: "Burger",
    unitName: null,
    soldInEach: false,
    quantity: "1.000",
    note: null,
    wasStarted: true,
    movedTo: null,
    reroutedTo: null,
    direction: null,
    cancelledExtra: null,
    createdAt: "2026-08-17T10:01:00.000Z",
  },
];

afterEach(async () => {
  setHelpMode(false);
  cleanupWidgets();
  await resetPage();
});

const shown = async (el: TillStationQueue) => {
  const badges = [...el.shadowRoot!.querySelectorAll<WtHelpTooltip>("wt-help-tooltip")];
  for (const badge of badges) await badge.updateComplete;
  return badges.filter((badge) => badge.getBoundingClientRect().width > 0);
};

describe.each(["light", "dark"] as const)(
  "the station board's help badges a11y (%s theme)",
  (theme) => {
    async function mount(width: number) {
      await pageAt(width, width === 390 ? 844 : 900);
      setHelpMode(true);
      const mounted = await mountWidget<TillStationQueue>(
        "till-station-queue",
        { groups, notices, stationId: "st-1", now: Date.parse(SENT) + 2 * 60_000 },
        theme,
      );
      mounted.host.style.setProperty("--wt-help-badge-target", "32px");
      mounted.host.style.setProperty("--wt-help-badge-size", "24px");
      const { el } = mounted;
      if (width === 390) {
        await vi.waitFor(() =>
          expect(el.shadowRoot!.querySelector("[data-column-tabs]")).not.toBeNull(),
        );
        await userEvent.click(
          el.shadowRoot!.querySelector<HTMLButtonElement>('[data-column-tab="waiting"]')!,
        );
        await el.updateComplete;
      }
      return mounted;
    }

    it.each([1280, 390])("help on with a notice at %i has no violations", async (width) => {
      const { el, host } = await mount(width);
      expect(await shown(el)).toHaveLength(3);
      await expectNoA11yViolations(host);
    });

    it.each([1280, 390])(
      "help on with the card's box open at %i has no violations",
      async (width) => {
        const { el, host } = await mount(width);
        const badge = el.shadowRoot!.querySelector<WtHelpTooltip>(
          `wt-help-tooltip[aria-label="${helpBadgeLabel(helpText("help.kitchen.cards_part"))}"]`,
        )!;
        await userEvent.click(badge.shadowRoot!.querySelector("button")!);
        expect(
          badge.shadowRoot!.querySelector<HTMLElement>("[popover]")!.matches(":popover-open"),
        ).toBe(true);
        await expectNoA11yViolations(host);
      },
    );
  },
);
