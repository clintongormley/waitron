import { AppError, deviceOrigin, readOrigin } from "@waitron/shared";
import type { DeviceOrigin, Origin } from "@waitron/shared";
import type { DeviceRequestConfig, TillConfig } from "./till-config.js";

/** The venue's configuration, recording as the given device. */
export function requestCfg(cfg: TillConfig, device: { deviceId: string }): DeviceRequestConfig {
  return { ...cfg, origin: deviceOrigin(device.deviceId) };
}

/**
 * The device a stored payment row was started on. Only a device starts a payment, so a stored job
 * source is refused `origin.invalid`, as `readOrigin` refuses an unpaired one.
 */
export function storedDeviceOrigin(row: { source: string; deviceId: string | null }): DeviceOrigin {
  const origin = readOrigin(row.source, row.deviceId);
  if (origin.source !== "device") {
    throw new AppError("origin.invalid", { source: row.source, deviceId: row.deviceId });
  }
  return origin;
}

/**
 * Who an alert about a stored payment row names: the caller's own origin, or `"stored"`, the device
 * the row was started on, for a manager acting on the row from the dashboard (spec §5).
 */
export type AlertOrigin = Origin | "stored";

export function alertOrigin(
  raisedBy: AlertOrigin,
  row: { source: string; deviceId: string | null },
): Origin {
  return raisedBy === "stored" ? storedDeviceOrigin(row) : raisedBy;
}
