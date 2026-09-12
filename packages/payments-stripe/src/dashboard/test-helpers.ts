import { applyTokens } from "@waitron/ui";

// Test support for the Stripe panel's Lit widgets. Mirrors the dashboard's own widget test-helper
// (mount by ASSIGNING PROPERTIES, not markup — every widget takes its data as
// `@property({ attribute: false })` objects that cannot travel through an attribute), trimmed to the
// mount/cleanup this package's two suites use (no axe pass — the a11y coverage stays with the app).

const mounted: HTMLElement[] = [];

/** The element under test plus the themed host it was mounted into. */
export interface Mounted<T extends HTMLElement> {
  el: T;
  host: HTMLElement;
}

/** Mounts a custom element `tag` with `props` assigned before connection, inside a fresh themed host,
 * and waits for its first render. */
export async function mountWidget<T extends HTMLElement>(
  tag: string,
  props: Partial<T>,
): Promise<Mounted<T>> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  applyTokens(host);
  mounted.push(host);

  const el = document.createElement(tag) as T;
  Object.assign(el, props);
  host.appendChild(el);
  await (el as T & { updateComplete: Promise<unknown> }).updateComplete;
  return { el, host };
}

/** Removes every host mounted since the last cleanup. Use as `afterEach(cleanupWidgets)`. */
export function cleanupWidgets(): void {
  for (const host of mounted.splice(0)) host.remove();
}
