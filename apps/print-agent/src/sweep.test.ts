import type { networkInterfaces } from "node:os";
import { describe, expect, it } from "vitest";
import type { DiscoveredDevice } from "@waitron/print-agent";
import { hostsInSubnet, mergeDiscovered, sweepCandidates, sweepPort } from "./sweep.js";

// Synthesised from Node's documented `os.networkInterfaces()` fields, NOT captured from the box.
type Ifaces = ReturnType<typeof networkInterfaces>;
type IfaceEntry = NonNullable<Ifaces[string]>[number];

const netmaskOf = (cidr: string | null, family: "IPv4" | "IPv6"): string => {
  const prefix = cidr === null ? 24 : Number(cidr.split("/")[1]);
  if (family === "IPv6") return "ffff:".repeat(prefix / 16).replace(/:$/, "") + "::";
  const bits = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return [bits >>> 24, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255].join(".");
};

const iface = (
  address: string,
  cidr: string | null,
  family: "IPv4" | "IPv6" = "IPv4",
  internal = false,
): IfaceEntry => {
  const common = {
    address,
    netmask: netmaskOf(cidr, family),
    mac: "00:00:00:00:00:00",
    internal,
    cidr,
  };
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

  it("returns nothing for an address with an over-long or out-of-range octet", () => {
    // `0010` is the value 10, which only the three-digit rule refuses; `256` only the range rule.
    expect(hostsInSubnet("0010.0.0.1/30")).toEqual([]);
    expect(hostsInSubnet("256.0.0.1/30")).toEqual([]);
  });
});

