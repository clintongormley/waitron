import type { ColourChoice } from "@waitron/ui";
import { STATION_COLOURS, type StationColour } from "@waitron/shared";
import { STATION_COLOUR_TOKENS } from "./station-colour-styles.js";
import { t } from "./strings.js";

export interface StationColourUser {
  id: string;
  name: string;
  colour: StationColour;
}

export function stationColourChoices(
  stations: readonly StationColourUser[],
  excludeId?: string,
): ColourChoice[] {
  return STATION_COLOURS.map((colour) => ({
    value: colour,
    label: t(`hours.colour.${colour}`),
    fill: STATION_COLOUR_TOKENS[colour].dot,
    usedBy: stations
      .filter((station) => station.id !== excludeId && station.colour === colour)
      .map((station) => station.name),
  }));
}
