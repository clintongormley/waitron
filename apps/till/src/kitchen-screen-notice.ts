import { t } from "./i18n/t.js";
import type { KitchenScreenKind, ResolvedKitchenScreen } from "./api/client.js";

/** What a kitchen display shows in place of a queue. */
export type KitchenScreenNotice =
  { kind: "none" } | { kind: "unavailable"; screen: KitchenScreenKind };

/** The kind a kitchen display runs, or what it shows instead of a queue. */
export function kitchenDisplayScreen(
  screens: readonly ResolvedKitchenScreen[],
):
  | { kind: "station" }
  | { kind: "pass" }
  | { kind: "pass_monitor" }
  | { kind: "notice"; notice: KitchenScreenNotice } {
  const running = screens.find((screen) => screen.available);
  if (running !== undefined) return { kind: running.kind };
  const removed = screens[0];
  if (removed !== undefined)
    return { kind: "notice", notice: { kind: "unavailable", screen: removed.kind } };
  return { kind: "notice", notice: { kind: "none" } };
}

const SCREEN_NAME = {
  station: "kitchen_screen.station",
  pass: "kitchen_screen.pass",
  pass_monitor: "kitchen_screen.pass_monitor",
} as const;

export function kitchenScreenNoticeText(notice: KitchenScreenNotice): string {
  switch (notice.kind) {
    case "none":
      return t("kitchen_screen.none");
    case "unavailable":
      return t("kitchen_screen.unavailable").replace("{screen}", t(SCREEN_NAME[notice.screen]));
  }
}
