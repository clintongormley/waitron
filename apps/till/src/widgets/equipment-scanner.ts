import type { PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { WtQrScanner } from "@waitron/ui";
import { parseEquipmentCode, type EquipmentKind } from "@waitron/shared";
import { t } from "../i18n/t.js";

type Message = "scan_not_ours" | "scan_not_printer" | "scan_not_reader";

/** How long a sticker must be out of view before `keep-going` sends it again. */
const RESEND_AFTER_MS = 2_000;

/**
 * Reads equipment labels until one of `kind` (either, for `"any"`) is seen, then stops the camera
 * and emits `equipment-scanned` with its id and kind. Anything else is said and scanning goes on.
 * With `keep-going` the camera stays on for the next label.
 * A subclass rather than a wrapper, so the video and message stay in this element's own shadow
 * root, where the dialogs' tests reach them.
 */
@customElement("till-equipment-scanner")
export class TillEquipmentScanner extends WtQrScanner {
  @property() kind: EquipmentKind | "any" = "printer";
  @property({ type: Boolean, attribute: "keep-going" }) keepGoing = false;
  @state() private code: Message | null = null;
  /** When each accepted label was last read, so one held in view is sent once. */
  #lastSeen = new Map<string, number>();

  protected override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    this.label = t("equipment.camera_label");
    this.hint = t("equipment.scan_hint");
    this.unavailable = t("equipment.camera_unavailable");
    this.message = this.code === null ? "" : t(`equipment.${this.code}`);
  }

  protected override onRead(text: string): void {
    const code = parseEquipmentCode(text);
    if (code === null) {
      this.code = "scan_not_ours";
    } else if (this.kind !== "any" && code.kind !== this.kind) {
      this.code = this.kind === "printer" ? "scan_not_printer" : "scan_not_reader";
    } else {
      this.code = null;
      if (this.keepGoing) {
        const now = performance.now();
        const seen = this.#lastSeen.get(text);
        this.#lastSeen.set(text, now);
        if (seen !== undefined && now - seen < RESEND_AFTER_MS) return;
      } else {
        this.stop();
      }
      this.dispatchEvent(
        new CustomEvent<{ id: string; kind: EquipmentKind }>("equipment-scanned", {
          detail: { id: code.id, kind: code.kind },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-equipment-scanner": TillEquipmentScanner;
  }
}
