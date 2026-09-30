import { css, html, type TemplateResult } from "lit";
import type { FloorChip, FloorChipTone } from "@waitron/ui";
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

export const signalChipStyles = css`
  .chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    padding: var(--wt-space-1) var(--wt-space-2);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-sm);
    background: var(--wt-color-surface-raised);
    color: var(--wt-color-text);
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-bold);
    overflow-wrap: anywhere;
  }

  .chip.tone-success {
    border-color: var(--wt-color-success);
  }

  .chip.tone-primary {
    border-color: var(--wt-color-primary);
  }

  .chip.tone-warning {
    border-color: var(--wt-color-warning);
  }

  .chip.tone-danger {
    border-color: var(--wt-color-danger);
  }

  .chip.tone-primary-filled {
    border-color: var(--wt-color-primary);
    background: var(--wt-color-primary);
    color: var(--wt-color-on-primary);
  }
`;

export function renderChips(chips: readonly FloorChip[]): TemplateResult[] {
  return chips.map(
    (chip) => html`<span class="chip tone-${chip.tone}" data-chip=${chip.key}>${chip.text}</span>`,
  );
}
