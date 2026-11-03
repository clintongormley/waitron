import { afterEach, describe, expect, it, vi } from "vitest";
import type { PassBoard, TillApi } from "../api/client.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import type { TillPassBoard } from "../widgets/pass-board.js";
import { allergyBlock, allergyBoard } from "../../test/kitchen-allergy-fixtures.js";
import { passCard, passItem } from "../../test/pass-board-fixtures.js";
import type { TillPassScreen } from "./till-pass-screen.js";
import "./till-pass-screen.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

type Mode = "all" | "pass" | "monitor";

/** `all`: a till on All stations; `pass`: a kitchen display's pass; `monitor`: a pass monitor. */
async function mount(mode: Mode, board: PassBoard, theme: "light" | "dark" = "light") {
  const read = { board, stations: [], zones: null };
  const api = {
    getExpoBoard: vi.fn(async () => ({ board })),
    getDeviceIdentity: vi.fn(async () => ({ kitchenScreens: [] })),
    getDevicePassBoard: vi.fn(async () => read),
    getDevicePassMonitorBoard: vi.fn(async () => read),
  } as unknown as TillApi;
  const { el, host } = await mountWidget<TillPassScreen>(
    "till-pass-screen",
    {
      api,
      deviceName: "Kitchen pass",
      deviceMode: mode === "pass",
      monitor: mode === "monitor",
      ...(mode === "all" ? {} : { initialBoard: read }),
    },
    theme,
  );
  const root = () => el.shadowRoot!.querySelector<TillPassBoard>("till-pass-board")!.shadowRoot!;
  await vi.waitFor(() => expect(root().querySelector('[data-item="unticked"]')).not.toBeNull());
  return { root, host };
}

describe("A669 boards pass", () => {
  for (const kind of ["bill", "group"] as const)
    for (const mode of ["all", "pass", "monitor"] as const)
      it(`marks a ${kind} card's head once for its allergy, leaves a card without one unmarked and draws every dish on ${mode}`, async () => {
        const board = allergyBoard(kind);
        const plain = passCard({
          key: "bill:plain",
          target: { kind: "bill", workingOrderId: "plain" },
          orders: [{ orderId: "plain", orderNumber: 2, tableLabel: "T2", kitchenNote: null }],
          items: [passItem({ id: "plain-item", orderId: "plain" })],
        });
        const { root } = await mount(mode, { ...board, inProgress: [...board.inProgress, plain] });
        expect(
          root().querySelector('[data-card="bill:plain"] [data-item="plain-item"]'),
        ).not.toBeNull();
        expect(root().querySelector('[data-card="bill:plain"] [data-allergy-marker]')).toBeNull();
        const card = root().querySelector(
          `[data-card="${kind === "bill" ? "bill:bill-1" : "group:group-1"}"]`,
        )!;
        expect(card.querySelectorAll("[data-allergy-marker]")).toHaveLength(1);
        expect(root().querySelectorAll("[data-allergy-marker]")).toHaveLength(1);
        expect(card.querySelector('[data-item="ticked"]')).not.toBeNull();
        expect(card.querySelector('[data-item="unticked"]')).not.toBeNull();
      });

  for (const mode of ["all", "pass", "monitor"] as const)
    for (const language of ["en", "es"] as const)
      it(`shows the frozen original in ${mode} in ${language}`, async () => {
        setLocale(language);
        const { root, host } = await mount(
          mode,
          allergyBoard(),
          language === "en" ? "light" : "dark",
        );
        const line = root().querySelector('[data-item="ticked"]')!;
        expect(line.textContent).toContain("Soup cook");
        const instructions = line.querySelector("[data-kitchen-allergy]");
        expect(instructions).not.toBeNull();
        expect(instructions!.textContent).toContain(allergyBlock.who);
        expect(line.textContent).toContain(allergyBlock.labels[language].avoids[0]);
        expect(line.textContent).toContain(allergyBlock.labels[language].clashes[0]);
        expect(line.textContent).toContain(allergyBlock.note);
        expect(line.querySelector("script, guest")).toBeNull();
        expect(root().querySelector('[data-item="unticked"] [data-kitchen-allergy]')).toBeNull();
        expect(root().querySelectorAll("[data-allergy-marker]")).toHaveLength(1);
        expect(root().querySelector("[data-allergy-marker]")!.getAttribute("aria-label")).toBe(
          t("kitchen_allergy.marker"),
        );
        await expectNoA11yViolations(host);
      });
});