describe("sweepCandidates", () => {
  it("enumerates every non-internal IPv4 interface's subnet and drops loopback, IPv6 and cidr-less entries", () => {
    const ifaces: Ifaces = {
      lo: [iface("127.0.0.1", "127.0.0.1/8", "IPv4", true)],
      enp0s31f6: [
        iface("192.168.10.10", "192.168.10.10/24"),
        iface("fe80::1", "fe80::1/64", "IPv6"),
      ],
      wlan0: [iface("192.168.20.5", null)],
    };
    const hosts = sweepCandidates({ interfaces: () => ifaces });
    expect(hosts).toHaveLength(253);
    expect(hosts).not.toContain("192.168.10.10");
    expect(hosts.every((h) => h.startsWith("192.168.10."))).toBe(true);
  });

  it("skips a Docker /16 bridge through the host cap", () => {
    const ifaces: Ifaces = {
      eth0: [iface("192.168.10.10", "192.168.10.10/30")],
      docker0: [iface("172.17.0.1", "172.17.0.1/16")],
    };
    expect(sweepCandidates({ interfaces: () => ifaces })).toEqual(["192.168.10.9"]);
  });

  it("passes over an interface name that carries no entries", () => {
    const ifaces: Ifaces = {
      ghost: undefined,
      eth0: [iface("192.168.10.10", "192.168.10.10/30")],
    };
    expect(sweepCandidates({ interfaces: () => ifaces })).toEqual(["192.168.10.9"]);
  });

  it("probes each address once and never the box's own other address when two interfaces share a subnet", () => {
    const ifaces: Ifaces = {
      eth0: [iface("192.168.10.10", "192.168.10.10/24")],
      wlan0: [iface("192.168.10.11", "192.168.10.11/24")],
    };
    const hosts = sweepCandidates({ interfaces: () => ifaces });
    expect(hosts).toHaveLength(252);
    expect(new Set(hosts).size).toBe(252);
    expect(hosts).not.toContain("192.168.10.10");
    expect(hosts).not.toContain("192.168.10.11");
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
  const sharedQueue = (path: string, name: string): DiscoveredDevice => ({
    transport: "network_tcp",
    host: "192.168.1.20",
    port: 631,
    name,
    ipp: { port: 631, resourcePath: path },
  });

  it.each([false, true])(
    "A576 duplicate queue announcements do not hide another queue (reversed %s)",
    (reverse) => {
      const kitchen = sharedQueue("/printers/kitchen", "Kitchen A4");
      const reception = sharedQueue("/printers/reception", "Reception A4");
      const announced = reverse ? [reception, kitchen, kitchen] : [kitchen, kitchen, reception];
      expect(mergeDiscovered(announced, [])).toEqual(
        (reverse ? [reception, kitchen] : [kitchen, reception]).map((d) => ({
          ...d,
          ippOnly: true,
        })),
      );
    },
  );

  it("A576 raw plus multiple IPP queues is ambiguous", () => {
    const raw: DiscoveredDevice = {
      transport: "network_tcp",
      host: "192.168.1.20",
      port: 9100,
      name: "Raw",
    };
    const kitchen = sharedQueue("/printers/kitchen", "Kitchen A4");
    const reception = sharedQueue("/printers/reception", "Reception A4");
    expect(mergeDiscovered([kitchen, raw, reception, kitchen], [raw])).toEqual([
      raw,
      { ...kitchen, ippOnly: true },
      { ...reception, ippOnly: true },
    ]);
  });

  it("A576 keeps case-distinct and trailing-slash-distinct queue paths", () => {
    const devices = [
      "/printers/Kitchen",
      "/printers/kitchen",
      "/printers/kitchen/",
      "/printers/kitchen:631",
    ].map((path) => sharedQueue(path, path));
    expect(mergeDiscovered(devices, [])).toEqual(devices.map((d) => ({ ...d, ippOnly: true })));
  });

  it("A576 keeps two raw ports when they share one IPP queue", () => {
    const queue = sharedQueue("/printers/kitchen", "Kitchen A4");
    const raws: DiscoveredDevice[] = [9100, 9101].map((port) => ({
      transport: "network_tcp",
      host: "192.168.1.20",
      port,
    }));
    expect(mergeDiscovered([queue, ...raws], [])).toEqual(raws.map((d) => ({ ...queue, ...d })));
  });

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

  const ippAnnounced = (host: string, port: number, extra: Partial<DiscoveredDevice> = {}) =>
    ({
      transport: "network_tcp",
      host,
      port,
      name: "Office HP",
      ipp: { port, resourcePath: "/ipp/print" },
      ...extra,
    }) satisfies DiscoveredDevice;

  it("makes one device of a host announced by IPP and on 9100 in separate packets and swept on 9100", () => {
    const pdl: DiscoveredDevice = {
      transport: "network_tcp",
      host: "192.168.10.56",
      port: 9100,
      name: "HP LaserJet",
      make: "HP",
    };
    const merged = mergeDiscovered(
      [ippAnnounced("192.168.10.56", 631), pdl],
      [{ transport: "network_tcp", host: "192.168.10.56", port: 9100 }],
    );
    expect(merged).toEqual([{ ...pdl, ipp: { port: 631, resourcePath: "/ipp/print" } }]);
  });

  it("gives a swept 9100 device the IPP announcement's endpoint and, where it has none, its name", () => {
    const merged = mergeDiscovered(
      [ippAnnounced("192.168.10.56", 631, { make: "HP", model: "M181fw" })],
      [{ transport: "network_tcp", host: "192.168.10.56", port: 9100 }],
    );
    expect(merged).toEqual([
      {
        transport: "network_tcp",
        host: "192.168.10.56",
        port: 9100,
        name: "Office HP",
        make: "HP",
        model: "M181fw",
        ipp: { port: 631, resourcePath: "/ipp/print" },
      },
    ]);
  });

  it("gives an IPP-only host one device on its IPP port, marked ippOnly", () => {
    const merged = mergeDiscovered(
      [ippAnnounced("192.168.10.60", 8631), ippAnnounced("192.168.10.60", 8631)],
      [{ transport: "network_tcp", host: "192.168.10.247", port: 9100 }],
    );
    expect(merged).toEqual([
      { transport: "network_tcp", host: "192.168.10.247", port: 9100 },
      { ...ippAnnounced("192.168.10.60", 8631), ippOnly: true },
    ]);
  });

  it("keeps one device per announced raw host:port when a printer answers twice", () => {
    const pdl: DiscoveredDevice = {
      transport: "network_tcp",
      host: "192.168.10.56",
      port: 9100,
      name: "HP LaserJet",
    };
    expect(mergeDiscovered([pdl, { ...pdl }], [])).toEqual([pdl]);
  });
});
