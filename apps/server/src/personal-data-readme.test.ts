import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { personalDataParts } from "@waitron/module";
import { PERSONAL_DATA_README_WORDS } from "./i18n/personal-data-readme.js";
import { personalDataReadme, type PersonalDataReadmeInput } from "./personal-data-readme.js";

const base: PersonalDataReadmeInput = {
  language: "en",
  venue: "Example Bar S.L.",
  person: "Marta López",
  date: "2026-10-05",
  privacyNoticeUrl: "https://examplebar.example/privacy",
  files: ["profile.json", "sign-in.json"],
};

const PROFILE_LINE =
  "- profile.json: your name, contact details, language, role and account status, and any device profile set to let you in or keep you out. Used to run the venue, contact you and decide what you may do.";
const SIGN_IN_LINE =
  "- sign-in.json: how you sign in: whether you have a PIN, a password, an authenticator app or a Google login (never the secrets themselves), your passkeys, how many recovery codes you have, your sign-ins, the account emails issued to you and any setup you started but did not finish. Used to keep your account secure.";
const MACHINE = "The .json files are a machine-readable copy you can take to another service.";
const ORIGIN = `Where it came from
You or the venue's managers entered your details, or they were imported when the box was set up; the rest was recorded automatically as you used Waitron.`;
const BACKUP =
  "- If the venue has set up backups, they hold a copy of the whole database, this data included, wherever the venue keeps them.";
const CONFIG_EXPORT =
  "- A manager or admin can download a configuration export that holds your name, contact details, language, role and account status, and any device profile set to let you in or keep you out, including after you leave; they protect it with a passphrase they choose.";
const EMAIL =
  "- Account emails (invitations, password resets and email-change codes) are sent through the email service the venue set up, when it has one.";
const GOOGLE =
  "- If you link a Google login, the box asks Google to confirm who you are each time you link or use it, and keeps Google's identifier for your account; this file says only whether one is linked.";
const PROFILE_KEPT =
  "- Your profile stays on the box after your account is disabled: nothing in the box deletes it.";
const DISABLE_KEPT =
  "- When your account is disabled, your PIN, password, passkeys, authenticator app, recovery codes and Google login are deleted from the box.";
const SESSIONS_KEPT = "- Your sign-in sessions stay on the box after they end.";
const CLEANUP_KEPT =
  "- The record of an account email that was used or has expired is deleted when another of the same kind is issued to you; an unfinished Google link is deleted the next time anyone starts a Google sign-in after it has expired.";
const DECIDES = "- Ask the venue how long it keeps your data and why; its privacy notice may say.";
const RIGHTS = `Your rights
You may ask the venue to correct or delete your data, to limit its use, or to give you another copy in a form you can take to another service, and you may object to its use. It must answer within one month; if it needs longer, up to two more months, it must tell you so, and why, within that first month. You may also complain to a data-protection authority.`;
const HEAD = `Your data held by Example Bar S.L.
Prepared for Marta López on 2026-10-05.`;
const ASK =
  "Contact Example Bar S.L. to ask. Its privacy notice: https://examplebar.example/privacy";

