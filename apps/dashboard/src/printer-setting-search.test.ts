import { expect, it, vi } from "vitest";
import { createRequest } from "@waitron/dashboard-kit";
import { DashboardApi } from "./api/client.js";
import { printerSettingSearchDestinations } from "./printer-setting-search.js";
import { officePrinter, receiptPrinter } from "./testing/printer-settings-fixture.js";

it("resolves only offered controls through passive lists, including switched-off receipt printers", async () => {
  const printers = [
    { ...receiptPrinter, id: "p/+", name: "Network", active: false },
    { ...receiptPrinter, id: "usb", name: "USB", transport: "usb" },
    { ...receiptPrinter, id: "bt", name: "Bluetooth", transport: "bluetooth" },
    { ...receiptPrinter, id: "cloud", name: "Cloud", transport: "cloud_poll" },
  ];
  const fetchImpl = vi.fn(
    async (path: string) =>
      new Response(
        JSON.stringify(path === "/management-api/printers" ? printers : [officePrinter]),
      ),
  );
  const api = new DashboardApi("", fetchImpl);
  const background = vi.spyOn(api.background, "listPrinters");
  const pages = vi.spyOn(api.background, "listPagePrinters");
  vi.spyOn(api, "listPrinters").mockRejectedValue(new Error("foreground read"));
  vi.spyOn(api, "listPagePrinters").mockRejectedValue(new Error("foreground read"));
  const entries = printerSettingSearchDestinations(api);
  const ctx = { request: createRequest({ fetchImpl }) };
  const resolve = (id: string) =>
    entries.find((entry) => entry.id === `dashboard:printer:${id}`)!.resolve(ctx);
  expect(await resolve("printer-detail-host")).toEqual([
    {
      id: "p/+",
      label: "Network",
      path: "/printers/view/printers/printer/p%2F%2B/editor/edit",
    },
  ]);
  expect(pages).not.toHaveBeenCalled();
  expect(await resolve("printer-detail-name")).toEqual([
    {
      id: "p/+",
      label: "Network",
      path: "/printers/view/printers/printer/p%2F%2B/editor/edit",
    },
    { id: "usb", label: "USB", path: "/printers/view/printers/printer/usb/editor/edit" },
    { id: "bt", label: "Bluetooth", path: "/printers/view/printers/printer/bt/editor/edit" },
    {
      id: "cloud",
      label: "Cloud",
      path: "/printers/view/printers/printer/cloud/editor/edit",
    },
    { id: "pp1", label: "Office", path: "/printers/view/printers/printer/pp1/editor/edit" },
  ]);
  expect(await resolve("printer-cash-drawer")).toEqual([
    {
      id: "p/+",
      label: "Network",
      path: "/printers/view/printers/printer/p%2F%2B/editor/calibrate/step/3",
    },
    {
      id: "usb",
      label: "USB",
      path: "/printers/view/printers/printer/usb/editor/calibrate/step/3",
    },
    {
      id: "bt",
      label: "Bluetooth",
      path: "/printers/view/printers/printer/bt/editor/calibrate/step/3",
    },
    {
      id: "cloud",
      label: "Cloud",
      path: "/printers/view/printers/printer/cloud/editor/calibrate/step/3",
    },
  ]);
  expect(background).toHaveBeenCalledTimes(3);
  expect(pages).toHaveBeenCalledTimes(1);
});
