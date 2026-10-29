import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { decimal, deviceId, locationId, nodeId } from "@waitron/shared";
import type { OriginConfig, TradingContext } from "./trading-context.js";
import { requestCfg, storedDeviceOrigin } from "./request-config.js";
import { sendingCfg } from "./made-here.js";

function context(): TradingContext {
  return {
    nodeId: nodeId("7a2b8c63-4d2c-4e3b-8c9f-2a3b4c5d6e7f"),
    locationId: locationId("9c4d0e85-6f4e-4a5d-8e1b-4c5d6e7f8091"),
    locale: "ca-ES",
    invoiceLocales: ["ca-ES"],
    localeOverride: "ca-ES",
    tipsEnabled: true,
    simplifiedInvoiceLimit: decimal("400"),
    operationDescriptionRequired: true,
    operationDescriptionDefault: "Restaurant service",
    practiceMode: true,
    sendingDeviceId: "original-sender",
    madeHereSink: new Set(["original-line"]),
  };
}

describe("trading context", () => {
  it("preserves every constituent when a device starts a request", () => {
    const cfg = context();
    const device = deviceId("0f0e0d0c-0b0a-4908-8706-050403020100");
    expect(requestCfg(cfg, { deviceId: device })).toEqual({
      nodeId: "7a2b8c63-4d2c-4e3b-8c9f-2a3b4c5d6e7f",
      locationId: "9c4d0e85-6f4e-4a5d-8e1b-4c5d6e7f8091",
      locale: "ca-ES",
      invoiceLocales: ["ca-ES"],
      localeOverride: "ca-ES",
      tipsEnabled: true,
      simplifiedInvoiceLimit: decimal("400"),
      operationDescriptionRequired: true,
      operationDescriptionDefault: "Restaurant service",
      practiceMode: true,
      sendingDeviceId: "original-sender",
      madeHereSink: new Set(["original-line"]),
      origin: { source: "device", deviceId: device },
    });
    expect(cfg).not.toHaveProperty("origin");
  });

  it.each(["dashboard", "payment_check"] as const)(
    "keeps the %s origin through sending",
    async (source) => {
      const cfg: OriginConfig = { ...context(), origin: { source, deviceId: null } };
      let sent: OriginConfig | undefined;
      const app = new Hono();
      app.get("/", (c) => {
        sent = sendingCfg(cfg, c, { deviceId: "kitchen-sender" });
        return c.body(null, 204);
      });
      expect((await app.request("/")).status).toBe(204);
      expect(sent!.origin).toEqual({ source, deviceId: null });
      expect(sent).toEqual({ ...cfg, sendingDeviceId: "kitchen-sender", madeHereSink: new Set() });
    },
  );

  it("isolates two devices' origins and each request's made-here sink", async () => {
    const cfg = context();
    const before = context();
    const devices = [
      deviceId("0f0e0d0c-0b0a-4908-8706-050403020100"),
      deviceId("1f0e0d0c-0b0a-4908-8706-050403020100"),
    ];
    const requests: ReturnType<typeof requestCfg>[] = [];
    const sends: ReturnType<typeof requestCfg>[][] = [];
    const app = new Hono();
    app.get("/:index", (c) => {
      const id = devices[Number(c.req.param("index"))]!;
      const request = requestCfg(cfg, { deviceId: id });
      requests.push(request);
      const first = sendingCfg(request, c, { deviceId: id });
      first.madeHereSink!.add("line-" + requests.length);
      sends.push([first, sendingCfg(request, c, { deviceId: "other-sender" })]);
      return c.body(null, 204);
    });
    expect((await app.request("/0")).status).toBe(204);
    expect((await app.request("/1")).status).toBe(204);
    for (const [index, request] of requests.entries()) {
      expect(request).toEqual({
        ...before,
        origin: { source: "device", deviceId: devices[index] },
      });
      const [first, second] = sends[index]!;
      expect(first).toEqual({
        ...request,
        sendingDeviceId: devices[index],
        madeHereSink: new Set(["line-" + (index + 1)]),
      });
      expect(second).toEqual({ ...first, sendingDeviceId: "other-sender" });
      expect(second!.madeHereSink).toBe(first!.madeHereSink);
      expect(first!.madeHereSink).not.toBe(cfg.madeHereSink);
    }
    expect(sends[0]![0]!.madeHereSink).not.toBe(sends[1]![0]!.madeHereSink);
    expect(cfg).toEqual(before);
  });

  it.each(["dashboard", "payment_check"])(
    "refuses a stored %s origin for device recovery",
    (source) => {
      expect(() => storedDeviceOrigin({ source, deviceId: null })).toThrow(
        expect.objectContaining({ code: "origin.invalid" }),
      );
    },
  );

  it("recovers a stored device origin", () => {
    const id = "0f0e0d0c-0b0a-4908-8706-050403020100";
    expect(storedDeviceOrigin({ source: "device", deviceId: id })).toEqual({
      source: "device",
      deviceId: id,
    });
  });
});
