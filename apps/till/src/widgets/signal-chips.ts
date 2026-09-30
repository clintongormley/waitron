import { css } from "lit";
import { floorChipStyles, type FloorChip, type FloorChipTone } from "@waitron/ui";
import type { TableSignal } from "@waitron/shared";
import { countText, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

type WaitBand = Extract<TableSignal, { kind: "long_wait" }>["band"];

const WAIT_WORDS: Record<WaitBand, { words: StringKey; tone: FloorChipTone }> = {
  warm: { words: "signal.wait_warm", tone: "warning" },
  overdue: { words: "signal.wait_overdue", tone: "danger" },
  forgotten: { words: "signal.wait_forgotten", tone: "danger" },
};

/**
 * The chips for the signals no other mark already shows. An unsent draft, a group due to fire and a
 * table needing clearing each have a mark of their own on the floor, so they give no chip here; nor
 * does a forgotten wait where `forgottenShown` says the caller shows its own Forgotten badge.
 */
export function signalChips(
  signals: readonly TableSignal[],
  { forgottenShown = false }: { forgottenShown?: boolean } = {},
): FloorChip[] {
  return signals.flatMap((signal): FloorChip[] => {
    switch (signal.kind) {
      case "take_order":
        return [{ key: "take-order", text: t("signal.take_order"), tone: "primary" }];
      case "ready":
        return signal.byStation.map(({ stationName, count }) => ({
          key: "ready",
          text: countText(count, "signal.ready_at", "signal.ready_at_one").replace(
            "{station}",
            () => stationName,
          ),
          tone: "success",
        }));
      case "long_wait": {
        if (signal.band === "forgotten" && forgottenShown) return [];
        const { words, tone } = WAIT_WORDS[signal.band];
        return [{ key: "long-wait", text: t(words), tone }];
      }
      case "held_unavailable":
        return [
          {
            key: "held-unavailable",
            text: t("signal.unavailable").replace("{items}", () => signal.lineNames.join(", ")),
            tone: "danger",
          },
        ];
      case "bill_requested":
        return [
          { key: "bill-requested", text: t("signal.bill_requested"), tone: "primary-filled" },
        ];
      case "unsent_draft":
      case "release_due":
      case "needs_clearing":
        return [];
    }
  });
}

export const signalChipStyles = [
  floorChipStyles,
  css`
    .chip {
      max-width: 100%;
      overflow-wrap: anywhere;
    }
  `,
];
