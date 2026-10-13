import { vi } from "vitest";
import type { DeviceEquipment } from "../src/api/client.js";

export const PRINTER_ID = "a45f83b1-1111-4111-8111-111111111111";
export const READER_ID = "b45f83b1-2222-4222-8222-222222222222";
export const NFC_EQUIPMENT: DeviceEquipment = {
  roles: ["receipt", "payment_slip", "card_terminal", "cash_drawer"].map((role) => ({
    role: role as DeviceEquipment["roles"][number]["role"],
    selection: "default",
    chosenId: null,
    default: null,
    chosen: null,
    resolved: null,
    choices:
      role === "cash_drawer"
        ? []
        : [
            {
              id: role === "card_terminal" ? READER_ID : PRINTER_ID,
              name: role === "card_terminal" ? "Portable reader" : "Portable printer",
              portable: true,
              available: true,
              busy: false,
              heldBy: null,
            },
          ],
  })),
};

export class FakeNdefReader extends EventTarget {
  static instances: FakeNdefReader[] = [];
  static scanResult: () => Promise<void> = () => Promise.resolve();
  signal?: AbortSignal;
  scan(options: { signal: AbortSignal }): Promise<void> {
    this.signal = options.signal;
    return FakeNdefReader.scanResult();
  }
  constructor() {
    super();
    FakeNdefReader.instances.push(this);
  }
  read(text: string, recordType = "text", encoding = "utf-8"): void {
    const event = new Event("reading");
    Object.assign(event, {
      message: {
        records: [
          { recordType, encoding, data: new DataView(new TextEncoder().encode(text).buffer) },
        ],
      },
    });
    this.dispatchEvent(event);
  }
}

export function installNfc(state: PermissionState = "granted"): PermissionStatus {
  FakeNdefReader.instances = [];
  FakeNdefReader.scanResult = () => Promise.resolve();
  vi.stubGlobal("NDEFReader", FakeNdefReader);
  const status = Object.assign(new EventTarget(), { state }) as PermissionStatus;
  vi.spyOn(navigator.permissions, "query").mockResolvedValue(status);
  return status;
}
