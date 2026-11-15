import { html } from "lit";
import "@waitron/ui/src/components/wt-icon.js";
import { t } from "./strings.js";

export const stationIcon = () =>
  html`<wt-icon name="prep-station" role="img" aria-label=${t("opening.prep_station")}></wt-icon>`;
