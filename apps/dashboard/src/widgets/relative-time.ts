import { html, type TemplateResult } from "lit";
import "@waitron/ui/src/components/wt-relative-time.js";
import { currentLocale } from "../i18n/t.js";

const browserNow = (): Date => new Date();

/**
 * `sentence` with how long ago `at` was (or, for a deadline, how soon it comes) in place of its
 * `{time}`, in the session's language; the exact time shows on hover or tap.
 */
export function relativeTime(
  sentence: string,
  at: string,
  { deadline = false, now = browserNow }: { deadline?: boolean; now?: () => Date } = {},
): TemplateResult {
  const [before, after] = sentence.split("{time}");
  return html`${before}<wt-relative-time
      datetime=${at}
      locale=${currentLocale()}
      ?future=${deadline}
      .now=${now}
    ></wt-relative-time
    >${after}`;
}
