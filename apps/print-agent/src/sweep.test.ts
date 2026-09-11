import type { networkInterfaces } from "node:os";
import { describe, expect, it } from "vitest";
import type { DiscoveredDevice } from "@waitron/print-agent";
import { hostsInSubnet, mergeDiscovered, subnetsToSweep, sweepPort } from "./sweep.js";

type Ifaces = ReturnType<typeof networkInterfaces>;

type IfaceEntry = NonNullable<Ifaces[string]>[number];

const iface = (
  address: string,
  cidr: string | null,
  family: "IPv4" | "IPv6" = "IPv4",
  internal = false,
): IfaceEntry => {
  const common = { address, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", internal, cidr };
  return family === "IPv6"
    ? { ...common, family: "IPv6", scopeid: 0 }
    : { ...common, family: "IPv4" };
};

describe("hostsInSubnet", () => {
  it("lists every usable address of a /24 except the network, the broadcast and the box itself", () => {
    const hosts = hostsInSubnet("192.168.10.10/24");
    expect(hosts).toHaveLength(253);
    expect(hosts[0]).toBe("192.168.10.1");
    expect(hosts.at(-1)).toBe("192.168.10.254");
    expect(hosts).not.toContain("192.168.10.0");
    expect(hosts).not.toContain("192.168.10.10");
    expect(hosts).not.toContain("192.168.10.255");
  });

  it("handles a prefix that is not octet-aligned", () => {
    expect(hostsInSubnet("192.168.10.10/30")).toEqual(["192.168.10.9"]);
  });

  it("refuses a network wider than the sweep cap (a Docker /16 bridge would be 65k connects)", () => {
    expect(hostsInSubnet("172.17.0.1/16")).toEqual([]);
  });

  it("sweeps a /22 (1024 addresses), the widest network the cap admits", () => {
    expect(hostsInSubnet("10.1.0.7/22")).toHaveLength(1021);
  });

  it("returns nothing for a malformed cidr", () => {
    expect(hostsInSubnet("not-a-cidr")).toEqual([]);
    expect(hostsInSubnet("192.168.10.10/")).toEqual([]);
    expect(hostsInSubnet("192.168.10.10/40")).toEqual([]);
  });
});

describe("subnetsToSweep", () => {
  it("keeps the cidr of every non-internal IPv4 interface and drops loopback, IPv6 and cidr-less entries", () => {
    const ifaces: Ifaces = {
      lo: [iface("127.0.0.1", "127.0.0.1/8", "IPv4", true)],
      enp0s31f6: [
        iface("192.168.10.10", "192.168.10.10/24"),
        iface("fe80::1", "fe80::1/64", "IPv6"),
      ],
      wlan0: [iface("192.168.20.5", null)],
      docker0: [iface("172.17.0.1", "172.17.0.1/16")],
    };
    expect(subnetsToSweep(() => ifaces)).toEqual(["192.168.10.10/24", "172.17.0.1/16"]);
  });
});

describe("sweepPort", () => {
  const open = new Set(["192.168.10.247", "192.168.10.56"]);
  const connect = async (host: string): Promise<boolean> => open.has(host);

  it("reports each host that accepts a TCP connection on the port, in address order, as a network_tcp device", async () => {
    const found = await sweepPort({
      hosts: ["192.168.10.1", "192.168.10.56", "192.168.10.100", "192.168.10.247"],
      port: 9100,
      connect,
    });
    expect(found).toEqual<DiscoveredDevice[]>([
      { transport: "network_tcp", host: "192.168.10.56", port: 9100 },
      { transport: "network_tcp", host: "192.168.10.247", port: 9100 },
    ]);
  });

  it("treats a throwing connect as closed rather than failing the sweep", async () => {
    const found = await sweepPort({
      hosts: ["192.168.10.1", "192.168.10.56"],
      port: 9100,
      connect: async (host) => {
        if (host === "192.168.10.1") throw new Error("EHOSTUNREACH");
        return true;
      },
    });
    expect(found.map((d) => d.host)).toEqual(["192.168.10.56"]);
  });

  it("never has more than `concurrency` connects in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const found = await sweepPort({
      hosts: Array.from({ length: 9 }, (_, i) => `10.0.0.${i + 1}`),
      port: 9100,
      concurrency: 3,
      connect: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return true;
      },
    });
    expect(found).toHaveLength(9);
    expect(peak).toBe(3);
  });

  it("hands the per-host timeout to the connect seam", async () => {
    const seen: number[] = [];
    await sweepPort({
      hosts: ["10.0.0.1"],
      port: 9100,
      timeoutMs: 250,
      connect: async (_host, _port, timeoutMs) => {
        seen.push(timeoutMs);
        return false;
      },
    });
    expect(seen).toEqual([250]);
  });
});

describe("mergeDiscovered", () => {
  it("keeps the announced (named) entry when the sweep also found the same host:port, and appends the rest", () => {
    const announced: DiscoveredDevice[] = [
      { transport: "network_tcp", host: "192.168.10.56", port: 9100, name: "HP LaserJet" },
    ];
    const swept: DiscoveredDevice[] = [
      { transport: "network_tcp", host: "192.168.10.56", port: 9100 },
      { transport: "network_tcp", host: "192.168.10.247", port: 9100 },
    ];
    expect(mergeDiscovered(announced, swept)).toEqual([
      { transport: "network_tcp", host: "192.168.10.56", port: 9100, name: "HP LaserJet" },
      { transport: "network_tcp", host: "192.168.10.247", port: 9100 },
    ]);
  });
});
