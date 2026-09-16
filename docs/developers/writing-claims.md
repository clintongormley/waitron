# Writing claims

This file holds the evidence behind the rules in the repository root `CLAUDE.md`, section 1
("Writing claims"). The rules themselves live there, because they apply to every change in every
area. Read this when you want to see what a rule cost, or when you are about to write a sentence
that says how some part of Waitron behaves.

## A sentence about another part of the system is checked by following the call chain to it

The failure is not a wrong fix. It is a right fix with a sentence beside it that describes more of
the system than the author looked at. Somebody opens one file, makes a correct change at that one
edge, and then writes a comment, a commit message or a review note that speaks for the whole path —
because from where they were sitting, the edge they had open looked like the only one.

It is easy to miss in review, because the code is right. A reviewer reads the diff, agrees with the
change, and the sentence rides along unchallenged. What catches it is following the call chain by
hand to the part being described, and looking for a second caller.

The branch that paid for it was `onboarding` (the setup wizard corrections, 2026-09-13). The same
shape reached review again and again there, written by different people, including the session
controller who was supposed to be watching for it. The instances:

1. **"The server does not bound the number of languages."** It does. `planVenue`
   (`packages/provisioning/src/venue-plan.ts`) refuses anything outside one or two invoice languages
   and throws `provisioning.invalid_locales`. The author had been reading the HTTP boundary, two
   packages away from the check.

2. **"The wire field is optional, so the command line's requests still validate."** The command line
   never reaches that parser. `packages/provisioning/src/cli.ts` calls the pure `planVenue` directly;
   only the web path goes through the request parsing in `apps/server/src/provision.ts`. The sentence
   described a route the subject of the sentence does not take.

3. **"Provisioning now trims whitespace."** True of the web boundary that had just been edited, and
   not yet true of the command line, which the author had not opened. Two new name flags were reaching
   the planner raw: neither trimmed, and neither read a blank as "not given", so
   `--admin-last-names ""` — how a script says "no last name" — arrived at the database as an empty
   string, where `persons_last_names_ck` (`packages/identity/src/schema/persons.ts`) refused it as a
   raw SQLSTATE instead of a refusal naming the flag. The same task's review caught it and a named
   sibling helper, `resolveWithoutPrompt`, closed it before the commit landed.

   **Do not go looking for the gap in `git log` — the commit was amended, so it is not there.** Read
   at `packages/provisioning/src/cli.ts` today, every path trims: `resolveOption`,
   `resolveWithoutPrompt` and `resolveLocales` alike, and flag trimming in general was fixed long
   before this branch. The two lines the claim was wrong about read
   `values["admin-first-names"] ?? null` and `values["admin-last-names"] ?? null`, and `??` falls
   back only on an absent value, never on an empty string. That version survives only in a local
   reflog, which expires — which is why it is written out here rather than pointed at.

4. **"PGlite cannot judge a privilege."** False, and this one came out of `CLAUDE.md` section 4
   itself, which said in as many words that PGlite does not enforce grants. Nobody had checked it;
   the branch reached for a Docker container on its authority, in a comment reasoning that a PGlite
   connection would prove nothing about the application role — true of the superuser connection the
   author had in mind, and not true of the same session once it assumes the role, which is the
   version that decided the test. The probe that settled it is under "Two targets" in
   [testing-guide.md](testing-guide.md); the rule is now corrected. A rule file is the worst place
   for this defect, because everyone downstream repeats it in good faith.

5. **"The same transaction, and therefore the same snapshot."** The second half does not follow from
   the first. The helper (`packages/db/src/tenancy.ts` — `withTenant` when this was written,
   `withTransaction` since the tenant column went on 2026-09-14) opens an ordinary transaction and
   sets no isolation level, so it runs at PostgreSQL's default of read committed, where every
   statement takes a fresh snapshot. Only a repeatable-read transaction gives you the one snapshot the sentence
   assumed.

The cheapest habit, and it would have caught nearly all of these: before writing a sentence that
names a part of the system you did not edit, open that part. If you cannot open it — because you do
not know where it is — that is the finding, and the sentence should say "I believe" until you do.
