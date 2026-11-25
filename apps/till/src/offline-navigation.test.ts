import { expect, it } from "vitest";
import { commands } from "vitest/browser";
import { buildOfflineWorker, buildRetiredOfflineWorker } from "./offline-worker.js";

const worker = buildOfflineWorker("");
const retired = buildRetiredOfflineWorker();

declare module "vitest/browser" {
  interface BrowserCommands {
    probeOfflineNavigation(
      worker: string,
      retired: string,
      path: string,
      scenario: "reconnect" | "retire",
    ): Promise<unknown>;
  }
}

it.each(["/till/", "/till/tabs/counter/menu/lunch?view=saved#order"])(
  "reopens %s with fresh content after a connection loss and upgrade",
  async (path) => {
    expect(await commands.probeOfflineNavigation(worker, retired, path, "reconnect")).toEqual({
      heading: "Can't reach the box.",
      instructions: "http://127.0.0.1/setup/trust?app=till",
      target: "_blank",
      rel: "noopener",
      caches: [],
      duringUpgrade: "Can't reach the box.",
      recovered: true,
      refused: 503,
      redirect: "/primary",
    });
  },
  30_000,
);

it("retires the worker without reloading the open till", async () => {
  expect(await commands.probeOfflineNavigation(worker, retired, "/till/", "retire")).toEqual({
    controlled: true,
    sameDocument: true,
    registrations: 0,
  });
});
