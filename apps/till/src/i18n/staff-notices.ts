import type { StaffNotice } from "../api/client.js";
import { clockTime, countText, t } from "./t.js";

const TELL_MANAGER = "staff_notice.tell_manager";
const SEE_BOX_STATUS = "staff_notice.see_box_status";

const UNKNOWN = { main: "staff_notice.unknown", hint: SEE_BOX_STATUS } as const;

const FIXED = {
  "clock.unusable": "staff_notice.clock.unusable",
  "storage.space_low": "staff_notice.storage.space_low",
  "clock.check_time": "staff_notice.clock.check_time",
} as const;

/** The causes of a wait the till words; any other is unknown. */
const WAIT_CAUSES = {
  start: "staff_notice.clock.unconfirmed",
  clock_jumped: "staff_notice.clock.unconfirmed_jumped",
  future_date_refused: "staff_notice.clock.unconfirmed_future_date",
} as const;

function unknownText(): { main: string; hint: string } {
  return { main: t(UNKNOWN.main), hint: t(UNKNOWN.hint) };
}

/** The clock stops a person at a till can lift with "Check the time" while the box offers it. */
const CHECKABLE: ReadonlySet<string> = new Set(["clock.unusable", "clock.unconfirmed"]);

/** Whether `notice` is a clock stop whose hint is "Check the time" while `checkTime` is set. */
export function checksTime(notice: Pick<StaffNotice, "code">, checkTime: boolean): boolean {
  return checkTime && CHECKABLE.has(notice.code);
}

/** A notice's words in the till's current language: its main words and the hint after " · ". A
 * code the till has no words for, or params it cannot word, is worded as unknown. */
export function staffNoticeText(
  notice: Pick<StaffNotice, "code" | "params">,
  checkTime = false,
): {
  main: string;
  hint: string;
} {
  if (notice.code === "print_job.drawer_expired") {
    return { main: t("staff_notice.print_job.drawer_expired"), hint: "" };
  }
  if (notice.code === "clock.device_wrong") {
    return {
      main: t("staff_notice.clock.device_wrong"),
      hint: t("staff_notice.correct_device_time"),
    };
  }
  if (notice.code === "storage.disk_full") {
    // Its "Tell a manager" is the owner's stated exception to never sending the person elsewhere: a
    // waiter at a stopped till has no step of their own (2026-10-28, A1127 Q4).
    return { main: t("staff_notice.storage.disk_full"), hint: t(TELL_MANAGER) };
  }
  if (Object.hasOwn(FIXED, notice.code)) {
    return {
      main: t(FIXED[notice.code as keyof typeof FIXED]),
      hint: t(checksTime(notice, checkTime) ? "staff_notice.check_time" : SEE_BOX_STATUS),
    };
  }
  if (notice.code === "clock.unconfirmed") {
    const { agreed, cause } = notice.params;
    if (agreed !== 0 && agreed !== 1) return unknownText();
    if (typeof cause !== "string" || !Object.hasOwn(WAIT_CAUSES, cause)) return unknownText();
    return {
      main: t(WAIT_CAUSES[cause as keyof typeof WAIT_CAUSES]).replace("{agreed}", String(agreed)),
      hint: t(checksTime(notice, checkTime) ? "staff_notice.check_time" : SEE_BOX_STATUS),
    };
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
  if (notice.code === "printer.ticket_failed") {
    const { printer } = notice.params;
    if (typeof printer !== "string" || printer === "") return unknownText();
    return {
      main: t("staff_notice.printer.ticket_failed").replace("{printer}", () => printer),
      hint: t("staff_notice.reprint"),
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
