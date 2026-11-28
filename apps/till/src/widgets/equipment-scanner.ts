import type { PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { WtQrScanner } from "@waitron/ui";
import { parseEquipmentCode, type EquipmentKind } from "@waitron/shared";
import { t } from "../i18n/t.js";

type Message = "scan_not_ours" | "scan_not_printer" | "scan_not_reader";

/** How long frames without a sticker must be read before `keep-going` sends it again. */
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
  /**
   * Each accepted label still taken as in view, with when frames without it began, or `null`
   * while it is read. Only a frame read without it counts towards its absence, so a stall in the
   * frame loop sends nothing again.
   */
  #inView = new Map<string, number | null>();

  protected override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    this.label = t("equipment.camera_label");
    this.hint = t("equipment.scan_hint");
    this.unavailable = t("equipment.camera_unavailable");
    this.message = this.code === null ? "" : t(`equipment.${this.code}`);
  }

  protected override onFrame(text: string | null): void {
    const held = text !== null && this.#inView.has(text);
    if (this.keepGoing) this.#noteFrame(text);
    if (text === null) return;
    const code = parseEquipmentCode(text);
    if (code === null) {
      this.code = "scan_not_ours";
    } else if (this.kind !== "any" && code.kind !== this.kind) {
      this.code = this.kind === "printer" ? "scan_not_printer" : "scan_not_reader";
    } else {
      this.code = null;
      if (held) return;
      if (this.keepGoing) this.#inView.set(text, null);
      else this.stop();
      this.dispatchEvent(
        new CustomEvent<{ id: string; kind: EquipmentKind }>("equipment-scanned", {
          detail: { id: code.id, kind: code.kind },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  #noteFrame(text: string | null): void {
    const now = performance.now();
    for (const [label, missingSince] of this.#inView) {
      if (label === text) this.#inView.set(label, null);
      else if (missingSince === null) this.#inView.set(label, now);
      else if (now - missingSince >= RESEND_AFTER_MS) this.#inView.delete(label);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-equipment-scanner": TillEquipmentScanner;
  }
}
