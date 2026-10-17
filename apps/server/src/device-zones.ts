import type { Transaction } from "@waitron/db";
import { canUseDeviceProfile } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { assertDeviceStillProven, type DeviceBinding } from "./device-session.js";
import { assertStillSignedIn } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

export async function currentZoneDevice(
  tx: Transaction,
  cfg: Pick<TillConfig, "locationId">,
  session: { deviceId: string; sessionId: string; personId: string; device: DeviceBinding },
): Promise<DeviceBinding> {
  await assertStillSignedIn(tx, session);
  const current = await assertDeviceStillProven(tx, { device: session.device, tokenHash: null });
  if (current.locationId !== cfg.locationId) throw new AppError("device.unauthorized", {});
  if (!(await canUseDeviceProfile(tx, current.deviceProfileId, session.personId))) {
    throw new AppError("device_profile.not_admitted", {});
  }
  return current;
}
