import { parseEquipmentCode } from "@waitron/shared";

export type EquipmentCode = NonNullable<ReturnType<typeof parseEquipmentCode>>;
interface NfcReading extends Event {
  message: { records: { recordType: string; encoding?: string; data: DataView }[] };
}
interface NfcReader extends EventTarget {
  scan(options: { signal: AbortSignal }): Promise<void>;
}

export class EquipmentNfc {
  #lifetime?: AbortController;
  #scan?: AbortController;

  constructor(
    private readonly onCode: (code: EquipmentCode | null) => void,
    private readonly onReadError: () => void,
    private readonly onUnavailable: () => void,
  ) {}

  async start(): Promise<void> {
    if (this.#lifetime !== undefined) return;
    const Reader = (window as Window & { NDEFReader?: new () => NfcReader }).NDEFReader;
    if (Reader === undefined) return;
    const lifetime = new AbortController();
    this.#lifetime = lifetime;
    let permission: PermissionStatus;
    try {
      permission = await navigator.permissions.query({ name: "nfc" as PermissionName });
    } catch {
      return;
    }
    if (lifetime.signal.aborted) return;
    const update = () => {
      if (permission.state !== "granted") {
        this.#scan?.abort();
        this.#scan = undefined;
      } else if (this.#scan === undefined) {
        const scan = new AbortController();
        this.#scan = scan;
        void this.#listen(Reader, scan);
      }
    };
    permission.addEventListener("change", update, { signal: lifetime.signal });
    update();
  }

  async #listen(Reader: new () => NfcReader, scan: AbortController): Promise<void> {
    try {
      const reader = new Reader();
      reader.addEventListener(
        "reading",
        (event) => {
          const codes = (event as NfcReading).message.records.flatMap((record) => {
            if (record.recordType !== "text") return [];
            try {
              const code = parseEquipmentCode(
                new TextDecoder(record.encoding || "utf-8", { fatal: true }).decode(record.data),
              );
              return code === null ? [] : [code];
            } catch {
              return [];
            }
          });
          this.onCode(codes.length === 1 ? codes[0]! : null);
        },
        { signal: scan.signal },
      );
      reader.addEventListener("readingerror", this.onReadError, { signal: scan.signal });
      await reader.scan({ signal: scan.signal });
    } catch {
      if (this.#scan !== scan) return;
      scan.abort();
      this.#scan = undefined;
      this.onUnavailable();
    }
  }

  stop(): void {
    this.#lifetime?.abort();
    this.#lifetime = undefined;
    this.#scan?.abort();
    this.#scan = undefined;
  }
}
