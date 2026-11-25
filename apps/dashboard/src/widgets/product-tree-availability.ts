import { html } from "lit";
import { live } from "lit/directives/live.js";
import "@waitron/ui/src/components/wt-switch.js";
import type { ReactiveControllerHost } from "lit";
import type { Product } from "../api/client.js";
import { t } from "../i18n/t.js";

export interface ProductAvailabilityChange {
  id: string;
  name: string;
  available: boolean;
}

export function productAvailabilitySwitch(
  item: ProductAvailabilityChange,
  pending: ReadonlyMap<string, boolean>,
  change: (value: ProductAvailabilityChange) => void,
) {
  return html`<wt-switch
    part="availability-switch"
    accessible-name=${`${t("editor.available")}: ${item.name}`}
    .checked=${live(pending.get(item.id) ?? item.available)}
    @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
      event.stopPropagation();
      const inFlight = pending.get(item.id);
      if (inFlight !== undefined) {
        (event.currentTarget as HTMLElementTagNameMap["wt-switch"]).checked = inFlight;
        return;
      }
      change({ id: item.id, name: item.name, available: event.detail.checked });
    }}
  ></wt-switch>`;
}

export function productsWithAvailability(
  products: Product[],
  productIds: readonly string[],
  available: boolean,
): Product[] {
  const ids = new Set(productIds);
  return products.map((product) =>
    ids.has(product.id)
      ? { ...product, available }
      : product.variants.some((variant) => ids.has(variant.id))
        ? {
            ...product,
            variants: product.variants.map((variant) =>
              ids.has(variant.id) ? { ...variant, available } : variant,
            ),
          }
        : product,
  );
}

export function keepAvailabilityFocus(table: ReactiveControllerHost & HTMLElement): void {
  let control: HTMLElement | undefined;
  let fromKeyboard = false;
  let index = 0;
  const switchSelector = 'wt-switch[part="availability-switch"]';
  const switches = (root: ShadowRoot) => [...root.querySelectorAll<HTMLElement>(switchSelector)];
  table.addController({
    hostUpdate() {
      const focused = table.shadowRoot?.activeElement;
      control =
        focused instanceof HTMLElement && focused.matches(switchSelector) ? focused : undefined;
      fromKeyboard = control?.shadowRoot?.activeElement?.matches(":focus-visible") ?? false;
      if (fromKeyboard && control) index = switches(table.shadowRoot!).indexOf(control);
    },
    hostUpdated() {
      // Moving a keyed row can blur its still-connected switch.
      const root = table.shadowRoot;
      if (!control || !root || root.activeElement) return;
      if (control.isConnected) control.focus({ preventScroll: !fromKeyboard });
      else if (fromKeyboard) {
        const remaining = switches(root);
        (
          remaining[Math.min(index, remaining.length - 1)] ??
          root.querySelector<HTMLElement>(".filters-trigger")
        )?.focus();
      }
    },
  });
}
