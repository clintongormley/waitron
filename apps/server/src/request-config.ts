import { AppError, deviceOrigin } from "@waitron/shared";
import type { DeviceId, DeviceOrigin } from "@waitron/shared";
import type { DeviceRequestConfig, TillConfig } from "./till-config.js";

/** The configuration a till-app request runs under: the venue's, as its session's device. */
export function requestCfg(cfg: TillConfig, session: { deviceId: DeviceId }): DeviceRequestConfig {
  return { ...cfg, origin: deviceOrigin(session.deviceId) };
}

/**
 * The device a stored payment row was started on. Only a device starts a payment, so any other
 * stored pair is refused `origin.invalid`; a source not yet written is reported as empty.
 */
export function storedDeviceOrigin(row: {
  source: string | null;
  deviceId: string | null;
}): DeviceOrigin {
  if (row.source === "device" && row.deviceId !== null) return deviceOrigin(row.deviceId);
  throw new AppError("origin.invalid", { source: row.source ?? "", deviceId: row.deviceId });
}
