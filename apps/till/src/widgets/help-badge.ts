import { css, html, nothing, type TemplateResult } from "lit";
import { guideHref, type GuideLink } from "../help-guide.js";
import { helpBadgeLabel, helpText, type HelpKey } from "../i18n/help-strings.js";

/** A help-mode badge for the part named `part`, its box holding `key`'s text and, with `guide`, a link
 * to that guide section. */
export function helpBadge(
  key: HelpKey,
  part: string,
  options: { guide?: GuideLink; slot?: string } = {},
): TemplateResult {
  const { guide, slot } = options;
  return html`<wt-help-tooltip
    mode="help-mode"
    aria-label=${helpBadgeLabel(part)}
    slot=${slot ?? nothing}
    guide-href=${guide === undefined ? nothing : guideHref(guide)}
    guide-label=${guide === undefined ? nothing : helpText("help.guide_link")}
    >${helpText(key)}</wt-help-tooltip
  >`;
}

/** For a screen that wraps a part in `.help-anchor` to hang its badge from. */
export const helpAnchorStyles = css`
  .help-anchor {
    position: relative;
  }
`;
