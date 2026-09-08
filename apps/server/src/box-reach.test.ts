import { describe, it, expect } from "vitest";
import { buildReachInfo, parseBoxAddresses } from "./box-reach.js";

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
