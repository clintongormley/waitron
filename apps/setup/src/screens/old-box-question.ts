import { html, nothing, type TemplateResult } from "lit";

/** The error line when the question is shown and not yet answered. */
export const OLD_BOX_PROBLEM = "Confirm that the old server is switched off for good.";

function when(iso: string): TemplateResult {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return html`${iso}`;
  const local = at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
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
  onChange: (checked: boolean) => void;
}): TemplateResult | typeof nothing {
  if (opts.liveSince === undefined && !opts.liveUnknown) return nothing;
  return html`<p class="error" role="alert" data-test="live-warning">
      ${
        opts.liveSince !== undefined
          ? html`The old server wrote to its bucket at ${when(opts.liveSince)}.`
          : "Whether the old server is still writing to its bucket could not be checked."
      }
      If it is still running, two servers would sell from the same records, and that cannot be
      undone. Switch it off for good before you go on.
    </p>
    <label class="field">
      <input
        name="old-server-gone"
        type="checkbox"
        required
        data-test="old-box-gone"
        aria-invalid=${opts.invalid ? "true" : "false"}
        aria-describedby=${opts.invalid ? "old-box-gone-error" : nothing}
        .checked=${opts.checked}
        @change=${(e: Event) => opts.onChange((e.currentTarget as HTMLInputElement).checked)}
      />
      The old server is switched off for good.
    </label>
    ${opts.invalid ? html`<p class="error" id="old-box-gone-error">${OLD_BOX_PROBLEM}</p>` : nothing}`;
}
