import { it, expect } from "vitest";
import { buildReachInfo } from "./box-reach.js";

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
