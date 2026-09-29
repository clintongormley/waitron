export type BluetoothUnavailableReason =
  "dbus_unreachable" | "bluez_not_answering" | "no_controller" | "failed";

export type BluetoothAvailability =
  { available: true } | { available: false; reason: BluetoothUnavailableReason; detail: string };

const DETAIL_LIMIT = 500;

/** Classifies a failed `bluetoothctl` listing by what bluetoothctl 5.82 was measured to print (see
 * bluetooth-availability.test.ts): libdbus's `connection != NULL` assertion when the system bus
 * refuses the container, and exit 1 once its `--timeout` passes with nothing answering for BlueZ. */
export function classifyBluetoothFailure(error: unknown): BluetoothAvailability {
  const message = error instanceof Error ? error.message : String(error);
  const detail = message.trim().slice(0, DETAIL_LIMIT);
  const code = (error as { code?: unknown } | null)?.code;
  const killed = (error as { killed?: unknown } | null)?.killed === true;
  let reason: BluetoothUnavailableReason;
  if (message.includes("connection != NULL")) reason = "dbus_unreachable";
  else if (message.includes("No default controller available")) reason = "no_controller";
  else if (code === 1 || killed) reason = "bluez_not_answering";
  else reason = "failed";
  return { available: false, reason, detail };
}

export function sameAvailability(a: BluetoothAvailability, b: BluetoothAvailability): boolean {
  if (a.available || b.available) return a.available === b.available;
  return a.reason === b.reason;
}
