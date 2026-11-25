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
  { id, available }: ProductAvailabilityChange,
): Product[] {
  return products.map((product) =>
    product.id === id
      ? { ...product, available }
      : product.variants.some((variant) => variant.id === id)
        ? {
            ...product,
            variants: product.variants.map((variant) =>
              variant.id === id ? { ...variant, available } : variant,
            ),
          }
        : product,
  );
}

export function keepAvailabilityFocus(table: ReactiveControllerHost & HTMLElement): void {
  let control: HTMLElement | undefined;
  let fromKeyboard = false;
  table.addController({
    hostUpdate() {
      const focused = table.shadowRoot?.activeElement;
      control =
        focused instanceof HTMLElement && focused.matches('wt-switch[part="availability-switch"]')
          ? focused
          : undefined;
      fromKeyboard = control?.shadowRoot?.activeElement?.matches(":focus-visible") ?? false;
    },
    hostUpdated() {
      // Moving a keyed row can blur its still-connected switch.
      if (control?.isConnected && !table.shadowRoot?.activeElement)
        control.focus({ preventScroll: !fromKeyboard });
    },
  });
}
