import { expect, it } from "vitest";
import { commands } from "vitest/browser";
import type { WaitPage } from "../test/offline-navigation.js";
import { es } from "./i18n/strings.js";
import { buildOfflineWorker, buildRetiredOfflineWorker } from "./offline-worker.js";

const worker = buildOfflineWorker("");
const retired = buildRetiredOfflineWorker();

declare module "vitest/browser" {
  interface BrowserCommands {
    probeOfflineNavigation(
      worker: string,
      retired: string,
      path: string,
      scenario: "reconnect" | "retire" | WaitPage,
      locale?: string,
    ): Promise<unknown>;
  }
}

it.each([
  {
    path: "/till/",
    locale: "en-GB",
    heading: "Can't reach the box.",
    paragraphs: [
      "Check that this phone is on the venue's WiFi.",
      "Already on the venue's WiFi? Check that the box is switched on. If it is, its certificate may need installing again.",
      "Show me how",
      "The till opens by itself when the box answers.",
    ],
  },
  {
    path: "/till/tabs/counter/menu/lunch?view=saved#order",
    locale: "es-ES",
    heading: es["offline.title"],
    paragraphs: [
      es["offline.wifi"],
      es["offline.already_on_wifi"],
      es["trust.open_setup"],
      es["offline.opens_itself"],
    ],
  },
])(
  "reopens $path after a connection loss, recovery and upgrade",
  async ({ path, locale, heading, paragraphs }) => {
    expect(
      await commands.probeOfflineNavigation(worker, retired, path, "reconnect", locale),
    ).toEqual({
      heading,
      paragraphs,
      instructions: "http://127.0.0.1/setup/trust?app=till",
      target: "_blank",
      rel: "noopener",
      caches: [],
      duringUpgrade: heading,
      recovered: true,
      history: "new build",
      refused: 503,
      redirect: "/primary",
    });
  },
  140_000,
);

it("retires the worker without reloading the open till", async () => {
  expect(await commands.probeOfflineNavigation(worker, retired, "/till/", "retire")).toEqual({
    controlled: true,
    sameDocument: true,
    registrations: 0,
  });
}, 60_000);

it.each(["clock confirmation", "standing down"] as const)(
  "opens the box's %s page from the reconnect page",
  async (scenario) => {
    expect(await commands.probeOfflineNavigation(worker, retired, "/till/", scenario)).toEqual({
      sameUrl: true,
    });
  },
  60_000,
);
