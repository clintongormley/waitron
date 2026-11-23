import { html, type TemplateResult } from "lit";
import "@waitron/ui/src/components/wt-relative-time.js";
import { currentLocale } from "../i18n/t.js";

const browserNow = (): Date => new Date();

/**
 * `sentence` with how long ago `at` was (or, for a deadline, how soon it comes) in place of its
 * `{time}`, in the session's language; the exact time shows on hover or tap, and it and (with
 * `calendar`) the weekday, time of day and date are read in `timeZone`, or in the browser's time zone when it is
 * empty. With `calendar`, a moment a day or more gone reads as its weekday and time, then as its date.
 */
export function relativeTime(
  sentence: string,
  at: string,
  {
    deadline = false,
    calendar = false,
    now = browserNow,
    timeZone = "",
  }: { deadline?: boolean; calendar?: boolean; now?: () => Date; timeZone?: string } = {},
): TemplateResult {
  const [before, after] = sentence.split("{time}");
  return html`${before}<wt-relative-time
      datetime=${at}
      locale=${currentLocale()}
      time-zone=${timeZone}
      ?future=${deadline}
      ?calendar=${calendar}
      .now=${now}
    ></wt-relative-time
    >${after}`;
}
