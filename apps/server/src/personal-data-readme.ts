import { PERSONAL_DATA_README } from "./i18n/personal-data-readme.js";

export interface PersonalDataReadmeInput {
  readonly language: "en" | "es";
  /** `tenants.legal_name`, or null when there is no tenant row. */
  readonly venue: string | null;
  /** The person's display name. */
  readonly person: string;
  /** YYYY-MM-DD, the venue's date. */
  readonly date: string;
  readonly privacyNoticeUrl?: string;
  /** The names in the ZIP, in ZIP order, README excluded. */
  readonly files: readonly string[];
}

/** A function replacement, so a `$&` or `$1` in a name is printed as typed. */
function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

export function personalDataReadme(input: PersonalDataReadmeInput): string {
  const w = PERSONAL_DATA_README[input.language];
  const venue = input.venue ?? w.unnamedVenue;
  const present = input.files.map((name) => ({
    name,
    words: Object.hasOwn(w.files, name) ? w.files[name] : undefined,
  }));
  const lines: string[] = [
    fill(w.title, { venue }),
    fill(w.prepared, { name: input.person, date: input.date }),
    "",
  ];
  if (present.length > 0) {
    lines.push(w.filesHeading);
    for (const { name, words } of present)
      lines.push(words === undefined ? `- ${name}` : `- ${name}: ${words.holds} ${words.use}`);
    if (present.some(({ name }) => name.endsWith(".json"))) lines.push(w.machineReadable);
    lines.push("");
  }
  lines.push(w.originHeading, w.origin, "");
  lines.push(w.sentToHeading, `- ${w.backup}`);
  for (const { words } of present) for (const s of words?.sentTo ?? []) lines.push(`- ${s}`);
  lines.push("", w.keptHeading);
  for (const { words } of present) for (const s of words?.kept ?? []) lines.push(`- ${s}`);
  lines.push(`- ${w.decides}`, "", w.rightsHeading, w.rights);
  const ask = fill(w.ask, { venue });
  lines.push(
    input.privacyNoticeUrl === undefined
      ? ask
      : `${ask} ${fill(w.notice, { url: input.privacyNoticeUrl })}`,
  );
  return `${lines.join("\n")}\n`;
}
