import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { TillStationQueue } from "./station-queue.js";
import {
  allergyBlock,
  allergyNotice,
  allergyQueue,
  correctedBlock,
} from "../../test/kitchen-allergy-fixtures.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

describe("A669 boards station", () => {
  it.each(["rail", "kanban"] as const)(
    "marks only the assigned card in a merged %s queue",
    async (view) => {
      const group = allergyQueue();
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [
          { ...group, stationId: "grill", items: [group.items[0]!] },
          {
            ...group,
            orderId: "bill-2",
            orderNumber: 13,
            stationId: "bar",
            items: [group.items[1]!],
          },
        ],
        stationNames: new Map([
          ["grill", "Grill"],
          ["bar", "Bar"],
        ]),
        view,
      });
      const ticked = el.shadowRoot!.querySelector('[data-item="ticked"]')!;
      const unticked = el.shadowRoot!.querySelector('[data-item="unticked"]')!;
      expect(ticked.querySelector("[data-line-station]")!.textContent).toBe("Grill");
      expect(unticked.querySelector("[data-line-station]")!.textContent).toBe("Bar");
      expect(
        ticked
          .closest(view === "rail" ? ".ticket" : ".cell")!
          .querySelector("[data-allergy-marker]"),
      ).not.toBeNull();
      expect(
        unticked
          .closest(view === "rail" ? ".ticket" : ".cell")!
          .querySelector("[data-allergy-marker]"),
      ).toBeNull();
    },
  );

  it.each(["es-ES", "es-MX"])(
    "keeps the marker and captured Spanish block together in %s",
    async (language) => {
      setLocale(language);
      const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
        groups: [allergyQueue()],
        view: "rail",
      });
      expect(
        el.shadowRoot!.querySelector("[data-allergy-marker]")!.getAttribute("aria-label"),
      ).toBe(t("kitchen_allergy.marker", "es"));
      const instructions = el.shadowRoot!.querySelector("[data-kitchen-allergy]");
      expect(instructions).not.toBeNull();
      expect(instructions!.textContent).toContain(allergyBlock.labels.es.avoids[0]);
    },
  );

  it("falls back to the captured English text, with no note or clash invented", async () => {
    setLocale("fr-FR");
    const group = allergyQueue();
    group.items[0]!.allergy = {
      ...allergyBlock,
      note: null,
      clashes: {},
      labels: { ...allergyBlock.labels, en: { avoids: ["Old captured label"], clashes: [] } },
    };
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [group],
      view: "rail",
    });
    const block = el.shadowRoot!.querySelector("[data-kitchen-allergy]");
    expect(block).not.toBeNull();
    expect(block!.textContent).toContain(
      "ALLERGY · Window <guest> {allergens}: Old captured label",
    );
    expect(block!.querySelector(".kitchen-allergy-note, .kitchen-allergy-clash")).toBeNull();
  });

  for (const view of ["rail", "kanban"] as const)
    for (const language of ["en", "es"] as const)
      it(`shows frozen instructions only on the assigned ${view} dish in ${language}`, async () => {
        setLocale(language);
        const group = allergyQueue();
        const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
          groups: [group],
          view,
        });
        const line = el.shadowRoot!.querySelector('[data-item="ticked"]')!;
        const instructions = line.querySelector("[data-kitchen-allergy]");
        expect(instructions).not.toBeNull();
        expect(instructions!.textContent).toContain(allergyBlock.who);
        expect(line.textContent).toContain(allergyBlock.labels[language].avoids[0]);
        expect(line.textContent).toContain(allergyBlock.labels[language].clashes[0]);
        expect(line.textContent).toContain(allergyBlock.note);
        expect(line.textContent).toContain("Dish's own note");
        expect(line.querySelector("script, guest")).toBeNull();
        expect(
          el.shadowRoot!.querySelector('[data-item="unticked"] [data-kitchen-allergy]'),
        ).toBeNull();
        const markers = el.shadowRoot!.querySelectorAll("[data-allergy-marker]");
        expect(markers).toHaveLength(1);
        expect(markers[0]!.getAttribute("aria-label")).toBe(t("kitchen_allergy.marker"));
        if (view === "kanban") {
          expect(line.querySelector(".number [data-allergy-marker]")).not.toBeNull();
          expect(
            el
              .shadowRoot!.querySelector('[data-item="unticked"]')!
              .closest(".cell")!
              .querySelector("[data-allergy-marker]"),
          ).toBeNull();
        }
        group.items[0]!.allergy = null;
        el.groups = [{ ...group }];
        await el.updateComplete;
        expect(el.shadowRoot!.querySelector("[data-allergy-marker]")).toBeNull();
      });

  it.each(["light", "dark"] as const)(
    "uses the danger token and accessible markers in %s",
    async (theme) => {
      const { el, host } = await mountWidget<TillStationQueue>(
        "till-station-queue",
        {
          groups: [allergyQueue()],
          view: "rail",
          notices: [allergyNotice("changed"), allergyNotice("removed")],
        },
        theme,
      );
      const block = el.shadowRoot!.querySelector<HTMLElement>("[data-kitchen-allergy]");
      expect(block).not.toBeNull();
      host.style.setProperty("--wt-color-danger", "rgb(171, 32, 69)");
      expect(getComputedStyle(block!).color).toBe("rgb(171, 32, 69)");
      host.style.removeProperty("--wt-color-danger");
      await expectNoA11yViolations(host);
    },
  );

  it("shows only the correction in its notice and acknowledges the exact id by keyboard", async () => {
    setLocale("en");
    const { el } = await mountWidget<TillStationQueue>("till-station-queue", {
      groups: [allergyQueue()],
      view: "rail",
      notices: [allergyNotice("changed"), allergyNotice("removed")],
    });
    const changed = el.shadowRoot!.querySelector('[data-notice="allergy-changed"]')!;
    const removed = el.shadowRoot!.querySelector('[data-notice="allergy-removed"]')!;
    expect(changed.textContent).toContain("Allergy changed");
    expect(changed.textContent).toContain(correctedBlock.who);
    expect(changed.textContent).not.toContain(allergyBlock.who);
    expect(removed.textContent).toContain("Allergy removed");
    expect(removed.querySelector("[data-kitchen-allergy]")).toBeNull();
    const ack = vi.fn();
    const advance = vi.fn();
    el.addEventListener("acknowledge-notice", ack);
    el.addEventListener("advance-item", advance);
    const button = changed
      .querySelector<HTMLElement>("wt-button")!
      .shadowRoot!.querySelector<HTMLButtonElement>("button")!;
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(ack).toHaveBeenCalledTimes(1);
    expect((ack.mock.calls[0]![0] as CustomEvent).detail).toEqual({ noticeId: "allergy-changed" });
    expect(advance).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector('[data-item="ticked"]')!.textContent).toContain(
      allergyBlock.who,
    );
  });
});
