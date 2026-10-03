import { deviceOrigin } from "@waitron/shared";
import type { DeviceId } from "@waitron/shared";
import type { DeviceRequestConfig, TillConfig } from "./till-config.js";

/** The configuration a till-app request runs under: the venue's, as its session's device. */
export function requestCfg(cfg: TillConfig, session: { deviceId: DeviceId }): DeviceRequestConfig {
  return { ...cfg, origin: deviceOrigin(session.deviceId) };
}
