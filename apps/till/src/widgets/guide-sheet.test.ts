import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "lit";
import { currentHelpMode, setHelpMode, type WtHelpTooltip, type WtModal } from "@waitron/ui";
import { cleanupWidgets, mountWidget, servedMenus } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { helpEn, helpEs } from "../i18n/help-strings.js";
import { deviceZonesFixture } from "../../test/device-zones.js";
import { helpBadge } from "./help-badge.js";
import "./guide-sheet.js";
import type { TillGuideSheet } from "./guide-sheet.js";
import "./till-shell.js";
import type { TillShell } from "./till-shell.js";
import "../till-app.js";
import type { TillApp } from "../till-app.js";
import type { TillApi, ZoneOfferCatalogue } from "../api/client.js";

const originalLocale = currentLocale();

afterEach(() => {
  setHelpMode(false);
  cleanupWidgets();
  setLocale(originalLocale);
});

const HREF = "/help/en/products#nutrition-at-the-till";

const closed = (el: Element) =>
  new Promise<Event>((resolve) => el.addEventListener("till-guide-close", resolve, { once: true }));

const modalOf = (sheet: TillGuideSheet) => sheet.shadowRoot!.querySelector<WtModal>("wt-modal")!;
const dialogOf = (sheet: TillGuideSheet) =>
  modalOf(sheet).shadowRoot!.querySelector<HTMLDialogElement>("dialog")!;
/** The sheet's name, and the heading it shows. */
const titlesOf = (sheet: TillGuideSheet) => [
  dialogOf(sheet).getAttribute("aria-label"),
  sheet.shadowRoot!.querySelector("h2")?.textContent,
];

async function mountSheet(href = HREF): Promise<TillGuideSheet> {
  setLocale("en");
  const { el } = await mountWidget<TillGuideSheet>("till-guide-sheet", { href });
  await modalOf(el).updateComplete;
  return el;
}

describe("the guide sheet", () => {
  it("opens full-screen with the guide in a frame and a Close button", async () => {
    const sheet = await mountSheet();
    const modal = modalOf(sheet);
    expect(modal.open).toBe(true);
    expect(modal.size).toBe("full");
    expect(titlesOf(sheet)).toEqual([helpEn["help.guide_title"], helpEn["help.guide_title"]]);
    const frame = sheet.shadowRoot!.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(HREF);
    expect(frame.title).toBe(helpEn["help.guide_title"]);
    const dialog = dialogOf(sheet).getBoundingClientRect();
    expect(dialog.width).toBeGreaterThan(innerWidth * 0.9);
    expect(dialog.height).toBeGreaterThan(innerHeight * 0.9);
    expect(frame.getBoundingClientRect().height).toBeGreaterThan(innerHeight / 2);
    const close = sheet.shadowRoot!.querySelector<HTMLElement>('wt-button[slot="footer"]')!;
    expect(close.textContent!.trim()).toBe(helpEn["help.guide_close"]);
  });

  it("is closed while it has no guide to show", async () => {
    const sheet = await mountSheet("");
    expect(modalOf(sheet).open).toBe(false);
    expect(sheet.shadowRoot!.querySelector("iframe")).toBeNull();
  });

  it("Close and Escape close it and tell the shell", async () => {
    const sheet = await mountSheet();
    let done = closed(sheet);
    const button = sheet.shadowRoot!.querySelector<HTMLElement>('wt-button[slot="footer"]')!;
    await userEvent.click(button.shadowRoot!.querySelector("button")!);
    const event = await done;
    expect(event.bubbles && event.composed).toBe(true);
    expect(dialogOf(sheet).open).toBe(false);

    sheet.href = "";
    await sheet.updateComplete;
    sheet.href = HREF;
    await sheet.updateComplete;
    await modalOf(sheet).updateComplete;
    expect(dialogOf(sheet).open).toBe(true);
    done = closed(sheet);
    await userEvent.keyboard("{Escape}");
    await done;
    expect(dialogOf(sheet).open).toBe(false);
  });
});

const shellProps: Partial<TillShell> = {
  formFactor: "till",
  activeScreen: "counter",
  operatorName: "Ana",
  affordances: [],
};

async function mountShellWithBadge(lang: string) {
  setLocale(lang);
  setHelpMode(true);
  const { el } = await mountWidget<TillShell>("till-shell", shellProps);
  const screen = document.createElement("div");
  screen.style.position = "relative";
  screen.style.padding = "40px";
  render(
    helpBadge("help.menu.dishes", "Search", { guide: "products.nutrition-at-the-till" }),
    screen,
  );
  el.append(screen);
  const badge = screen.querySelector<WtHelpTooltip>("wt-help-tooltip")!;
  await badge.updateComplete;
  return { el, badge };
}

async function openGuide(shell: TillShell, badge: WtHelpTooltip) {
  await userEvent.click(badge.shadowRoot!.querySelector("button")!);
  const link = badge.shadowRoot!.querySelector<HTMLAnchorElement>('[part="guide"]')!;
  const clicks: MouseEvent[] = [];
  link.addEventListener("click", (event) => clicks.push(event), { capture: true });
  await userEvent.click(link);
  await shell.updateComplete;
  const sheet = shell.shadowRoot!.querySelector<TillGuideSheet>("till-guide-sheet")!;
  await sheet.updateComplete;
  await modalOf(sheet).updateComplete;
  return { clicks, sheet };
}

