import type { PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { WtQrScanner } from "@waitron/ui";
import { parseEquipmentCode, type EquipmentKind } from "@waitron/shared";
import { t } from "../i18n/t.js";

type Message = "scan_not_ours" | "scan_not_printer" | "scan_not_reader";

/**
 * Reads equipment labels until one of `kind` (either, for `"any"`) is seen, then stops the camera
 * and emits `equipment-scanned` with its id and kind. Anything else is said and scanning goes on.
 * A subclass rather than a wrapper, so the video and message stay in this element's own shadow
 * root, where the dialogs' tests reach them.
 */
@customElement("till-equipment-scanner")
export class TillEquipmentScanner extends WtQrScanner {
  @property() kind: EquipmentKind | "any" = "printer";
  @state() private code: Message | null = null;

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
      this.stop();
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
