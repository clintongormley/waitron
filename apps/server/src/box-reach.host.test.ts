import { describe, expect, it, vi } from "vitest";
import { buildReachInfo, defaultRouteIface, listBoxIpv4 } from "./box-reach.js";

// The host readings the helpers fall back to when nothing is injected: the route table file and the
// interface list. Both are replaced here so the defaults can be observed on any development machine.
const host = vi.hoisted(() => ({
  route: "",
  readPaths: [] as unknown[],
  interfaces: {} as Record<string, unknown>,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn((path: unknown, ...rest: unknown[]) => {
      host.readPaths.push([path, ...rest]);
      return host.route;
    }),
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, networkInterfaces: () => host.interfaces };
});

const ROUTE =
  "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n" +
  "eth0\t00000000\t010A0A0A\t0003\t0\t0\t100\t00000000\t0\t0\t0\n";

describe("box reach with nothing injected", () => {
  it("reads the default route from Linux's /proc/net/route", () => {
    host.route = ROUTE;
    host.readPaths = [];
    expect(defaultRouteIface()).toBe("eth0");
    expect(host.readPaths).toEqual([["/proc/net/route", "utf8"]]);
  });

  it("lists the host's own interfaces and route when building the reach URLs", () => {
    host.route = ROUTE;
    host.interfaces = {
      eth0: [{ address: "192.168.10.10", family: "IPv4", internal: false }],
      wlan0: [{ address: "192.168.20.4", family: "IPv4", internal: false }],
      docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
    };
    expect(listBoxIpv4()).toEqual(["192.168.10.10"]);
    expect(buildReachInfo({ hostname: "waitron.local", port: 443, secure: true })).toEqual({
      hostname: "waitron.local",
      scheme: "https",
      port: 443,
      addresses: ["192.168.10.10"],
      hostnameUrl: "https://waitron.local",
      ipUrls: ["https://192.168.10.10"],
      qrTarget: "https://192.168.10.10",
    });
  });
});
