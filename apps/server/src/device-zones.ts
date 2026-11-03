import type { Transaction } from "@waitron/db";
import { canUseDeviceProfile } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import { assertDeviceStillProven, type DeviceBinding } from "./device-session.js";
import { assertStillSignedIn } from "./till-session.js";
import "./errors.js";

export async function currentZoneDevice(
  tx: Transaction,
  session: { deviceId: string; sessionId: string; personId: string; device: DeviceBinding },
): Promise<DeviceBinding> {
  await assertStillSignedIn(tx, session);
  const current = await assertDeviceStillProven(tx, { device: session.device, tokenHash: null });
  if (!(await canUseDeviceProfile(tx, current.deviceProfileId, session.personId))) {
    throw new AppError("device_profile.not_admitted", {});
  }
  return current;
}
