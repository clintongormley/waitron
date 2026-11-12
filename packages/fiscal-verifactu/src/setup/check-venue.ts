import { css, html } from "lit";

/** The Check this venue words the setup, restore and handover pages share. */
export const checkVenueStrings = {
  en: {
    checkHeading: "Check this venue",
    environment: "Environment",
    production: "Production",
    preproduction: "Preproduction",
    country: "Country",
    taxId: "Taxpayer NIF",
    zone: "Time zone",
    detailsCorrect: "These details are correct.",
    proceed: "Proceed",
    changeDetails: "Change these details",
    compareAgain: "Compare the clocks again",
    tryAgain: "Try again",
    failed: "Could not complete this step.",
    chosen: "We've created these series",
    blocked: "Box time precedes this Waitron release.",
    rangeBlocked:
      "Waitron cannot create invoice series for this date: it is outside the range the series codes cover.",
  },
  es: {
    checkHeading: "Comprueba este local",
    environment: "Entorno",
    production: "Producción",
    preproduction: "Preproducción",
    country: "País",
    taxId: "NIF del contribuyente",
    zone: "Zona horaria",
    detailsCorrect: "Estos datos son correctos.",
    proceed: "Continuar",
    changeDetails: "Cambiar estos datos",
    compareAgain: "Volver a comparar los relojes",
    tryAgain: "Volver a intentarlo",
    failed: "No se pudo completar este paso.",
    chosen: "Hemos creado estas series",
    blocked: "La hora del servidor es anterior a esta versión de Waitron.",
    rangeBlocked:
      "Waitron no puede crear series de facturas para esta fecha: está fuera del rango que cubren los códigos de serie.",
  },
} satisfies Record<"en" | "es", Record<string, string>>;

/** The rows of a `<dl class="details">` and the clock-choice buttons `ClockWait` draws. */
export const checkVenueStyles = css`
  dl.details {
    display: grid;
    gap: var(--wt-space-2);
    margin-block: var(--wt-space-3);
  }
  dl.details > div {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    column-gap: var(--wt-space-4);
    row-gap: var(--wt-space-1);
  }
  dl.details dt {
    color: var(--wt-color-text-muted);
  }
  dl.details dd {
    margin: 0;
    flex: 1 1 0;
    min-width: 50%;
    text-align: end;
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--wt-space-2);
  }
`;

/** One row of Check this venue: the label, then its value. */
export const detailRow = (label: string, value: unknown) =>
  html`<div>
    <dt>${label}</dt>
    <dd>${value}</dd>
  </div>`;

const regionNames = new Map<string, Intl.DisplayNames>();
/** A chosen backup can carry any country value, so one the browser cannot name is shown as stored. */
export function regionName(language: "en" | "es", region: string): string {
  try {
    let names = regionNames.get(language);
    if (!names) {
      names = new Intl.DisplayNames([language], { type: "region", fallback: "none" });
      regionNames.set(language, names);
    }
    return names.of(region) ?? region;
  } catch {
    return region;
  }
}

/**
 * Moves focus to a new screen's heading when focus is inside `root` or has fallen to nowhere, as
 * when the pressed button is gone; focus elsewhere on the page stays where it is.
 */
export function focusNewScreen(root: ShadowRoot, heading: HTMLElement | null): void {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if (root.activeElement !== null || active === null || active === document.body) heading?.focus();
}
