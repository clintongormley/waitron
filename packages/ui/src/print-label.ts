import { ownSize } from "@waitron/ui-core/theme";
import { WAITRON_DEFAULTS } from "@waitron/ui-core/theme/waitron";
import { applyTokens } from "./tokens/index.js";

export interface EquipmentLabelContent {
  qr: string;
  code: string;
  name: string;
  /** A line under the code; a label with one prints its name above the QR. */
  note?: string;
}

/**
 * Prints the label alone, from a frame of its own: printing the page would print everything around
 * it. The name is set as text, never parsed as markup.
 */
export function printEquipmentLabel(
  label: EquipmentLabelContent,
  printFrame: (view: Window) => void = (view) => view.print(),
): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  applyTokens(frame);
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.addEventListener("load", () => {
    const view = frame.contentWindow!;
    const doc = frame.contentDocument!;
    for (const token of [
      "--wt-font-family",
      "--wt-font-size-md",
      "--wt-font-size-xl",
      "--wt-font-weight-bold",
    ])
      doc.documentElement.style.setProperty(
        token,
        token.startsWith("--wt-font-size-")
          ? `${ownSize(token.slice("--wt-font-size-".length) as "md" | "xl", WAITRON_DEFAULTS)}px`
          : WAITRON_DEFAULTS.structure[token]!,
      );
    const style = doc.createElement("style");
    style.textContent =
      "body{margin:0;font-family:var(--wt-font-family);font-size:var(--wt-font-size-md);text-align:center}" +
      "img{width:40mm;height:40mm}p{margin:2mm 0;overflow-wrap:anywhere}p:first-of-type{font-size:var(--wt-font-size-xl);font-weight:var(--wt-font-weight-bold)}";
    doc.head.append(style);
    const image = doc.createElement("img");
    image.src = label.qr;
    image.alt = "";
    const code = doc.createElement("p");
    code.textContent = label.code;
    const name = doc.createElement("p");
    name.textContent = label.name;
    if (label.note === undefined) doc.body.append(image, name, code);
    else {
      const note = doc.createElement("p");
      note.textContent = label.note;
      doc.body.append(name, image, code, note);
    }
    view.addEventListener("afterprint", () => frame.remove(), { once: true });
    image.decode().then(
      () => printFrame(view),
      () => frame.remove(),
    );
  });
  frame.srcdoc = "<!doctype html><title>Waitron</title>";
  document.body.append(frame);
}