describe("a guide link on the till", () => {
  it.each([
    { lang: "en", href: "/help/en/products#nutrition-at-the-till", text: helpEn },
    { lang: "es", href: "/help/es/products#nutrition-at-the-till", text: helpEs },
  ])(
    "a guide link in a badge opens the sheet, not a new tab ($lang; in Spanish it opens the Spanish page)",
    async ({ lang, href, text }) => {
      const { el, badge } = await mountShellWithBadge(lang);
      const { clicks, sheet } = await openGuide(el, badge);
      expect(clicks).toHaveLength(1);
      expect(clicks[0]!.defaultPrevented).toBe(true);
      expect(modalOf(sheet).open).toBe(true);
      expect(titlesOf(sheet)).toEqual([text["help.guide_title"], text["help.guide_title"]]);
      expect(sheet.shadowRoot!.querySelector("iframe")!.src.endsWith(href)).toBe(true);
    },
  );

  it("closing the sheet puts focus back on the badge", async () => {
    const { el, badge } = await mountShellWithBadge("en");
    const { sheet } = await openGuide(el, badge);
    const done = closed(sheet);
    const button = sheet.shadowRoot!.querySelector<HTMLElement>('wt-button[slot="footer"]')!;
    await userEvent.click(button.shadowRoot!.querySelector("button")!);
    await done;
    await el.updateComplete;
    expect(badge.shadowRoot!.activeElement).toBe(badge.shadowRoot!.querySelector("button"));
    expect(sheet.href).toBe("");
    expect(modalOf(sheet).open).toBe(false);
  });
});

// The till-app harness of till-app.help-mode.test.ts, cut to what a counter sign-in needs.
const counterTill = {
  locale: "en",
  invoiceLocale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  receiptPrintMode: "auto" as const,
  bumpMode: "line" as const,
  fireControl: "waiter" as const,
  courses: [],
  cardProvider: "none" as const,
  tipsEnabled: false,
  formFactor: "till" as const,
  capabilities: [],
  inactivityTimeoutSeconds: null,
  nodeId: "n1",
  servers: [],
};

const counterOffers: ZoneOfferCatalogue = {
  service: {
    open: true,
    zoneOpen: true,
    periodName: null,
    periodOccurrenceKey: null,
    keepOpen: null,
    zoneKeepOpen: null,
  },
  context: {
    departmentName: "Restaurant",
    zoneId: "zone-counter",
    departmentId: "department-default",
    serviceMode: "prepay",
  },
  defaultMenuId: "cat-default",
  menus: servedMenus(
    [{ id: "cat-default", name: "Main menu", isDefault: true, versionId: "v1" }],
    [],
  ),
  offers: [],
};

function stubApi(): TillApi {
  return {
    getTill: vi.fn().mockResolvedValue(counterTill),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi
      .fn()
      .mockResolvedValue({ deviceId: "till-dev", name: "Till 1", formFactor: "till" }),
    reportBattery: vi.fn().mockResolvedValue(undefined),
    listStaff: vi.fn().mockResolvedValue([]),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
      loginDefault: "es-ES",
    }),
    joinStatus: vi.fn().mockResolvedValue({ status: "pending" }),
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(undefined, [])),
    getDeviceStationScreen: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    listDefaultZoneOffers: vi.fn().mockResolvedValue(counterOffers),
    listZoneOffers: vi.fn().mockResolvedValue(counterOffers),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    logout: vi.fn().mockResolvedValue(undefined),
  } as unknown as TillApi;
}

function deepFind<T extends Element>(root: ParentNode, selector: string): T | null {
  const found = root.querySelector<T>(selector);
  if (found) return found;
  for (const node of root.querySelectorAll("*")) {
    const inner = node.shadowRoot ? deepFind<T>(node.shadowRoot, selector) : null;
    if (inner) return inner;
  }
  return null;
}

describe("the guide sheet and the lock", () => {
  it("the sheet closes when the till locks", async () => {
    const activity = {
      configure: vi.fn(),
      noteInteraction: vi.fn(),
      reacquire: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const { el } = await mountWidget<TillApp>("till-app", {
      api: stubApi(),
      sessionActivity: activity as never,
    });
    const lock = () => el.shadowRoot!.querySelector("till-lock-screen");
    const shell = () => el.shadowRoot!.querySelector<TillShell>("till-shell");
    const signIn = async () => {
      await vi.waitFor(() => expect(lock()).not.toBeNull());
      lock()!.dispatchEvent(
        new CustomEvent("logged-in", {
          detail: { personId: "p1", displayName: "Ana", permissions: [] },
          bubbles: true,
          composed: true,
        }),
      );
      await vi.waitFor(() => expect(shell()).not.toBeNull());
    };
    await signIn();
    setHelpMode(true);
    const badge = await vi.waitFor(() => {
      const found = deepFind<WtHelpTooltip>(el.shadowRoot!, "wt-help-tooltip[guide-href]");
      expect(found).not.toBeNull();
      return found!;
    });
    await badge.updateComplete;
    const { sheet } = await openGuide(shell()!, badge);
    expect(modalOf(sheet).open).toBe(true);

    (activity.configure.mock.calls.at(-1)![0] as { onIdle: () => void }).onIdle();
    await vi.waitFor(() => expect(lock()).not.toBeNull());
    expect(currentHelpMode()).toBe(false);
    await signIn();
    await shell()!.updateComplete;
    const open = [...el.shadowRoot!.querySelectorAll("till-shell")].flatMap((bar) => [
      ...bar.shadowRoot!.querySelectorAll<TillGuideSheet>("till-guide-sheet"),
    ]);
    expect(open.filter((found) => found.href !== "" || modalOf(found).open)).toEqual([]);
  });
});
