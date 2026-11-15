import { html, nothing, svg, type TemplateResult } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import type { CustomBucket } from "./backup-destination-model.js";
import { t } from "../i18n/t.js";
type BucketField = keyof CustomBucket;

export interface BucketFieldRow {
  field: BucketField;
  name: string;
  labelKey: Parameters<typeof t>[0];
  requiredKey?: Parameters<typeof t>[0];
}

export const BUCKET_FIELDS: BucketFieldRow[] = [
  { field: "endpoint", name: "endpoint", labelKey: "stream.form.endpoint" },
  {
    field: "region",
    name: "region",
    labelKey: "stream.form.region",
    requiredKey: "stream.form.region_required",
  },
  {
    field: "bucket",
    name: "name",
    labelKey: "stream.form.bucket",
    requiredKey: "stream.form.bucket_required",
  },
  { field: "prefix", name: "prefix", labelKey: "stream.form.prefix" },
  {
    field: "accessKeyId",
    name: "access-key-id",
    labelKey: "stream.form.access_key_id",
    requiredKey: "stream.form.access_key_id_required",
  },
  {
    field: "secretAccessKey",
    name: "secret-access-key",
    labelKey: "stream.form.secret_access_key",
    requiredKey: "stream.form.secret_access_key_required",
  },
];

export function missingBucketField(
  values: CustomBucket,
  row: BucketFieldRow,
  secretRequired: boolean,
): boolean {
  return (
    (row.field === "secretAccessKey" ? secretRequired : row.requiredKey !== undefined) &&
    values[row.field].trim() === ""
  );
}

export function revealIcon(visible: boolean): TemplateResult {
  return html`<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4Z"></path>
    <circle cx="8" cy="8" r="2"></circle>
    ${visible ? svg`<path d="m2 2 12 12"></path>` : nothing}
  </svg>`;
}

export function renderBucketField(
  row: BucketFieldRow,
  options: {
    namePrefix: string;
    testPrefix?: string;
    toggleTest: string;
    value: string;
    error: string;
    required: boolean;
    visible: boolean;
    hint?: string;
    change: (value: string) => void;
    toggle: () => void;
    keydown?: (event: KeyboardEvent) => void;
  },
): TemplateResult {
  const secret = row.field === "secretAccessKey";
  const toggleLabel = t(options.visible ? "stream.form.hide_secret" : "stream.form.show_secret");
  return html`<wt-input
    name=${options.namePrefix + row.name}
    data-test=${ifDefined(options.testPrefix === undefined ? undefined : options.testPrefix + row.name)}
    label=${t(row.labelKey)}
    .required=${options.required}
    type=${secret && !options.visible ? "password" : "text"}
    autocomplete=${secret ? "new-password" : "off"}
    hint=${options.hint ?? ""}
    .value=${options.value}
    .error=${options.error}
    @keydown=${options.keydown}
    @wt-change=${(event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      options.change(event.detail.value);
    }}
    >${
      secret
        ? html`<wt-button
            slot="end"
            variant="ghost"
            class="secret-toggle"
            data-test=${options.toggleTest}
            aria-label=${toggleLabel}
            @click=${options.toggle}
            >${revealIcon(options.visible)}</wt-button
          >`
        : nothing
    }</wt-input
  >`;
}
