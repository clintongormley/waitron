import { applyTokens } from "./tokens/index.js";

/** The wrapper element of the most recent mount. Live binding — reassigned by mount(). */
export let host: HTMLElement;

const mounted: HTMLElement[] = [];

export async function mount(html: string): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  mounted.push(host);
  host.innerHTML = html;
  const el = host.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
  await el.updateComplete;
  return el;
}

/** Removes every host mounted since the last cleanup. Use as `afterEach(cleanup)`. */
export function cleanup(): void {
  for (const el of mounted.splice(0)) el.remove();
  // Reset the themed canvas that mountThemed() (a11y-helpers.ts) paints on <body>/<html>.
  document.body.style.background = "";
  document.documentElement.style.background = "";
}

/**
 * Mounts inside a shadow root, the only place `composed: true` is observable: from light DOM an event
 * reaches `document` by bubbling alone. Listen outside the shadow root, e.g. on `document`.
 */
export async function mountInShadowRoot(html: string): Promise<HTMLElement> {
  const wrapper = document.createElement("div");
  document.body.appendChild(wrapper);
  mounted.push(wrapper);
  const shadow = wrapper.attachShadow({ mode: "open" });
  shadow.innerHTML = html;
  const el = shadow.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
  await el.updateComplete;
  return el;
}
