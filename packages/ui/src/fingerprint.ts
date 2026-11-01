import { html, type TemplateResult } from "lit";

/**
 * A colon-separated value, such as a certificate fingerprint, drawn so a line may end only after a
 * colon: no byte pair is split, which matters for a value people compare by eye. The text is the
 * value's own.
 */
export function breakAfterColons(value: string): TemplateResult {
  return html`${value.split(":").map((part, index) => (index === 0 ? part : html`:<wbr />${part}`))}`;
}
