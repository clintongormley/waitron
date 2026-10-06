import { describe, expect, it } from "vitest";
import { deviceId, locationId, nodeId, seriesId, decimal } from "@waitron/shared";
import { requestCfg } from "./request-config.js";
import type { TillConfig } from "./till-config.js";

describe("requestCfg", () => {
  it("runs the request as its session's device and keeps the rest of the configuration", () => {
    const cfg: TillConfig = {
      nodeId: nodeId("7a2b8c63-4d2c-4e3b-8c9f-2a3b4c5d6e7f"),
      seriesId: seriesId("8b3c9d74-5e3d-4f4c-9d0a-3b4c5d6e7f80"),
      locationId: locationId("9c4d0e85-6f4e-4a5d-8e1b-4c5d6e7f8091"),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      tipsEnabled: true,
      simplifiedInvoiceLimit: decimal("400"),
    };
    const device = deviceId("0f0e0d0c-0b0a-4908-8706-050403020100");
    expect(requestCfg(cfg, { deviceId: device })).toEqual({
      ...cfg,
      origin: { source: "device", deviceId: device },
    });
  });
});
