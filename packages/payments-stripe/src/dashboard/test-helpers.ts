import { applyTokens } from "@waitron/ui";

// Mounts by ASSIGNING PROPERTIES, not markup: the widgets take `@property({ attribute: false })`
// objects that cannot travel through an attribute.

const mounted: HTMLElement[] = [];

export interface Mounted<T extends HTMLElement> {
  el: T;
  host: HTMLElement;
}

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

export function cleanupWidgets(): void {
  for (const host of mounted.splice(0)) host.remove();
}
