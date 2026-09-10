import { describe, it, expect } from "vitest";
import type { networkInterfaces } from "node:os";
import { buildReachInfo, defaultRouteIface, listBoxIpv4, parseBoxAddresses } from "./box-reach.js";

type Ifaces = ReturnType<typeof networkInterfaces>;
const asIfaces = (v: unknown): Ifaces => v as Ifaces;

const base = { hostname: "waitron.local", listIpv4: () => ["192.168.1.5", "10.0.0.9"] };

it("builds hostname + ip URLs with a non-default port", () => {
  const r = buildReachInfo({ ...base, port: 8080, secure: true });
  expect(r.hostnameUrl).toBe("https://waitron.local:8080");
  expect(r.ipUrls).toEqual(["https://192.168.1.5:8080", "https://10.0.0.9:8080"]);
  expect(r.qrTarget).toBe("https://192.168.1.5:8080");
  expect(r.addresses).toEqual(["192.168.1.5", "10.0.0.9"]);
});

it("omits the port when it is the scheme default (443)", () => {
  const r = buildReachInfo({ ...base, port: 443, secure: true });
  expect(r.hostnameUrl).toBe("https://waitron.local");
  expect(r.ipUrls[0]).toBe("https://192.168.1.5");
});

it("uses http when not secure", () => {
  const r = buildReachInfo({ ...base, port: 80, secure: false });
  expect(r.hostnameUrl).toBe("http://waitron.local");
});

// The advertised IP URLs must be cert-coverable: the box leaf's iPAddress SANs are filtered to the
// CA's permitted subtrees (`isPermittedLeafIpv4`), so an out-of-set interface address (Tailscale
// 100.64/10 CGNAT, 169.254/16 link-local) would present an `https://<ip>/` the leaf's cert cannot
// vouch for → a TLS name mismatch on dial. Drop those from the advertised set; keep the permitted
// LAN address and always keep the `waitron.local` hostname URL (the cert covers the NAME).
it("drops out-of-set IPs from the advertised URLs but keeps permitted LAN + the hostname URL", () => {
  const r = buildReachInfo({
    hostname: "waitron.local",
    port: 8080,
    secure: true,
    listIpv4: () => ["100.64.1.2", "192.168.1.50", "169.254.1.2"],
  });
  expect(r.hostnameUrl).toBe("https://waitron.local:8080");
  expect(r.addresses).toEqual(["192.168.1.50"]);
  expect(r.ipUrls).toEqual(["https://192.168.1.50:8080"]);
  expect(r.qrTarget).toBe("https://192.168.1.50:8080");
});

// No cert-coverable IP: the box still advertises the hostname URL (name-based reach via mDNS, whose
// `waitron.local` name the cert covers), and the IP-QR target is null rather than an error.
it("advertises only the hostname URL when no IP is cert-coverable", () => {
  const r = buildReachInfo({
    hostname: "waitron.local",
    port: 8080,
    secure: true,
    listIpv4: () => ["100.64.1.2", "169.254.1.2"],
  });
  expect(r.hostnameUrl).toBe("https://waitron.local:8080");
  expect(r.addresses).toEqual([]);
  expect(r.ipUrls).toEqual([]);
  expect(r.qrTarget).toBeNull();
});

it("qrTarget is null when there is no non-internal IPv4", () => {
  const r = buildReachInfo({
    hostname: "waitron.local",
    port: 8080,
    secure: true,
    listIpv4: () => [],
  });
  expect(r.qrTarget).toBeNull();
  expect(r.ipUrls).toEqual([]);
});

