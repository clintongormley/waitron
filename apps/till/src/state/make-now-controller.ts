import type { ReactiveControllerHost } from "lit";
import type { MadeHereItem } from "../api/client.js";

export class MakeNowController {
  readonly #host: ReactiveControllerHost;
  #deviceId?: string;
  #items: MadeHereItem[] = [];

  constructor(host: ReactiveControllerHost) {
    this.#host = host;
  }

  get deviceId(): string | undefined {
    return this.#deviceId;
  }

  get items(): MadeHereItem[] {
    return this.#items;
  }

  selectDevice(deviceId: string | undefined): void {
    if (this.#deviceId === deviceId) return;
    this.#deviceId = deviceId;
    this.#replaceItems(deviceId === undefined ? [] : this.#read(deviceId));
  }

  #replaceItems(items: MadeHereItem[]): void {
    this.#items = items;
    this.#host.requestUpdate();
  }

  #key(deviceId: string): string {
    return `waitron.makeNow.${deviceId}`;
  }

  #save(deviceId: string, items: MadeHereItem[]): void {
    const key = this.#key(deviceId);
    try {
      if (items.length === 0) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(items));
    } catch {
      /* Site data may be blocked; the on-screen list remains in memory. */
    }
  }

  #read(deviceId: string): MadeHereItem[] {
    try {
      const stored = localStorage.getItem(this.#key(deviceId));
      const parsed: unknown = stored === null ? [] : JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      const textMap = (value: unknown): value is Record<string, string> =>
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        Object.values(value).every((part) => typeof part === "string");
      const optionSnapshot = (value: unknown): boolean =>
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        "listName" in value &&
        textMap(value.listName) &&
        "listCustomerName" in value &&
        (value.listCustomerName === null || textMap(value.listCustomerName)) &&
        "listKitchenName" in value &&
        (value.listKitchenName === null || typeof value.listKitchenName === "string") &&
        "labelName" in value &&
        textMap(value.labelName) &&
        "labelCustomerName" in value &&
        (value.labelCustomerName === null || textMap(value.labelCustomerName)) &&
        "labelKitchenName" in value &&
        (value.labelKitchenName === null || typeof value.labelKitchenName === "string");
      return parsed.filter(
        (item): item is MadeHereItem =>
          typeof item === "object" &&
          item !== null &&
          typeof item.lineId === "string" &&
          typeof item.name === "string" &&
          typeof item.quantity === "string" &&
          typeof item.soldInEach === "boolean" &&
          (item.unitName === null || textMap(item.unitName)) &&
          Array.isArray(item.optionSnapshots) &&
          item.optionSnapshots.every(optionSnapshot) &&
          Array.isArray(item.extras) &&
          item.extras.every(
            (extra: unknown) =>
              typeof extra === "object" &&
              extra !== null &&
              "name" in extra &&
              typeof extra.name === "string" &&
              "quantity" in extra &&
              typeof extra.quantity === "string" &&
              "unitName" in extra &&
              (extra.unitName === null || textMap(extra.unitName)) &&
              "soldInEach" in extra &&
              typeof extra.soldInEach === "boolean" &&
              "perDish" in extra &&
              typeof extra.perDish === "number",
          ) &&
          (item.note === null || typeof item.note === "string"),
      );
    } catch {
      return [];
    }
  }

  readonly receive = (items: MadeHereItem[], deviceId: string): void => {
    const visible = deviceId === this.#deviceId;
    const existing = visible ? this.#items : this.#read(deviceId);
    const seen = new Set(existing.map((item) => item.lineId));
    const added: MadeHereItem[] = [];
    for (const item of items) {
      if (seen.has(item.lineId)) continue;
      seen.add(item.lineId);
      added.push(item);
    }
    const updated = [...existing, ...added];
    if (visible) this.#replaceItems(updated);
    this.#save(deviceId, updated);
  };

  readonly dismiss = (): void => {
    this.#replaceItems([]);
    if (this.#deviceId !== undefined) this.#save(this.#deviceId, []);
  };
}
