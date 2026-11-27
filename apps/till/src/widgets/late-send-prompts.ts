import { html, nothing } from "lit";
import type { StaffMember } from "../api/device-session-api.js";
import type { LateSend } from "../api/drafts-api.js";
import type { EndedPeriod } from "../state/late-send.js";
import type { OrderLine } from "../state/working-order.js";
import { currentLocale } from "../i18n/t.js";
import type { LateSendDish, LateSendPurpose } from "./late-send-dialog.js";
import { lineProductName, soldByTheUnit, unitName } from "./product-name.js";
import type { ApproverRefusal, OverrideConfirmDetail } from "./supervisor-override-dialog.js";

/** The window asking whether the station agreed to dishes whose period ended: `retry` runs the
 * action again carrying the confirmation of `menuIds`, `remove` runs the secondary choice: it takes new
 * dishes out, abandons added extras, or leaves stored dishes unsent. */
export interface LateSendPrompt {
  dishes: readonly LateSendDish[];
  periodNames: readonly [string, ...string[]];
  menuIds: string[];
  purpose: LateSendPurpose;
  retry: (lateSend: LateSend) => Promise<void>;
  remove: () => void;
}

export interface LateSendApprovalPrompt {
  authorizers: StaffMember[];
  error: ApproverRefusal | null;
  lateSend: LateSend;
  busy: boolean;
  /** A PIN refusal goes to the app's error line if the waiter already dismissed this prompt. */
  dismissed: boolean;
  retry: (lateSend: LateSend) => Promise<void>;
}

export function lateSendPrompt(
  listed: readonly OrderLine[],
  periods: readonly [EndedPeriod, ...EndedPeriod[]],
  purpose: LateSendPurpose,
  retry: (lateSend: LateSend) => Promise<void>,
  remove: (listed: readonly OrderLine[]) => void,
): LateSendPrompt {
  const dishes = listed.map((line) => ({
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
  }));
  const first = periods[0].periodName;
  const rest = new Set(periods.map((period) => period.periodName));
  rest.delete(first);
  return {
    dishes,
    periodNames: [first, ...rest],
    menuIds: [...new Set(periods.map((period) => period.menuId))],
    purpose,
    retry,
    remove: () => remove(listed),
  };
}

export function renderLateSendPrompts(
  prompt: LateSendPrompt | null,
  approval: LateSendApprovalPrompt | null,
  actions: {
    agree: (prompt: LateSendPrompt) => void;
    remove: (prompt: LateSendPrompt) => void;
    cancel: () => void;
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
            @wt-late-send-agreed=${() => actions.agree(prompt)}
            @wt-late-send-removed=${() => actions.remove(prompt)}
            @wt-late-send-cancelled=${actions.cancel}
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
