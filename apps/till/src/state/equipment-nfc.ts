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
  #Reader?: new () => NfcReader;

  constructor(
    private readonly onCode: (code: EquipmentCode | null) => void,
    private readonly onReadError: () => void,
    private readonly onUnavailable: () => void,
    private readonly onPermission: (state: PermissionState | null) => void,
  ) {}

  async start(): Promise<void> {
    if (this.#lifetime !== undefined) return;
    const Reader = (window as Window & { NDEFReader?: new () => NfcReader }).NDEFReader;
    if (Reader === undefined) {
      this.onPermission(null);
      return;
    }
    const lifetime = new AbortController();
    this.#lifetime = lifetime;
    this.#Reader = Reader;
    let permission: PermissionStatus;
    try {
      permission = await navigator.permissions.query({ name: "nfc" as PermissionName });
    } catch {
      return;
    }
    if (lifetime.signal.aborted) return;
    const update = () => {
      this.onPermission(permission.state);
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

  /** Called from a click while the permission is "prompt": `scan()` runs before this returns, so
   * the browser's prompt belongs to the click, and the later grant finds this scan already live. */
  requestScan(): Promise<void> {
    if (this.#lifetime === undefined || this.#Reader === undefined || this.#scan !== undefined)
      return Promise.resolve();
    const scan = new AbortController();
    this.#scan = scan;
    return this.#listen(this.#Reader, scan);
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
    } catch (error) {
      if (this.#scan !== scan) return;
      scan.abort();
      this.#scan = undefined;
      if ((error as { name?: string } | null)?.name === "NotAllowedError")
        this.onPermission("denied");
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
