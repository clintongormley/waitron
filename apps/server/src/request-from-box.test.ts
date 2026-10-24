import type { networkInterfaces } from "node:os";
import { Hono } from "hono";
import { expect, it } from "vitest";
import {
  addressIsBox,
  requestAddress,
  requestFromBox,
  type RequestSourceDeps,
} from "./request-from-box.js";

const interfaces = (() => ({
  eth0: [
    { address: "192.168.10.20", family: "IPv4", internal: false },
    { address: "fe80::1", family: "IPv6", internal: false },
  ],
  docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
  lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
})) as unknown as typeof networkInterfaces;
const deps: RequestSourceDeps = { interfaces };

it.each([
  "127.0.0.1",
  "127.0.1.1",
  "::1",
  "::ffff:127.0.0.1",
  "192.168.10.20",
  "::ffff:192.168.10.20",
  "fe80::1%eth0",
  "172.17.0.1",
  undefined,
])("counts %s as the box itself", (address) => {
  expect(addressIsBox(address, deps)).toBe(true);
});

it.each(["192.168.10.31", "fe80::2", "::ffff:192.168.10.31", "fe80::2%eth0"])(
  "counts %s as another device",
  (address) => {
    expect(addressIsBox(address, deps)).toBe(false);
  },
);

async function sourceOf(env: unknown, sourceDeps: RequestSourceDeps = deps) {
  const app = new Hono();
  app.get("/", (c) => c.json({ onBox: requestFromBox(c, sourceDeps) }));
  return ((await (await app.request("/", {}, env)).json()) as { onBox: boolean }).onBox;
}

it("reads the connection's remote address", async () => {
  expect(await sourceOf({ incoming: { socket: { remoteAddress: "::ffff:192.168.10.20" } } })).toBe(
    true,
  );
  expect(await sourceOf({ incoming: { socket: { remoteAddress: "192.168.10.31" } } })).toBe(false);
});

it("takes a request with no connection to read as the box's own", async () => {
  expect(await sourceOf(undefined)).toBe(true);
});

it("reads the real interfaces by default", async () => {
  expect(addressIsBox("127.0.0.1")).toBe(true);
  expect(addressIsBox("192.0.2.200")).toBe(false);
  expect(await sourceOf({ incoming: { socket: { remoteAddress: "192.0.2.200" } } }, {})).toBe(
    false,
  );
});

async function addressOf(env: unknown) {
  const app = new Hono();
  app.get("/", (c) => c.json({ address: requestAddress(c) ?? null }));
  return ((await (await app.request("/", {}, env)).json()) as { address: string | null }).address;
}

it("gives an IPv4-mapped or scoped address the plain form the box check compares", async () => {
  const socket = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress } } });
  expect(await addressOf(socket("::ffff:192.168.10.31"))).toBe("192.168.10.31");
  expect(await addressOf(socket("192.168.10.31"))).toBe("192.168.10.31");
  expect(await addressOf(socket("fe80::2%eth0"))).toBe("fe80::2");
  expect(await sourceOf(socket("::ffff:192.168.10.20"))).toBe(true);
  expect(await sourceOf(socket("192.168.10.20"))).toBe(true);
});

it("gives no address for a request with no connection, or a socket with none", async () => {
  expect(await addressOf(undefined)).toBeNull();
  expect(await addressOf({ incoming: { socket: {} } })).toBeNull();
});
