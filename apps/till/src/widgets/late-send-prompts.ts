import { html, nothing } from "lit";
import type { StaffMember } from "../api/device-session-api.js";
import type { LateSend } from "../api/drafts-api.js";
import {
  closedZoneQuestionOf,
  refusedLines,
  type ClosedZoneQuestion,
  type EndedPeriod,
} from "../state/late-send.js";
import { currentLocale } from "../i18n/t.js";
import type { OrderLine } from "../state/working-order.js";
import { lineProductName, soldByTheUnit, unitName } from "./product-name.js";
import type { LateSendDish, LateSendPurpose } from "./late-send-dialog.js";
import type { ApproverRefusal, OverrideConfirmDetail } from "./supervisor-override-dialog.js";

export type LateSendChoice = "agree" | "remove" | "cancel";

export interface LateSendPrompt {
  dishes: readonly LateSendDish[];
  periodNames: readonly string[];
  purpose: LateSendPurpose;
  closedZone?: ClosedZoneQuestion;
  agree: () => void | Promise<void>;
  remove: () => void;
  cancel?: () => void;
}

export interface LateSendApprovalPrompt {
  authorizers: StaffMember[];
  error: ApproverRefusal | null;
  lateSend: LateSend;
  busy: boolean;
  /** The refusal goes to the app's error line if the waiter already dismissed this prompt. */
  dismissed: boolean;
  retry: (lateSend: LateSend) => Promise<void>;
}

export function lateSendPrompt(
  listed: readonly OrderLine[],
  periods: readonly EndedPeriod[],
  purpose: LateSendPurpose,
  retry: (lateSend: LateSend) => void | Promise<void>,
  remove: (listed: readonly OrderLine[]) => void,
): LateSendPrompt {
  const menuIds = [...new Set(periods.map((period) => period.menuId))];
  return {
    dishes: listed.map((line) => ({
      quantity: line.quantity,
      name: lineProductName(line.product),
      unitName: { [currentLocale()]: unitName(line.product) },
      soldInEach: soldByTheUnit(line.product),
      ...(purpose === "extras" && line.extras !== undefined
        ? {
            extras: line.extras.map((extra) =>
              extra.quantity > 1 ? `${extra.name} x${extra.quantity}` : extra.name,
            ),
          }
        : {}),
    })),
    periodNames: [...new Set(periods.map((period) => period.periodName))],
    purpose,
    agree: () => retry({ menuIds }),
    remove: () => remove(listed),
  };
}

export function showMarkedLateSend(
  show: (prompt: LateSendPrompt) => void,
  lines: readonly OrderLine[],
  carried: LateSend | undefined,
  purpose: "send" | "save",
  retry: (lateSend: LateSend) => Promise<void>,
  remove: (listed: readonly OrderLine[]) => void,
): boolean {
  const marked = lines.filter((line) => line.endedPeriod !== undefined);
  const periods = marked.map((line) => line.endedPeriod!);
  const confirmed = new Set(carried?.menuIds);
  if (periods.every((period) => confirmed.has(period.menuId))) return false;
  show(lateSendPrompt(marked, periods, purpose, retry, remove));
  return true;
}

export function closedZonePrompt(
  zone: ClosedZoneQuestion,
  lines: readonly OrderLine[],
  purpose: LateSendPurpose,
  retry: (lateSend?: LateSend) => void | Promise<void>,
  cancel?: () => void,
): LateSendPrompt {
  const late = zone.lateSend;
  return {
    ...lateSendPrompt(
      late === undefined ? [] : refusedLines(lines, late),
      late?.menus ?? [],
      purpose,
      (confirmed) => retry(late === undefined ? undefined : confirmed),
      () => undefined,
    ),
    closedZone: zone,
    cancel,
  };
}

export async function writeWithClosedZone<T>(
  write: (zoneId?: string) => Promise<T>,
  show: (prompt: LateSendPrompt) => void,
  current: () => boolean,
): Promise<T | undefined> {
  try {
    return await write();
  } catch (error) {
    const zone = closedZoneQuestionOf(error);
    if (zone === undefined) throw error;
    if (!current()) return;
    const agreed = await new Promise<boolean>((answer) =>
      show(
        closedZonePrompt(
          zone,
          [],
          "send",
          () => answer(true),
          () => answer(false),
        ),
      ),
    );
    if (agreed && current()) return write(zone.zoneId);
  }
}

export function renderLateSendPrompts(
  prompt: LateSendPrompt | null,
  approval: LateSendApprovalPrompt | null,
  actions: {
    close: (prompt: LateSendPrompt, action: LateSendChoice) => void;
    approve: (prompt: LateSendApprovalPrompt, detail: OverrideConfirmDetail) => void;
    cancelApproval: (prompt: LateSendApprovalPrompt) => void;
  },
) {
  return html`
    ${
      prompt === null
        ? nothing
        : html`<till-late-send-dialog
            .dishes=${prompt.dishes}
            .periodNames=${prompt.periodNames}
            .purpose=${prompt.purpose}
            .closedZone=${prompt.closedZone}
            @wt-late-send-agreed=${() => actions.close(prompt, "agree")}
            @wt-late-send-removed=${() => actions.close(prompt, "remove")}
            @wt-late-send-cancelled=${() => actions.close(prompt, "cancel")}
          ></till-late-send-dialog>`
    }
    ${
      approval === null
        ? nothing
        : html`<till-supervisor-override-dialog
            data-late-send-approval
            .authorizers=${approval.authorizers}
            .error=${approval.error}
            @override-confirm=${(event: CustomEvent<OverrideConfirmDetail>) => {
              event.stopPropagation();
              actions.approve(approval, event.detail);
            }}
            @override-cancel=${(event: Event) => {
              event.stopPropagation();
              actions.cancelApproval(approval);
            }}
          ></till-supervisor-override-dialog>`
    }
  `;
}
