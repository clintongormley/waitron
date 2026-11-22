import { type TemplateResult, html, nothing } from "lit";

export function renderGroupError(
  test: string,
  error: string | null | undefined,
): TemplateResult | typeof nothing {
  return error
    ? html`<p class="field-error" id="${test}-error" data-test="${test}-error">${error}</p>`
    : nothing;
}

export function renderSwitchGroup(
  test: string,
  heading: string,
  error: string | undefined,
  switches: TemplateResult | TemplateResult[],
  hint?: { test: string; text: string },
): TemplateResult {
  const described = [hint ? `${test}-hint` : "", error ? `${test}-error` : ""]
    .filter((id) => id !== "")
    .join(" ");
  return html`<div
    class="field"
    role="group"
    aria-labelledby="${test}-heading"
    aria-describedby=${described === "" ? nothing : described}
    data-test=${test}
  >
    <span class="panel-subtitle" id="${test}-heading">${heading}</span>
    ${
      hint
        ? html`<p class="hint" id="${test}-hint" data-test=${hint.test}>${hint.text}</p>`
        : nothing
    }
    <div class="toggles">${switches}</div>
    ${renderGroupError(test, error)}
  </div>`;
}
