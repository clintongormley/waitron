import { html, nothing, type TemplateResult } from "lit";
import { currentLocale, t } from "../i18n/t.js";

/** The error line when the question is shown and not yet answered, in the wizard's language. */
export function oldBoxProblem(): string {
  return t("old_box.problem");
}

/** @deprecated English only, so it cannot follow a language switch: call `oldBoxProblem()`. */
export const OLD_BOX_PROBLEM = t("old_box.problem", "en-GB");

function when(iso: string): TemplateResult {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return html`${iso}`;
  const local = at.toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "short" });
  return html`<time datetime=${iso}>${local}</time> (${iso})`;
}

/**
 * The server refused because the old server may still be writing to its bucket
 * (`restore.stream_source_live`, `liveSince`) or because that could not be checked
 * (`restore.stream_source_unchecked`, `liveUnknown`). Renders the explanation and the one checkbox
 * that lets the owner go on; nothing when neither is set. Rendered inside the calling screen's
 * shadow root, so that screen's `fieldStyles`/`errorStyles` apply.
 */
export function oldBoxQuestion(opts: {
  liveSince: string | undefined;
  liveUnknown: boolean;
  checked: boolean;
  /** The owner tried to go on without answering. */
  invalid: boolean;
  /** The server's refusal of the answer, shown under the checkbox. */
  refusal?: string;
  onChange: (checked: boolean) => void;
}): TemplateResult | typeof nothing {
  if (opts.liveSince === undefined && !opts.liveUnknown) return nothing;
  const error = opts.invalid ? oldBoxProblem() : opts.refusal;
  return html`<p class="error" role="alert" data-test="live-warning">
      ${
        opts.liveSince !== undefined
          ? html`${t("old_box.wrote_at")} ${when(opts.liveSince)}.`
          : t("old_box.unchecked")
      }
      ${t("old_box.consequence")}
    </p>
    <label class="field">
      <input
        name="old-server-gone"
        type="checkbox"
        required
        data-test="old-box-gone"
        aria-invalid=${error === undefined ? "false" : "true"}
        aria-describedby=${error === undefined ? nothing : "old-box-gone-error"}
        .checked=${opts.checked}
        @change=${(e: Event) => opts.onChange((e.currentTarget as HTMLInputElement).checked)}
      />
      ${t("old_box.gone")}
    </label>
    ${error === undefined ? nothing : html`<p class="error" id="old-box-gone-error">${error}</p>`}`;
}
