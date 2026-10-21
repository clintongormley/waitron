import { css } from "lit";
import { floorChipStyles, type FloorChip, type FloorChipTone } from "@waitron/ui";
import type { TableSignal } from "@waitron/shared";
import { countText, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { minutesToFire } from "../state/release-reminder.js";
import type { TableStateKind } from "../state/table-precedence.js";

type WaitBand = Extract<TableSignal, { kind: "long_wait" }>["band"];

const WAIT_WORDS: Record<WaitBand, { words: StringKey; tone: FloorChipTone }> = {
  warm: { words: "signal.wait_warm", tone: "warning" },
  overdue: { words: "signal.wait_overdue", tone: "danger" },
  forgotten: { words: "signal.wait_forgotten", tone: "danger" },
};

/**
 * The chips for the signals no other mark already shows. An unsent draft, a group due to fire and a
 * table needing clearing each have a mark of their own on the floor, and the list card and the
 * unplaced token draw held dishes with `heldChip`, so none of them gives a chip here; nor does a
 * forgotten wait where `forgottenShown` says the caller shows its own Forgotten badge.
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
          icon: "floor-ready",
        }));
      case "long_wait": {
        if (signal.band === "forgotten" && forgottenShown) return [];
        const { words, tone } = WAIT_WORDS[signal.band];
        return [{ key: "long-wait", text: t(words), tone, icon: "floor-timer" }];
      }
      case "held_unavailable":
        return [
          {
            key: "held-unavailable",
            text: t("signal.unavailable").replace("{items}", () => signal.lineNames.join(", ")),
            tone: "danger",
            icon: "floor-out",
          },
        ];
      case "bill_requested":
        return [
          {
            key: "bill-requested",
            text: t("signal.bill_requested"),
            tone: "primary-filled",
            icon: "floor-bill",
          },
        ];
      case "unsent_draft":
      case "held":
      case "release_due":
      case "needs_clearing":
        return [];
    }
  });
}

/**
 * The held dishes' chip, counting down to `dueAt` when it is finite. None once `dueAt` has passed,
 * when the Time to fire mark shows instead.
 */
export function heldChip(
  signals: readonly TableSignal[],
  dueAt: number,
  now: number,
): FloorChip | null {
  const held = signals.find((signal) => signal.kind === "held");
  if (held === undefined || dueAt <= now) return null;
  const text =
    dueAt === Number.POSITIVE_INFINITY
      ? countText(held.count, "floor.held", "floor.held_one")
      : countText(held.count, "floor.held_fire_in", "floor.held_fire_in_one").replace(
          "{m}",
          String(minutesToFire(dueAt, now)),
        );
  return { key: "held", text, tone: "muted", icon: "floor-held" };
}

/** The table state a chip from `signalChips` or `heldChip` shows; `undefined` for any other key. */
export function chipState(
  chip: FloorChip,
  signals: readonly TableSignal[],
): TableStateKind | undefined {
  switch (chip.key) {
    case "long-wait": {
      const band = signals.find((signal) => signal.kind === "long_wait")?.band;
      return band === "warm" ? "waiting" : band;
    }
    case "held-unavailable":
      return "unavailable";
    case "bill-requested":
      return "bill";
    case "ready":
      return "ready";
    case "take-order":
      return "step";
    case "held":
      return "held";
    default:
      return undefined;
  }
}

export const signalChipStyles = [
  floorChipStyles,
  css`
    .chip[data-chip="bill-requested"] {
      border-color: var(--wt-color-table-bill);
      background: var(--wt-color-table-bill);
      color: var(--wt-color-on-table-bill);
    }

    .chip {
      max-width: 100%;
      overflow-wrap: anywhere;
    }
  `,
];
