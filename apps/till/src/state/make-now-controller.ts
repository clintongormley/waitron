import type { ReactiveControllerHost } from "lit";
import type { MadeHereItem } from "../api/client.js";

export class MakeNowController {
  readonly #host: ReactiveControllerHost;
  readonly #deviceId: () => string | undefined;
  #items: MadeHereItem[] = [];

  constructor(host: ReactiveControllerHost, deviceId: () => string | undefined) {
    this.#host = host;
    this.#deviceId = deviceId;
  }

  get items(): MadeHereItem[] {
    return this.#items;
  }

  reset(): void {
    this.#replaceItems([]);
  }

  #replaceItems(items: MadeHereItem[]): void {
    this.#items = items;
    this.#host.requestUpdate();
  }

  #key(): string | null {
    const deviceId = this.#deviceId();
    return deviceId === undefined ? null : `waitron.makeNow.${deviceId}`;
  }

  #save(): void {
    const key = this.#key();
    if (key === null) return;
    try {
      if (this.#items.length === 0) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(this.#items));
    } catch {
      /* Site data may be blocked; the on-screen list remains in memory. */
    }
  }

  restore(): void {
    const key = this.#key();
    if (key === null) return;
    try {
      const stored = localStorage.getItem(key);
      const parsed: unknown = stored === null ? [] : JSON.parse(stored);
      if (!Array.isArray(parsed)) return;
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
      const items = parsed.filter(
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
      this.#replaceItems(items);
    } catch {
      /* A blocked or corrupt store leaves the in-memory list available. */
    }
  }

  readonly receive = (items: MadeHereItem[]): void => {
    const seen = new Set(this.#items.map((item) => item.lineId));
    const added: MadeHereItem[] = [];
    for (const item of items) {
      if (seen.has(item.lineId)) continue;
      seen.add(item.lineId);
      added.push(item);
    }
    this.#replaceItems([...this.#items, ...added]);
    this.#save();
  };

  readonly dismiss = (): void => {
    this.reset();
    this.#save();
  };
}
