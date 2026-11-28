import { html, type TemplateResult } from "lit";
import { t } from "../i18n/t.js";

/** "Take the next (n of m)", the count kept on one line: "(2 de" over "3)" reads as
 * nonsense on a phone. The host styles `.nowrap`. */
export function nextShareLabel(n: number, m: number): TemplateResult {
  const fill = (text: string) => text.replace("{n}", String(n)).replace("{m}", String(m));
  // One inline box: the button lays its content out as flex items, so bare parts would sit in
  // columns side by side.
  return html`<span
    >${t("bill_pay.next_share")
      .split(/(\(\{n\}.*\{m\}\))/s)
      .map((part, index) =>
        index === 1
          ? html`<span class="nowrap" data-pay-next-count>${fill(part)}</span>`
          : fill(part),
      )}</span
  >`;
}
