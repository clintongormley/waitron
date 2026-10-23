import type { StaffNotice } from "../api/client.js";
import { clockTime, countText, t } from "./t.js";

const TELL_MANAGER = "staff_notice.tell_manager";

const UNKNOWN = { main: "staff_notice.unknown", hint: TELL_MANAGER } as const;

const FIXED = {
  "storage.disk_full": "staff_notice.storage.disk_full",
  "clock.unusable": "staff_notice.clock.unusable",
  "clock.behind_chain": "staff_notice.clock.behind_chain",
  "storage.space_low": "staff_notice.storage.space_low",
} as const;

function unknownText(): { main: string; hint: string } {
  return { main: t(UNKNOWN.main), hint: t(UNKNOWN.hint) };
}

/** A notice's words in the till's current language: its main words and the hint after " · ". A
 * code the till has no words for, or params it cannot word, is worded as unknown. */
export function staffNoticeText(notice: Pick<StaffNotice, "code" | "params">): {
  main: string;
  hint: string;
} {
  if (Object.hasOwn(FIXED, notice.code)) {
    return { main: t(FIXED[notice.code as keyof typeof FIXED]), hint: t(TELL_MANAGER) };
  }
  if (notice.code === "printer.jobs_waiting") {
    const { printer, since } = notice.params;
    if (typeof printer !== "string" || printer === "") return unknownText();
    if (typeof since !== "string" || Number.isNaN(Date.parse(since))) return unknownText();
    // A function replacement keeps a name such as "$&" as it is written.
    return {
      main: t("staff_notice.printer.jobs_waiting").replace("{printer}", () => printer),
      hint: t("staff_notice.since").replace("{time}", () => clockTime(Date.parse(since))),
    };
  }
  if (notice.code === "fiscal.records_unsent") {
    const { count, held } = notice.params;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) return unknownText();
    return {
      main: countText(
        count,
        "staff_notice.fiscal.records_unsent",
        "staff_notice.fiscal.records_unsent_one",
      ),
      // A held record waits for a person to resolve its filing case, so it is not retried.
      hint: t(held === 0 ? "staff_notice.retried" : TELL_MANAGER),
    };
  }
  return unknownText();
}
