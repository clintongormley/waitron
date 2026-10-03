import { AppError } from "./errors.js";
import { deviceId as brandDeviceId } from "./ids.js";
import type { DeviceId } from "./ids.js";

/**
 * Where a record came from. `device` names the device in `device_id`; every other source is a named
 * job with no device.
 */
export const SOURCES = [
  "device",
  "dashboard",
  "fiscal_filing",
  "payment_check",
  "kitchen_timer",
  "demo_seed",
  "readiness_test",
] as const;
export type Source = (typeof SOURCES)[number];

/** The sources a sale table accepts: a device, or the demo seed or readiness test without one. */
export const SALE_SOURCES = [
  "device",
  "demo_seed",
  "readiness_test",
] as const satisfies readonly Source[];
export type SaleSource = (typeof SALE_SOURCES)[number];

export type JobSource = Exclude<Source, "device">;
export type DeviceOrigin = { readonly source: "device"; readonly deviceId: DeviceId };
export type JobOrigin = { readonly source: JobSource; readonly deviceId: null };
export type Origin = DeviceOrigin | JobOrigin;
export type SaleOrigin =
  DeviceOrigin | { readonly source: "demo_seed" | "readiness_test"; readonly deviceId: null };

export const deviceOrigin = (id: string): DeviceOrigin => ({
  source: "device",
  deviceId: brandDeviceId(id),
});

export const jobOrigin = <S extends JobSource>(source: S): JobOrigin & { readonly source: S } => ({
  source,
  deviceId: null,
});

const isSource = (value: string): value is Source => (SOURCES as readonly string[]).includes(value);

export function readOrigin(source: string, deviceId: string | null): Origin {
  if (isSource(source)) {
    if (source === "device" && deviceId !== null) return deviceOrigin(deviceId);
    if (source !== "device" && deviceId === null) return jobOrigin(source);
  }
  throw new AppError("origin.invalid", { source, deviceId });
}

export function isSaleOrigin(origin: Origin): origin is SaleOrigin {
  return (SALE_SOURCES as readonly string[]).includes(origin.source);
}
