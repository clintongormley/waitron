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
   not yet true of the command line, which the author had not opened. Two new name flags were
   reaching the planner raw: neither trimmed, and neither read a blank as "not given", so
   `--admin-last-names ""` — how a script says "no last name" — arrived at the database as an empty
   string, where `persons_last_names_ck` (`packages/identity/src/schema/persons.ts`) refused it as a
   raw database error instead of a refusal naming the flag. The same task's review caught it and a
   named sibling helper, `resolveWithoutPrompt`, closed it before the commit landed.

   **Do not go looking for the gap in `git log` — the commit was amended, so it is not there.** Read
   at `packages/provisioning/src/cli.ts` today, every path trims: `resolveOption`,
   `resolveWithoutPrompt` and `resolveLocales` alike, and flag trimming in general was fixed long
   before this branch. The two lines the claim was wrong about read
   `values["admin-first-names"] ?? null` and `values["admin-last-names"] ?? null`, and `??` falls
   back only on an absent value, never on an empty string. That version survives only in a local
   reflog, which expires — which is why it is written out here rather than pointed at.

4. **"The property initializers are gone."** A negative grep, reported as a defect, over the output of
   a toolchain that had just been swapped. Moving the front-ends from vite 6 to vite 8 replaced
   esbuild with Oxc; searching the new till bundle for `this.variant="secondary"` — the exact string
   the vite 6 bundle contained — returned nothing, and every decorated Lit property looked as though
   it had lost its default. Had that been true the break would have been silent and wide, though the
   failing version was never run, so treat the scale as reasoning rather than measurement. The
   initializers were there. Oxc prints string literals as TEMPLATE literals, so the same code reads
   ``this.variant=`secondary` `` and no double-quote search can find it.

   The durable part is not the backtick, which is a fact about one version of one printer. It is
   that **a negative grep over a tool's output is not evidence when the tool is what changed.** Both
   answers print nothing — "the construct is absent" and "the construct is spelled differently" —
   which is `CLAUDE.md` section 1's "a measurement taken where both answers look alike". The control
   costs one command: find a construct you KNOW is present in the new output, see how it is spelled,
   and only then conclude something is missing. Here that was searching for the identifier
   (`_t=class extends x{constructor`) rather than the quoted value.

5. **"The two versions parse this repository's XML identically."** Said after two probes that both
   looked thorough. Moving `fast-xml-parser` from 4.5.7 to 5.11.1 was checked first by replaying 217
   real AEAT documents — captured by wrapping `parser.parse` while the suites ran — through both
   versions under the four options `@waitron/verifactu`'s XML reader sets: byte-identical.
   The captured corpus is only what our own fixtures happen to contain, so 37 further cases were hand
   built from the changelog between the two versions, one per thing it said had changed. That set
   reported a single difference, and the sentence above was written.

   It was wrong. Version 5 had stopped decoding `&#38;`, `&#60;`, `&#62;`, `&#34;` and `&#39;` — the
   numeric character references for the five characters XML reserves — so an AEAT literal written
   that way arrived as its own source text on the path that matches an AEAT response to one of our
   records. The Codex run-it seat found it by parsing a document, not by reading.

   Why 37 hand-built cases missed it is the durable part. The set DID have a "numeric entity in
   leaf" case. Its representative was `Caf&#233;` — and **neither** version decodes that one, so the
   case printed the same thing on both sides whatever the answer was. That is `CLAUDE.md` section 1's
   "a measurement taken where both answers look alike", arriving through a different door: not a
   probe that cannot see, but a class whose chosen representative sits outside the part of the class
   that moved. **Enumerate a class from what the FORMAT allows, not from the first value that comes
   to mind.** XML has exactly five predefined character entities and they are handled by different
   code from every other code point; a case list that does not contain all five is not a case list
   for entities. The same question to ask anywhere: of the values this class contains, which ones
   could the two sides possibly treat differently — and is my example one of them?

   The tail of this one is worth as much as the head. The first fix was to set `htmlEntities: true`,
   chosen because it made 4.5.7 and 5.11.1 agree on all 217 captured documents — the same corpus
   that had already failed to distinguish them. It does not make the two versions agree. Under it
   version 5 decodes `&nbsp;` to U+00A0 where version 4 gives U+0020, two characters that look
   identical in every report and diff, and it decodes 35 named entities XML does not define at all.
   The corpus said "equivalent" both times because the corpus cannot tell these versions apart on
   entities, which was the original finding. **A probe that has already been shown blind to a class
   is not evidence about a change in that class** — including a change you make to fix it.

The cheapest habit, and it would have caught nearly all of these: before writing a sentence that
names a part of the system you did not edit, open that part. If you cannot open it — because you do
not know where it is — that is the finding, and the sentence should say "I believe" until you do.

## The costs behind the other section 1 rules

### A claim of necessity or impossibility needs a receipt

Good shape: _"Measured 2026-09-22 on `node:sqlite`, Node v26.7.0, inside one transaction: a
duplicate key, a null in a `not null` column and an append-only trigger's `raise(abort)` each left
the transaction usable, and the rows written beside them committed."_ — it names the engine, the
version, the conditions and what happened, so a reader can re-run it.

### A measurement taken where both answers look alike measures nothing

Cost: a zero-byte `pnpm --filter "...[origin/main]"` reading offered as proof the filter was broken,
taken where zero was also the correct answer.

### Before asserting a convention, grep the siblings

Cost: an error code prefixed `payments.` landed beside its `payment.` siblings, and a spec used
`orphan` to mean what `packages/payments/src/reconcile.ts` calls `unmatched`.

### A behaviour change retires every receipt about the old behaviour

Cost: `fix/provisioning-migrate-gate` left three stale claims in two READMEs, one of them a
documented operator procedure the change had turned into a permission refusal.

**The PATH SET matters:** a sweep scoped to `packages/` and `apps/` cannot see a claim stated in
prose somewhere else — SP-3b's did exactly that and left a file describing a deleted exclusion list.

### Claims about the outside world need receipts too — and the source's own words

Every external claim gets a provenance row (`2026-07-30-deli-hardware-design.md` sourced eight
prices, then asserted unsourced that "iOS Safari implements none of those APIs" — its decisive
claim).

Cost: compressing Square's _"doesn't support splitting a checkout into multiple payments for a
single checkout request"_ into "no splitting a checkout" turned an API limit into a product
limitation.

## How much of the code is comments

`CLAUDE.md` section 1's "about three in ten" was measured on 2026-09-24 with a throwaway script, not
kept. For every file that `git ls-files '*.ts' '*.mjs' '*.js'` lists and whose name does not end in
`.test.*` or `.spec.*`, it collected the comment ranges around each token the TypeScript parser
produced. It then counted the non-blank lines whose every non-space character lies inside a comment:
59,713 of the 198,596 non-blank lines.

**What the sweep check does not see.** A sweep shows it changed nothing but comments with
`node scripts/comments-only.mjs <base>`, weaker than its name: it reads committed changes only; a
changed `.md` file is listed as not compared and never read; a comment read by a tool its
hand-written list does not name is dropped unseen; and a listed tool comment moved to another line
without crossing a token passes.
