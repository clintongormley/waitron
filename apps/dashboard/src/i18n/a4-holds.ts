import type { PageTestPage } from "../api/client.js";
import type { StringKey } from "./strings.js";
import { t } from "./t.js";

const HOLD_REASON: Record<NonNullable<PageTestPage["hold"]>, StringKey> = {
  paper_out: "printers.test_page_hold_paper_out",
  paper_jam: "printers.test_page_hold_paper_jam",
  cover_open: "printers.test_page_hold_cover_open",
  tray_missing: "printers.test_page_hold_tray_missing",
  ink_or_toner_out: "printers.test_page_hold_ink_or_toner_out",
  output_full: "printers.test_page_hold_output_full",
  paused: "printers.test_page_hold_paused",
  stopped: "printers.test_page_hold_stopped",
};

/** What an office printer is holding a page for, in words; undefined for a code with no words. */
export function holdReason(hold: string): string | undefined {
  return Object.hasOwn(HOLD_REASON, hold)
    ? t(HOLD_REASON[hold as keyof typeof HOLD_REASON])
    : undefined;
}
