import { css, html } from "lit";
import { pickLocale } from "@waitron/dashboard-kit";
import "@waitron/ui/src/components/wt-disclosure.js";
import { EXPORT_GUIDES, EXPORT_GUIDE_STRINGS, type ExportGuideKey } from "./export-guides.js";

function say(key: ExportGuideKey): string {
  return pickLocale(EXPORT_GUIDE_STRINGS[key]);
}

export const exportGuidesStyles = css`
  .export-guides {
    display: grid;
    gap: var(--wt-space-3);
  }
  .export-guides h3 {
    margin: 0;
    font-size: var(--wt-font-size-md);
  }
  .export-guides p,
  .export-guides ol {
    margin: 0;
  }
`;

/** The setup wizard's three certificate export guides, closed under one heading. Rendered in the
 * current locale; the host re-renders on a locale switch. */
export function exportGuidesView() {
  return html`<section aria-label=${say("cert_help.aria_label")}>
    <wt-disclosure heading=${say("cert_help.heading")}>
      <div class="export-guides">
        <p>${say("cert_help.intro")} ${say("cert_help.choose")}</p>
        <p>${say("cert_help.transfer")}</p>
        ${EXPORT_GUIDES.map(
          (guide) =>
            html`<div data-test="export-guide" data-guide=${guide.id}>
              <h3>${say(guide.title)}</h3>
              <ol>
                ${guide.steps.map((step) => html`<li>${say(step)}</li>`)}
              </ol>
              <a href=${guide.href} target="_blank" rel="noopener noreferrer"
                >${say("cert_help.fnmt_link")}</a
              >
            </div>`,
        )}
      </div>
    </wt-disclosure>
  </section>`;
}
