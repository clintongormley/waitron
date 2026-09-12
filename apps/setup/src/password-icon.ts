import { html, nothing } from "lit";

export function passwordIcon(visible: boolean) {
  return html`<svg
    style="display:block;width:1.25em;height:1.25em;fill:none;stroke:currentColor"
    viewBox="0 0 16 16"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z"></path>
    <circle cx="8" cy="8" r="2"></circle>
    ${visible ? html`<path d="m2 2 12 12"></path>` : nothing}
  </svg>`;
}