describe("parseBoxAddresses", () => {
  it("is undefined when unset or empty (the VAR=-means-unset rule)", () => {
    expect(parseBoxAddresses(undefined)).toBeUndefined();
    expect(parseBoxAddresses("")).toBeUndefined();
    expect(parseBoxAddresses("   ")).toBeUndefined();
  });

  it("parses one or many, trimming", () => {
    expect(parseBoxAddresses("192.168.1.10")).toEqual(["192.168.1.10"]);
    expect(parseBoxAddresses(" 192.168.1.10 , 10.0.0.4 ")).toEqual(["192.168.1.10", "10.0.0.4"]);
  });

  // AppError's message is the CODE alone (`super(code)` — packages/shared/src/errors.ts), so a
  // regex on the message can never see `reason`. Assert the structured fields instead.
  it("refuses a non-IPv4 entry", () => {
    expect(() => parseBoxAddresses("192.168.1.10,nope")).toThrow(
      expect.objectContaining({
        code: "server.config_invalid",
        params: expect.objectContaining({ reason: "box_addresses_invalid" }),
      }),
    );
  });

  it("refuses loopback — it would advertise an address no device can reach", () => {
    expect(() => parseBoxAddresses("127.0.0.1")).toThrow(
      expect.objectContaining({ code: "server.config_invalid" }),
    );
  });

  // 0.0.0.0 is a bind wildcard, never a destination — advertising it is as unreachable as
  // advertising loopback, so the guard whose purpose is refusing undialable addresses refuses it.
  it("refuses the unspecified address 0.0.0.0", () => {
    expect(() => parseBoxAddresses("0.0.0.0")).toThrow(
      expect.objectContaining({
        code: "server.config_invalid",
        params: expect.objectContaining({ reason: "box_addresses_invalid" }),
      }),
    );
  });
});

describe("listBoxIpv4", () => {
  // A box always runs under Docker (network_mode: host), so the host carries docker0 / br-* bridge
  // interfaces alongside the real LAN NIC. Their 172.x addresses are non-internal, so the old
  // loopback-only filter advertised them over mDNS / in the cert SANs — and a phone that resolved
  // waitron.local to one could not connect. Advertise only the default-route interface's addresses.
  const withBridges = asIfaces({
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    eth0: [
      { address: "192.168.10.10", family: "IPv4", internal: false },
      { address: "fe80::1", family: "IPv6", internal: false },
    ],
    docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
    "br-abc123": [{ address: "172.18.0.1", family: "IPv4", internal: false }],
  });

  it("returns only the default-route interface's IPv4, excluding Docker bridges", () => {
    expect(listBoxIpv4({ interfaces: () => withBridges, defaultRouteIface: () => "eth0" })).toEqual(
      ["192.168.10.10"],
    );
  });

  it("keeps a legitimate 172.x LAN when it is the uplink, not treating it as a bridge", () => {
    const on172 = asIfaces({
      eth0: [{ address: "172.16.5.9", family: "IPv4", internal: false }],
      docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
    });
    expect(listBoxIpv4({ interfaces: () => on172, defaultRouteIface: () => "eth0" })).toEqual([
      "172.16.5.9",
    ]);
  });

  it("falls back to non-virtual interfaces when there is no default route", () => {
    // No uplink resolvable (isolated/static LAN): keep every non-internal IPv4 EXCEPT those on a
    // known virtual/container bridge interface, so a box with a gateway is not left unreachable.
    expect(
      listBoxIpv4({ interfaces: () => withBridges, defaultRouteIface: () => undefined }),
    ).toEqual(["192.168.10.10"]);
  });
});

describe("defaultRouteIface", () => {
  it("reads the interface carrying the 0.0.0.0 route from /proc/net/route", () => {
    const route =
      "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n" +
      "eth0\t00000000\t010A0A0A\t0003\t0\t0\t100\t00000000\t0\t0\t0\n" +
      "docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0\n";
    expect(defaultRouteIface(() => route)).toBe("eth0");
  });

  it("is undefined when the route table cannot be read (e.g. not Linux)", () => {
    expect(
      defaultRouteIface(() => {
        throw new Error("ENOENT");
      }),
    ).toBeUndefined();
  });

  it("is undefined when there is no default route", () => {
    const route = "Iface\tDestination\tGateway\tFlags\n" + "docker0\t000011AC\t00000000\t0001\n";
    expect(defaultRouteIface(() => route)).toBeUndefined();
  });

  it("ignores a 0.0.0.0/1 route (zero destination but non-zero mask), not just the destination", () => {
    // A VPN often installs 0.0.0.0/1 + 128.0.0.0/1 to override the default without replacing it; the
    // destination is zero but the mask is not, so it must NOT be taken for the real default route.
    const route =
      "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n" +
      "tun0\t00000000\t00000000\t0003\t0\t0\t0\t00000080\t0\t0\t0\n" +
      "eth0\t00000000\t0102A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0\n";
    expect(defaultRouteIface(() => route)).toBe("eth0");
  });

  it("picks the lowest-metric default route when several compete", () => {
    const route =
      "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n" +
      "wlan0\t00000000\t0102A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0\n" +
      "eth0\t00000000\t0102A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0\n";
    expect(defaultRouteIface(() => route)).toBe("eth0");
  });
});