describe("personalDataReadme", () => {
  it("writes every section in English", () => {
    expect(personalDataReadme(base)).toBe(`${HEAD}

What each file holds
${PROFILE_LINE}
${SIGN_IN_LINE}
${MACHINE}

${ORIGIN}

Who else receives it
${BACKUP}
${CONFIG_EXPORT}
${EMAIL}
${GOOGLE}

How long it is kept
${PROFILE_KEPT}
${DISABLE_KEPT}
${SESSIONS_KEPT}
${CLEANUP_KEPT}
${DECIDES}

${RIGHTS}
${ASK}
`);
  });

  it("writes every section in Spanish from the Spanish words", () => {
    const w = PERSONAL_DATA_README_WORDS.es;
    const profile = w.files["profile.json"]!;
    const signIn = w.files["sign-in.json"]!;
    const venue = "Example Bar S.L.";
    const lines = [
      w.title.replace("{venue}", () => venue),
      w.prepared.replace("{name}", () => "Marta López").replace("{date}", () => "2026-10-05"),
      "",
      w.filesHeading,
      `- profile.json: ${profile.holds} ${profile.use}`,
      `- sign-in.json: ${signIn.holds} ${signIn.use}`,
      w.machineReadable,
      "",
      w.originHeading,
      w.origin,
      "",
      w.sentToHeading,
      `- ${w.backup}`,
      ...[...(profile.sentTo ?? []), ...(signIn.sentTo ?? [])].map((s) => `- ${s}`),
      "",
      w.keptHeading,
      ...[...(profile.kept ?? []), ...(signIn.kept ?? [])].map((s) => `- ${s}`),
      `- ${w.decides}`,
      "",
      w.rightsHeading,
      w.rights,
      `${w.ask.replace("{venue}", () => venue)} ${w.notice.replace("{url}", () => "https://examplebar.example/privacy")}`,
    ];
    expect(profile.sentTo).toHaveLength(1);
    expect(signIn.sentTo).toHaveLength(2);
    expect(profile.kept).toHaveLength(1);
    expect(signIn.kept).toHaveLength(3);
    expect(personalDataReadme({ ...base, language: "es" })).toBe(`${lines.join("\n")}\n`);
  });

  it("never prints a double full stop after a legal name ending in one", () => {
    for (const language of ["en", "es"] as const) {
      const lines = personalDataReadme({ ...base, language }).split("\n");
      expect(
        lines.filter((line) => line.includes("..")),
        language,
      ).toEqual([]);
    }
  });

  it("leaves out the files block and every file's lines when there are no files", () => {
    expect(personalDataReadme({ ...base, files: [] })).toBe(`${HEAD}

${ORIGIN}

Who else receives it
${BACKUP}

How long it is kept
${DECIDES}

${RIGHTS}
${ASK}
`);
  });

  it("prints only the lines of the one file present", () => {
    expect(personalDataReadme({ ...base, files: ["profile.json"] })).toBe(`${HEAD}

What each file holds
${PROFILE_LINE}
${MACHINE}

${ORIGIN}

Who else receives it
${BACKUP}
${CONFIG_EXPORT}

How long it is kept
${PROFILE_KEPT}
${DECIDES}

${RIGHTS}
${ASK}
`);
  });

  it("names a file with no words alone", () => {
    expect(personalDataReadme({ ...base, files: ["profile.json", "extra.json"] })).toBe(`${HEAD}

What each file holds
${PROFILE_LINE}
- extra.json
${MACHINE}

${ORIGIN}

Who else receives it
${BACKUP}
${CONFIG_EXPORT}

How long it is kept
${PROFILE_KEPT}
${DECIDES}

${RIGHTS}
${ASK}
`);
  });

  it("prints no machine-readable line when no file ends .json", () => {
    expect(personalDataReadme({ ...base, files: ["notes.csv"] })).toBe(`${HEAD}

What each file holds
- notes.csv

${ORIGIN}

Who else receives it
${BACKUP}

How long it is kept
${DECIDES}

${RIGHTS}
${ASK}
`);
  });

  it("treats a file named after an inherited object key as a file with no words", () => {
    expect(personalDataReadme({ ...base, files: ["constructor"] })).toBe(`${HEAD}

What each file holds
- constructor

${ORIGIN}

Who else receives it
${BACKUP}

How long it is kept
${DECIDES}

${RIGHTS}
${ASK}
`);
  });

  it("names the venue generically and ends at the ask line with no name and no notice", () => {
    const { privacyNoticeUrl: _omitted, ...rest } = base;
    void _omitted;
    const text = personalDataReadme({ ...rest, venue: null, files: [] });
    expect(text).toBe(`Your data held by the venue
Prepared for Marta López on 2026-10-05.

${ORIGIN}

Who else receives it
${BACKUP}

How long it is kept
${DECIDES}

${RIGHTS}
Contact the venue to ask.
`);
  });

  it("puts the venue and person in literally, replacement patterns included", () => {
    const text = personalDataReadme({ ...base, venue: "$& Bar", person: "$1 Ana", files: [] });
    expect(text).toBe(`Your data held by $& Bar
Prepared for $1 Ana on 2026-10-05.

${ORIGIN}

Who else receives it
${BACKUP}

How long it is kept
${DECIDES}

${RIGHTS}
Contact $& Bar to ask. Its privacy notice: https://examplebar.example/privacy
`);
  });

  // Weaker than its name: it sees module parts only, not a file the server adds itself.
  it("has words in both languages for every module file", () => {
    const names = personalDataParts(ALL_MODULES).flatMap((p) => p.part.files);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(PERSONAL_DATA_README_WORDS.en.files[name], `en ${name}`).toBeDefined();
      expect(PERSONAL_DATA_README_WORDS.es.files[name], `es ${name}`).toBeDefined();
    }
    const en = PERSONAL_DATA_README_WORDS.en.files;
    const es = PERSONAL_DATA_README_WORDS.es.files;
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const name of Object.keys(en)) {
      expect(es[name]?.sentTo?.length ?? 0, `${name} sentTo`).toBe(en[name]?.sentTo?.length ?? 0);
      expect(es[name]?.kept?.length ?? 0, `${name} kept`).toBe(en[name]?.kept?.length ?? 0);
    }
  });
});
