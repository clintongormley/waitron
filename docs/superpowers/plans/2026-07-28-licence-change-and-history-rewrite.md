# Licence Change and History Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Waitron's MIT licence with the Elastic License 2.0 plus two additional grants, and rewrite published git history so no commit ever granted MIT.

**Architecture:** Three phases. Phase A (Tasks 1–4) lands the new licence and its supporting files as ordinary local commits. Phase B (Tasks 5–7) rewrites history in a throwaway clone, then performs one destructive push. Phase C (Task 8) sweeps the documentation that describes Waitron as open-source. Phase B is gated behind an explicit human confirmation and is preceded by a restorable backup bundle.

**Tech Stack:** `git`, `git-filter-repo` (installed at `/opt/homebrew/bin/git-filter-repo`), `git filter-branch`, GitHub Actions, `gh` CLI.

**Spec:** [2026-07-28-licence-change-and-history-rewrite-design.md](../specs/2026-07-28-licence-change-and-history-rewrite-design.md)

## Global Constraints

- **`LICENSE` is byte-for-byte the canonical Elastic License 2.0 and is never edited.** Canonical source: `https://raw.githubusercontent.com/elastic/elasticsearch/main/licenses/ELASTIC-LICENSE-2.0.txt`. Size 3860 bytes. **sha256 `48255018b41fc0e965b1115af7e6779bc218bb8a6747d561da800d5022622aa2`.** This is enforced by CI in Task 4.
- **`LICENSE-GRANTS.md` adds permissions only.** Nothing in it may restrict, narrow, or reinterpret ELv2.
- **One licence, whole repository.** No permissive carve-out for `packages/verifactu` or `packages/ui`.
- **No `COMMERCIAL.md`.** No per-file licence headers. No per-package `license` fields — all twelve packages and `apps/server` are `"private": true` and unpublished.
- **`docs/compliance/consulta-mdiago.md` must never be committed.** It is untracked today and stays that way.
- **Third-party MIT references must not be changed.** Statements about `borjamrd/verifactu-conformance`, `inoguerols/verifactu`, `zarpilla/verifactu-node-lib` and `doscientos-es/verifactu` are true and stay.
- **Nothing is pushed until Task 6, which requires explicit human confirmation.**
- **Scratchpad:** `/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad` — referred to below as `$SCRATCH`.
- **Shell state does not persist between command blocks.** Working directory carries over; exported variables do not. **Every block that references `$SCRATCH` must begin with this line, verbatim:**

  ```bash
  export export SCRATCH=/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad
  ```

  Values that must survive between blocks (`OLD_MAIN_SHA`, `LOCAL_PRE_REWRITE`) are written to `$SCRATCH/pre-relicense-state.txt` and read back, never held in a shell variable across calls.

## A note on testing

This plan produces licence text, git refs, and CI configuration — not application code, so there is no unit-test cycle to run. The discipline is preserved in a different form: **every task ends with a verification command whose expected output is written out, and the destructive phase is verified before it is pushed and is restorable after.** Task 4 additionally builds a real automated test — a CI job that fails if `LICENSE` ever stops being byte-identical to ELv2.

---

## Task 1: Pre-flight survey and restorable backup

No repository content changes. This task establishes that the assumptions in the spec still hold and makes the whole operation reversible.

**Files:**
- Create: `$SCRATCH/waitron-pre-relicense.bundle`
- Create: `$SCRATCH/pre-relicense-state.txt`

**Interfaces:**
- Produces: `$SCRATCH/pre-relicense-state.txt`, holding `OLD_MAIN_SHA` — the tip of `main` before *any* of this work — as the record of what the bundle restores to. Task 7 appends `LOCAL_PRE_REWRITE` to the same file; that, not `OLD_MAIN_SHA`, is the rebase base, because `db-exports-map` was branched from a `main` that by then includes Tasks 2–4.
- Produces: `$SCRATCH/waitron-pre-relicense.bundle` — the only route back after Task 6.

- [ ] **Step 1: Record the current state**

```bash
cd /Users/clintongormley/workspace/repos/waitron
export SCRATCH=/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad
{
  echo "OLD_MAIN_SHA=$(git rev-parse main)"
  echo "recorded: $(git log -1 --format='%h %s' main)"
  echo
  echo "--- local branches ---"; git branch -vv
  echo "--- remote branches ---"; git branch -r
  echo "--- tags ---"; git tag
  echo "--- worktrees ---"; git worktree list
  echo "--- uncommitted ---"; git status --porcelain
} | tee "$SCRATCH/pre-relicense-state.txt"
```

- [ ] **Step 2: Verify the spec's assumptions still hold**

Run each and confirm the expected result. **If any differs, stop and re-read the spec against reality before continuing** — `db-exports-map` already gained a commit once between survey and plan.

```bash
gh pr list --state open                      # Expected: empty
gh api repos/clintongormley/waitron --jq .forks_count   # Expected: 0
git rev-list --count archive/v1              # Expected: 42
git tag | wc -l                              # Expected: 14
git merge-base main archive/v1 2>/dev/null || echo "orphan confirmed"   # Expected: "orphan confirmed"
test -f docs/compliance/consulta-mdiago.md && git ls-files --error-unmatch docs/compliance/consulta-mdiago.md 2>/dev/null || echo "consulta-mdiago.md correctly untracked"
```

Expected final line: `consulta-mdiago.md correctly untracked`

- [ ] **Step 3: Confirm the dirty state of the other worktree**

```bash
git -C /Users/clintongormley/workspace/worktrees/waitron-db-exports-map status --porcelain
git -C /Users/clintongormley/workspace/worktrees/waitron-db-exports-map rev-list --count main..HEAD
```

Expected: empty status, and a commit count of `1`. **If the status is non-empty, stop** — uncommitted work there would be lost by the Task 7 rebase. Commit it in that worktree first.

- [ ] **Step 4: Create the backup bundle**

```bash
export export SCRATCH=/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad
cd /Users/clintongormley/workspace/repos/waitron
git bundle create "$SCRATCH/waitron-pre-relicense.bundle" --all
```

- [ ] **Step 5: Verify the bundle actually restores**

A bundle you have not verified is not a backup.

```bash
export export SCRATCH=/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad
git bundle verify "$SCRATCH/waitron-pre-relicense.bundle"
rm -rf "$SCRATCH/restore-test"
git clone "$SCRATCH/waitron-pre-relicense.bundle" "$SCRATCH/restore-test" 2>&1 | tail -2
git -C "$SCRATCH/restore-test" log --oneline -1
git -C "$SCRATCH/restore-test" show HEAD:LICENSE | head -1
rm -rf "$SCRATCH/restore-test"
```

Expected: `git bundle verify` reports the bundle is okay; the clone's `HEAD:LICENSE` first line is `MIT License`, proving the pre-rewrite state is captured.

- [ ] **Step 6: No commit**

Nothing in the repository changed. Do not commit.

---

## Task 2: Scrub the mdiago links, rewrite the licence decision record, commit pending docs

This is PR 0 from the spec. It must happen before the rewrite so the pending documentation is carried automatically.

**Files:**
- Create: `.git/info/exclude` entry (local only, never committed)
- Modify: `docs/compliance/implementation-provenance.md:81-92`
- Modify: `docs/compliance/asesor-questions.md:19`
- Modify: `docs/compliance/action-plan.md:129`
- Commit: all outstanding doc files **except** `docs/compliance/consulta-mdiago.md`

- [ ] **Step 1: Stop the mdiago letter being staged by accident**

`.git/info/exclude` is local to the clone and never committed — unlike `.gitignore`, which would publicly name the file it hides.

```bash
cd /Users/clintongormley/workspace/repos/waitron
printf '\n# Private outreach correspondence — never publish (see spec 2026-07-28 §6)\ndocs/compliance/consulta-mdiago.md\n' >> .git/info/exclude
git status --porcelain | grep consulta-mdiago || echo "correctly excluded"
```

Expected: `correctly excluded`

- [ ] **Step 2: Rewrite the licence decision record**

In `docs/compliance/implementation-provenance.md`, replace the whole section from `## Waitron's own licence — MIT` through the line ending `...ecosystem fit and simplicity.` (lines 81–92) with:

```markdown
## Waitron's own licence — Elastic License 2.0

**Decided 2026-07-28: Elastic License 2.0, whole repo**, plus two additional grants in
`LICENSE-GRANTS.md`. Supersedes the MIT decision of 2026-07-18.

The requirement is narrow: a restaurant, or a group of forty restaurants, may run Waitron for
free at any scale and pay a contractor to look after it; nobody may take the codebase and sell a
hosted Waitron. ELv2's first limitation prohibits exactly that — *providing the software to third
parties as a hosted or managed service* — and permits everything else.

**AGPL was ruled out, and the reasoning has changed.** AGPL is the reflex answer and it is the
wrong one: it is precisely the licence AWS defeated against MongoDB and Elasticsearch, because a
hyperscaler can comply by publishing its modifications and still take the business. A licence
that taxes hosting with a source-publication duty does not prevent hosting.

**Known trade-off, accepted:** this is source-available, not OSI-approved open source, and the
MIT grant already given cannot be revoked. See
[the licence design](../superpowers/specs/2026-07-28-licence-change-and-history-rewrite-design.md)
for the full reasoning, the alternatives considered (PolyForm Shield, BUSL 1.1, FSL, a bespoke
licence), and what the change does not protect.
```

- [ ] **Step 3: Remove the two working-tree links to the mdiago letter**

In `docs/compliance/asesor-questions.md` line 19, replace:

```
simplified Spanish list in [consulta-mdiago.md](consulta-mdiago.md).
```

with:

```
simplified Spanish list sent to a fellow implementer (kept out of this repository).
```

In `docs/compliance/action-plan.md` line 129, replace:

```
He answered every question in [consulta-mdiago.md](consulta-mdiago.md) and asked for one thing
```

with:

```
He answered every question we sent and asked for one thing
```

- [ ] **Step 4: Verify no markdown link to the letter survives in the working tree**

The check is for markdown **links** to the letter — `](…consulta-mdiago.md)` — not for any mention
of the name. The spec and this plan both name the file in prose and in shell commands, necessarily
and correctly: they document the decision to exclude it. Prose mentions are fine; a link is not,
because a link 404s in the published repository.

This plan file is excluded from the check because it *quotes* the two links as the "From" text of
the edits above, and quotes the link once more inside the Task 5 perl pattern — it will always
self-match, by design.

```bash
grep -rnE '\]\([^)]*consulta-mdiago\.md\)' docs --include='*.md' \
  | grep -v 'plans/2026-07-28-licence-change-and-history-rewrite\.md'
```

Expected: exactly one remaining hit — `docs/superpowers/specs/2026-07-26-server-host-design.md:108`.
That one is **already committed** and is stripped from history in Task 5, not here. Any other hit
must be fixed now. **Do not edit the spec or this plan to satisfy this check.**

- [ ] **Step 5: Stage everything except the letter, and prove it**

`git status` has no `--cached` flag, so use `git diff --cached`, which does. Getting this wrong
produces a gate that always prints PASS — grep finds nothing in git's *error message* — on the one
check standing between a private letter and a public repository.

```bash
git add -A
git diff --cached --name-only | grep consulta-mdiago && echo "FAIL: letter is staged" || echo "PASS: letter not staged"
git ls-files --error-unmatch docs/compliance/consulta-mdiago.md 2>/dev/null && echo "FAIL: letter is tracked" || echo "PASS: letter untracked"
```

Expected: `PASS: letter not staged` and `PASS: letter untracked`. Two independent checks, because
a false PASS here is unrecoverable once pushed.

- [ ] **Step 6: Commit**

```bash
git commit -s -m "docs: land outstanding compliance, handoff and design docs

Includes the licence decision record rewritten from MIT to Elastic
License 2.0, superseding the 2026-07-18 decision.

Private outreach correspondence is deliberately excluded via
.git/info/exclude and is not part of this repository."
git log -1 --stat | head -20
```

---

## Task 3: The licence files

**Files:**
- Modify: `LICENSE` (MIT → ELv2)
- Create: `LICENSE-GRANTS.md`
- Create: `CONTRIBUTING.md`
- Create: `README.md`
- Modify: `package.json` (add `license` field)

- [ ] **Step 1: Install the canonical ELv2 and verify it byte-for-byte**

Do not transcribe the licence. Fetch it and check the hash.

```bash
cd /Users/clintongormley/workspace/repos/waitron
curl -sSL -o LICENSE https://raw.githubusercontent.com/elastic/elasticsearch/main/licenses/ELASTIC-LICENSE-2.0.txt
echo "48255018b41fc0e965b1115af7e6779bc218bb8a6747d561da800d5022622aa2  LICENSE" | shasum -a 256 -c -
```

Expected: `LICENSE: OK`. **If the hash does not match, stop** — either the upstream file changed or the download is corrupt. Do not "fix" it by editing.

- [ ] **Step 2: Write `LICENSE-GRANTS.md`**

```markdown
# Additional permissions

Waitron is licensed under the [Elastic License 2.0](LICENSE) ("ELv2").

The permissions below are granted by the licensor **in addition to** those in ELv2. They only
ever add to your rights. Nothing here restricts, narrows, or reinterprets ELv2, and if any part
of this document appears to conflict with ELv2, ELv2 governs and the conflicting part of this
document has no effect.

## Grant 1 — Service providers

Installing, configuring, hosting, administering, monitoring, updating or supporting the
software — including for a fee — on computing infrastructure that the customer controls, under
accounts held by the customer, does **not** constitute "providing the software to third parties
as a hosted or managed service" for the purposes of ELv2's first limitation.

The distinction is **who holds the infrastructure account**, not who performs the work. Running
the software on infrastructure you control and selling other parties access to it remains
prohibited by ELv2.

## Grant 2 — Abandonment sunset

If the licensor publicly announces that Waitron is discontinued, or publishes no release of
Waitron for twelve (12) consecutive months — a "release" meaning a tagged version or a published
artefact, not merely a commit — then the most recently published version of the software is from
that point additionally available to you under the Apache License, Version 2.0.

Once triggered, this grant is irrevocable.
```

- [ ] **Step 3: Write `CONTRIBUTING.md`**

The transferable inbound grant is the only file in this repository that protects the ability to
dual-licence. The "successors and assigns" wording is load-bearing: without it, every merged
contribution must be re-papered when Waitron SL is incorporated.

```markdown
# Contributing to Waitron

Thanks for your interest. Waitron is source-available under the
[Elastic License 2.0](LICENSE) with [additional permissions](LICENSE-GRANTS.md). Please read
both before contributing.

## Inbound licensing

**By submitting a contribution — a pull request, a patch, or any other change — you grant
Clinton Gormley and his successors and assigns a perpetual, irrevocable, worldwide,
royalty-free, transferable, sublicensable licence to use, reproduce, modify, prepare derivative
works of, publicly display, distribute, and relicense your contribution, in whole or in part,
under any terms, including commercial terms.**

You retain copyright in your contribution. This grant does not take it from you; it lets the
project ship your work under its current licence and under any future licence, including the
commercial terms under which Waitron itself is operated.

You confirm that you are legally entitled to grant this — that the work is yours, or that you
have permission from whoever owns it, such as an employer.

## Developer Certificate of Origin

Every commit must be signed off, certifying the
[Developer Certificate of Origin 1.1](https://developercertificate.org/):

```
git commit -s -m "your message"
```

This appends a `Signed-off-by: Your Name <your@email>` trailer. Commits without it are rejected
by CI. Use your real name and a real email address.

## Before you open a pull request

- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm format:check` all pass.
- New behaviour has tests.
- Commits are signed off.
```

- [ ] **Step 4: Write `README.md`**

There is no README today. It carries the plain-English licence summary, the copyright notice
(ELv2 has nowhere to put one, and the Task 4 hash check forbids adding one), and the trademark
reservation.

```markdown
# Waitron

Restaurant management for hospitality — point of sale, bookings, ordering, kitchen management and
payments, with Spanish VERI\*FACTU fiscal compliance built in.

Runs standalone and self-hosted on a single machine, or as a multi-tenant cloud service, from the
same codebase.

> **Status: pre-release.** Not yet running in production anywhere. Interfaces change without
> notice.

## Licence

Waitron is **source-available**, not open source. It is licensed under the
[Elastic License 2.0](LICENSE), with [additional permissions](LICENSE-GRANTS.md).

In plain English:

**You may**, free of charge and at any scale —

- run Waitron for restaurants you own or operate, however many;
- read, modify and redistribute the source;
- pay anyone you like to install, configure, host, administer or support it **on infrastructure
  you control, under your own accounts**;
- sell hardware with Waitron pre-installed, for the buyer to own and run.

**You may not** —

- provide Waitron to third parties as a hosted or managed service;
- circumvent licence-key functionality;
- remove or obscure licensing, copyright or other notices.

If Waitron is discontinued, or goes twelve months without a release, the current version converts
to Apache 2.0 — see Grant 2. Your till does not die if we do.

The authoritative terms are in [LICENSE](LICENSE) and [LICENSE-GRANTS.md](LICENSE-GRANTS.md);
this summary has no legal effect. Licensing questions: info@waitron.io

**Trademark.** No trademark rights are granted by the licence. "Waitron" is the licensor's mark.
You may state accurately that your product is built on or derived from Waitron; you may not name
or brand your distribution "Waitron".

Copyright © 2026 Clinton Gormley.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions require a Developer Certificate of Origin
sign-off and grant the project the right to relicense.
```

- [ ] **Step 5: Add the licence field to the root `package.json`**

Insert after the `"private": true,` line (currently `package.json:3`):

```json
  "license": "SEE LICENSE IN LICENSE",
```

Leave the twelve package manifests and `apps/server` alone — all are `"private": true` and never published, so the metadata is inert.

- [ ] **Step 6: Verify**

```bash
echo "48255018b41fc0e965b1115af7e6779bc218bb8a6747d561da800d5022622aa2  LICENSE" | shasum -a 256 -c -
head -1 LICENSE
node -e 'console.log(require("./package.json").license)'
test -f LICENSE-GRANTS.md && test -f CONTRIBUTING.md && test -f README.md && echo "all files present"
grep -rn 'COMMERCIAL' README.md LICENSE-GRANTS.md CONTRIBUTING.md || echo "no COMMERCIAL.md reference — correct"
```

Expected: `LICENSE: OK`; `Elastic License 2.0`; `SEE LICENSE IN LICENSE`; `all files present`; `no COMMERCIAL.md reference — correct`.

- [ ] **Step 7: Commit**

```bash
git add LICENSE LICENSE-GRANTS.md CONTRIBUTING.md README.md package.json
git commit -s -m "licence: MIT -> Elastic License 2.0 with additional grants

A restaurant may self-host at any scale for free and pay a contractor to
run it on its own infrastructure. Nobody may sell Waitron as a hosted
service. AGPL was ruled out: a hyperscaler complies with it and still
takes the business.

LICENSE is the canonical ELv2, byte-for-byte, and is never edited.
LICENSE-GRANTS.md only ever adds permissions.
CONTRIBUTING.md's inbound grant runs to successors and assigns, so it
survives incorporation."
```

---

## Task 4: CI — licence integrity and DCO enforcement

The inbound grant is worthless if unsigned commits merge, and the "never edit ELv2" constraint is
worthless if nothing checks it. This task makes both enforceable.

**Files:**
- Create: `.github/workflows/licence.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: licence

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  licence-integrity:
    name: LICENSE is unmodified Elastic License 2.0
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Verify LICENSE byte-for-byte
        run: |
          echo "48255018b41fc0e965b1115af7e6779bc218bb8a6747d561da800d5022622aa2  LICENSE" \
            | sha256sum -c -

  dco:
    name: Every commit is signed off
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Check Signed-off-by trailers
        env:
          BASE_SHA: ${{ github.event.pull_request.base.sha }}
          HEAD_SHA: ${{ github.event.pull_request.head.sha }}
        run: |
          fail=0
          for sha in $(git rev-list "$BASE_SHA".."$HEAD_SHA"); do
            if ! git log -1 --format=%B "$sha" | grep -qiE '^Signed-off-by: .+ <.+@.+>'; then
              echo "::error::Missing Signed-off-by: $(git log -1 --oneline "$sha")"
              fail=1
            fi
          done
          if [ "$fail" -ne 0 ]; then
            echo "Sign off with: git commit -s   (or: git rebase --signoff <base>)"
            exit 1
          fi
          echo "All commits signed off."
```

Both SHAs are passed through `env:` rather than interpolated into the shell, so workflow inputs
never become shell code.

- [ ] **Step 2: Verify the integrity check locally, both ways**

The check is only worth having if it actually fails on a modified licence.

```bash
export export SCRATCH=/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad
cd /Users/clintongormley/workspace/repos/waitron
echo "48255018b41fc0e965b1115af7e6779bc218bb8a6747d561da800d5022622aa2  LICENSE" | shasum -a 256 -c -
cp LICENSE "$SCRATCH/LICENSE.bak"
printf '\nCopyright (c) 2026 Clinton Gormley\n' >> LICENSE
echo "48255018b41fc0e965b1115af7e6779bc218bb8a6747d561da800d5022622aa2  LICENSE" | shasum -a 256 -c - && echo "BUG: check passed on a modified licence" || echo "PASS: check correctly rejects a modified licence"
cp "$SCRATCH/LICENSE.bak" LICENSE
echo "48255018b41fc0e965b1115af7e6779bc218bb8a6747d561da800d5022622aa2  LICENSE" | shasum -a 256 -c -
```

Expected: `LICENSE: OK`, then `PASS: check correctly rejects a modified licence`, then `LICENSE: OK` again. This is also the proof that the copyright notice must live in the README rather than in `LICENSE`.

- [ ] **Step 3: Validate the YAML parses**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/licence.yml')); print('yaml ok')"
```

Expected: `yaml ok`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/licence.yml
git commit -s -m "ci: enforce the licence — ELv2 byte-check and DCO sign-off

The inbound grant in CONTRIBUTING.md is worthless if unsigned commits
merge, and 'never edit ELv2' is worthless if nothing checks it."
```

- [ ] **Step 5: Note the branch-protection consequence**

Job ids are a branch-protection interface. `licence-integrity` and `dco` are new checks and will
not be required until added in the repository's branch-protection settings. Record this as a
follow-up; do not change protection settings as part of this task.

---

## Task 5: Rewrite history in a throwaway clone

Nothing here touches the working repository or the other worktree, and nothing is pushed.

**Files:**
- Create: `$SCRATCH/rewrite-tree.sh`
- Create: `$SCRATCH/waitron-relicense/` (throwaway clone)

**Interfaces:**
- Consumes: `OLD_MAIN_SHA` from Task 1; `LICENSE` from Task 3.
- Produces: a rewritten `main` in `$SCRATCH/waitron-relicense`, unpushed.

- [ ] **Step 1: Clone `main` alone into the scratchpad**

`--single-branch --no-tags` means the rewrite sees only `main`; `archive/v1`, its fourteen tags
and the seven stale branches are simply never fetched, and are deleted directly on the remote in
Task 6.

```bash
export SCRATCH=/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad
rm -rf "$SCRATCH/waitron-relicense"
git clone --no-hardlinks --single-branch --branch main --no-tags \
  /Users/clintongormley/workspace/repos/waitron "$SCRATCH/waitron-relicense"
cd "$SCRATCH/waitron-relicense"
git log --oneline | wc -l          # must equal the source repo's count, recorded below
git -C /Users/clintongormley/workspace/repos/waitron rev-list --count main   # the authority
git branch -a                       # Expected: only main
git tag | wc -l                     # Expected: 0
```

- [ ] **Step 2: Write the tree-rewriting script**

Two jobs: put the canonical ELv2 at `LICENSE` in every commit, and strip the one committed
reference to the mdiago letter. A script file rather than an inline `--tree-filter` string,
because it can be tested on its own first.

```bash
export export SCRATCH=/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad
cat > "$SCRATCH/rewrite-tree.sh" <<'SCRIPT'
#!/bin/sh
# Runs once per commit, inside a checkout of that commit's tree.
set -e

# 1. Every commit carries the canonical Elastic License 2.0.
cp "$ELV2_SRC" LICENSE

# 2. Strip the only committed reference to the private outreach letter.
f=docs/superpowers/specs/2026-07-26-server-host-design.md
if [ -f "$f" ]; then
  perl -pi \
    -e 's{\Q(../../compliance/asesor-questions.md) §97,\E$}{(../../compliance/asesor-questions.md) §97).};' \
    -e 's{^\Q[`consulta-mdiago.md`](../../compliance/consulta-mdiago.md)). \E}{};' \
    "$f"
fi
exit 0
SCRIPT
chmod +x "$SCRATCH/rewrite-tree.sh"
```

- [ ] **Step 3: Test the script's text substitution before running it over history**

Never run a 41-commit rewrite on an untested regex. This substitution **was verified against the
real file while this plan was written** — it changed exactly lines 107–108 and nothing else — so
this step is a regression check, not an experiment. If it does not reproduce, the file changed.

Note the `s{}{}` delimiters: the paths contain `/`, so a `s///` form would terminate the pattern
early, and `\Q…\E` must contain the plain unescaped path or the quoting swallows the escapes.

```bash
export export SCRATCH=/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad
rm -rf "$SCRATCH/scripttest"
mkdir -p "$SCRATCH/scripttest/docs/superpowers/specs"
cd "$SCRATCH/scripttest"
cp /Users/clintongormley/workspace/repos/waitron/docs/superpowers/specs/2026-07-26-server-host-design.md \
   docs/superpowers/specs/
ELV2_SRC=/Users/clintongormley/workspace/repos/waitron/LICENSE "$SCRATCH/rewrite-tree.sh"
sed -n '105,110p' docs/superpowers/specs/2026-07-26-server-host-design.md
grep -c 'consulta-mdiago' docs/superpowers/specs/2026-07-26-server-host-design.md || echo "0 references — correct"
head -1 LICENSE
```

Expected: the passage now reads `...asesor-questions.md) §97).` followed by `A deployment that learns a shared`; `0 references — correct`; and `Elastic License 2.0`.

**If the substitution did not fire, fix the regex here and re-test.** Do not proceed with a
partially-working script.

- [ ] **Step 4: Rewrite every commit**

```bash
export export SCRATCH=/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad
cd "$SCRATCH/waitron-relicense"
export ELV2_SRC=/Users/clintongormley/workspace/repos/waitron/LICENSE
export FILTER_BRANCH_SQUELCH_WARNING=1
git filter-branch --force --tree-filter "$SCRATCH/rewrite-tree.sh" -- --all
```

Expected: `Rewrite ... (41/41)` then `Ref 'refs/heads/main' was rewritten`.

- [ ] **Step 5: Drop `refs/original` before verifying**

`git filter-branch` saves the pre-rewrite tip under `refs/original/refs/heads/main`. **Until that
ref is deleted the entire MIT history is still reachable**, and the verification in Step 6 would
correctly report failure. Delete it, then expire the reflog and garbage-collect.

```bash
export export SCRATCH=/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad
cd "$SCRATCH/waitron-relicense"
git for-each-ref --format='%(refname)' refs/original | while read -r r; do git update-ref -d "$r"; done
git reflog expire --expire=now --all
git gc --prune=now
git for-each-ref | grep -c original || echo "refs/original gone"
```

Expected: `refs/original gone`.

- [ ] **Step 6: Verify no MIT grant survives anywhere in the rewritten history**

This is the whole point of the task. Check every commit, not just the tip.

```bash
export export SCRATCH=/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad
cd "$SCRATCH/waitron-relicense"
echo "--- commits whose LICENSE is not ELv2 (expect none) ---"
for c in $(git rev-list --all); do
  first=$(git show "$c:LICENSE" 2>/dev/null | head -1)
  [ "$first" = "Elastic License 2.0" ] || echo "BAD $c -> ${first:-<no LICENSE>}"
done
echo "--- any blob anywhere still containing the MIT grant (expect none) ---"
git rev-list --all --objects | awk '{print $1}' | sort -u | while read -r o; do
  if [ "$(git cat-file -t "$o" 2>/dev/null)" = blob ]; then
    git cat-file -p "$o" 2>/dev/null | grep -q 'Permission is hereby granted, free of charge' && echo "MIT TEXT IN BLOB $o"
  fi
done
echo "--- mdiago LINKS anywhere in rewritten history (expect none) ---"
# Links only, not mentions: this plan and the licence spec name the file in prose and in shell
# commands by necessity, and this plan also quotes the link itself as the perl pattern's input.
git grep -lE '\]\([^)]*consulta-mdiago\.md\)' $(git rev-list --all) 2>/dev/null \
  | grep -v 'plans/2026-07-28-licence-change-and-history-rewrite\.md' | head || echo "none"
echo "--- both old MIT blobs must be gone after the Step 5 gc ---"
for b in $PRE_REWRITE_LICENSE_BLOBS; do   # the two values are recorded in the run ledger, which is git-ignored
  git cat-file -e "$b" 2>/dev/null && echo "STILL PRESENT: $b" || echo "gone: $b"
done
```

Expected: no `BAD` lines, no `MIT TEXT IN BLOB` lines, `none` for mdiago references, and `gone:`
for both blobs. **A `STILL PRESENT` line means Step 5's ref deletion or gc did not take — go back
and fix it before pushing**, because those objects would otherwise be pushed.

- [ ] **Step 7: Verify the content is otherwise unchanged**

The rewrite must alter `LICENSE` and one documentation line, and nothing else.

```bash
export export SCRATCH=/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad
cd "$SCRATCH/waitron-relicense"
diff <(git -C /Users/clintongormley/workspace/repos/waitron ls-tree -r --name-only main | sort) \
     <(git ls-tree -r --name-only main | sort) \
  && echo "PASS: no files added or removed"
diff <(git -C /Users/clintongormley/workspace/repos/waitron show main:docs/superpowers/specs/2026-07-26-server-host-design.md) \
     <(git show main:docs/superpowers/specs/2026-07-26-server-host-design.md)
git log --oneline | wc -l    # Expected: 41 — no commits lost
git log --format='%an|%ae|%ad' -1 main   # author identity and date preserved
```

Expected: `PASS: no files added or removed`; the second `diff` shows **only** the two-line mdiago
change at lines 107–108 and nothing else; `41`; and an author line still reading
`Clinton Gormley|clintongormley@gmail.com|...`.

- [ ] **Step 8: Do not push**

Task 6 pushes, and only after explicit confirmation.

---

## Task 6: The destructive push — GATED

**This task deletes 22 remote refs and force-pushes `main`. It is the only irreversible step.**

- [ ] **Step 1: Stop and get explicit confirmation**

Present to the human, and wait for an unambiguous go-ahead:

- Force-push rewritten `main` (41 commits, all SHAs change) to `origin`.
- Delete `origin/archive/v1` and the local `archive/v1` — 42 commits, the previous attempt.
- Delete 14 remote tags `phase-1-complete` … `phase-14-complete` — these anchor those same 42 commits, so deleting the branch alone would achieve nothing.
- Delete 7 stale merged remote branches: `payment-reconcile-slice-a`, `payment-reconcile-slice-b`, `payments-mode-2b-cycle-b`, `plan-sales-spine-data-model`, `roadmap-menu-hours-procurement`, `workforce-time-record`, `worktree-verifactu-library`.
- Restorable from `$SCRATCH/waitron-pre-relicense.bundle` for as long as that file is kept.

**Do not proceed without a clear yes.**

- [ ] **Step 2: Force-push the rewritten main**

```bash
export export SCRATCH=/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad
cd "$SCRATCH/waitron-relicense"
git remote set-url origin https://github.com/clintongormley/waitron.git
git push --force-with-lease origin main
```

`--force-with-lease` rather than `--force`: the clone's remote-tracking ref still records the tip
it cloned, so the push aborts if anything landed on `origin/main` in the meantime instead of
silently discarding it.

- [ ] **Step 3: Delete the orphan branch and its 14 anchoring tags**

```bash
git push origin --delete archive/v1
for i in $(seq 1 14); do git push origin --delete "phase-$i-complete"; done
```

- [ ] **Step 4: Delete the 7 stale merged branches**

```bash
for b in payment-reconcile-slice-a payment-reconcile-slice-b payments-mode-2b-cycle-b \
         plan-sales-spine-data-model roadmap-menu-hours-procurement workforce-time-record \
         worktree-verifactu-library; do
  git push origin --delete "$b"
done
```

- [ ] **Step 5: Verify the remote**

```bash
git ls-remote --heads origin
git ls-remote --tags origin
```

Expected: exactly one head, `refs/heads/main`, at the rewritten tip. No tags.

- [ ] **Step 6: Verify the published licence**

```bash
gh api repos/clintongormley/waitron/contents/LICENSE --jq .content | base64 -d | head -1
gh repo view --json licenseInfo
```

Expected: `Elastic License 2.0`. `licenseInfo` will report `null` or `Other` — GitHub does not
detect ELv2, which is expected and not a problem.

---

## Task 7: Re-point the local checkout and replay `db-exports-map`

**Files:**
- Modify: local `main` and `db-exports-map` refs; no repository content changes.

**Interfaces:**
- Consumes: `LOCAL_PRE_REWRITE` — written to `$SCRATCH/pre-relicense-state.txt` in Step 1 of this task, before the reset destroys it, and read back in Step 2.

- [ ] **Step 1: Reset local main onto the rewritten history**

```bash
export export SCRATCH=/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad
cd /Users/clintongormley/workspace/repos/waitron
# Record the pre-rewrite tip BEFORE resetting — Step 2 needs it as the rebase base,
# and shell variables do not survive to the next command block.
echo "LOCAL_PRE_REWRITE=$(git rev-parse main)" >> "$SCRATCH/pre-relicense-state.txt"
git fetch origin --prune --prune-tags
git checkout main
git reset --hard origin/main
head -1 LICENSE
git log --oneline -3
grep '^LOCAL_PRE_REWRITE=' "$SCRATCH/pre-relicense-state.txt"
```

Expected: `Elastic License 2.0`, and a log whose tip is the CI commit from Task 4 with a new SHA.

- [ ] **Step 2: Replay the paused `db-exports-map` work**

That branch carries one commit — `f3f2233`, the exports-map spec — on top of the pre-rewrite
`main`. Rebase it onto the new history.

```bash
export export SCRATCH=/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad
LOCAL_PRE_REWRITE=$(grep '^LOCAL_PRE_REWRITE=' "$SCRATCH/pre-relicense-state.txt" | cut -d= -f2)
echo "rebasing onto origin/main, off base $LOCAL_PRE_REWRITE"
git -C /Users/clintongormley/workspace/worktrees/waitron-db-exports-map status --porcelain
git -C /Users/clintongormley/workspace/worktrees/waitron-db-exports-map \
  rebase --onto origin/main "$LOCAL_PRE_REWRITE" db-exports-map
```

Expected: a clean rebase of one commit. If the status was non-empty, stash there first.

- [ ] **Step 3: Verify the replayed branch**

```bash
cd /Users/clintongormley/workspace/worktrees/waitron-db-exports-map
git log --oneline -2
head -1 LICENSE
test -f docs/superpowers/specs/2026-07-28-db-exports-map-design.md && echo "spec intact"
git rev-list --count origin/main..HEAD
```

Expected: one commit ahead of the new `origin/main`; `Elastic License 2.0` inherited from the new
parent; `spec intact`.

- [ ] **Step 4: Clean up the throwaway clone, keep the bundle**

```bash
export export SCRATCH=/private/tmp/claude-503/-Users-clintongormley-workspace-repos-waitron/7014046a-3265-482a-a5fa-65489ac68570/scratchpad
rm -rf "$SCRATCH/waitron-relicense" "$SCRATCH/scripttest" "$SCRATCH/regextest" \
       "$SCRATCH/LICENSE.bak" "$SCRATCH/old-files.txt" "$SCRATCH/new-files.txt"
ls -la "$SCRATCH/waitron-pre-relicense.bundle"
```

The bundle stays. It is the only route back.

---

## Task 8: The paper trail

Not urgent, and separable — this is PR 2 in the spec. It involves Spanish that AEAT may read, so
it wants care rather than speed.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-18-pos-architecture-design.md:1,19`
- Modify: `docs/compliance/asesor-questions.md` §Q9(a) draft consulta
- Modify: `docs/compliance/verifactu-findings.md:218`

- [ ] **Step 1: Branch**

```bash
cd /Users/clintongormley/workspace/repos/waitron
git checkout -b licence-paper-trail
```

- [ ] **Step 2: Retitle the architecture design**

`docs/superpowers/specs/2026-07-18-pos-architecture-design.md` line 1: change
`# Open-Source Restaurant POS — Architecture Design` to
`# Source-Available Restaurant POS — Architecture Design`.

Line 19: change `An open-source POS and restaurant management system, intended to replace Square, released`
to `A source-available POS and restaurant management system, intended to replace Square, released`.

Then make these four further edits. Each keeps the surrounding argument intact — the substance is
about AEAT's treatment of published source, which the licence change does not alter.

| Line | From | To |
| --- | --- | --- |
| 196 | `### Declaración responsable and open source` | `### Declaración responsable and published source` |
| 199 | `Being open source changes nothing about liability.` | `Being publicly readable changes nothing about liability.` |
| 228 | `open-source question: our company, our NIF, our deployment.` | `published-source question: our company, our NIF, our deployment.` |
| 629 | `an open-source POS will be deployed by` | `a POS with published source will be deployed by` |
| 740 | `who signs the declaración responsable for` / `open-source software — blocks public release rather than the build.` | `who signs the declaración responsable for` / `publicly-published software — blocks public release rather than the build.` |

**Do not touch the AEAT quotation on line 199**, *"ya sea o no de código abierto"* — those are
AEAT's words, not ours, and they remain accurate.

Then confirm nothing was missed:

```bash
grep -n 'open.source\|open source' docs/superpowers/specs/2026-07-18-pos-architecture-design.md
```

Expected: no remaining hit that describes Waitron itself.

- [ ] **Step 3: Correct the draft consulta's false premise**

In `docs/compliance/asesor-questions.md` §Q9(a), the draft consulta reads:

```
> Publicamos como código abierto un sistema de punto de venta que, una vez desplegado por un
> tercero, constituye un SIF. Nosotros no lo desplegamos para ese tercero, no lo
> comercializamos y no cobramos por él; cada empresa lo instala y lo configura por su cuenta.
```

Replace with:

```
> Publicamos el código fuente de un sistema de punto de venta que, una vez desplegado por un
> tercero, constituye un SIF. Lo publicamos bajo una licencia restrictiva («source-available»,
> no de código abierto): cualquier empresa puede descargarlo, instalarlo y utilizarlo
> gratuitamente en sus propios locales, pero no puede ofrecerlo a terceros como servicio
> alojado. Nosotros no lo desplegamos para esos terceros; cada empresa lo instala y lo
> configura por su cuenta. Por separado, nosotros mismos explotamos comercialmente el mismo
> software como servicio en la nube para nuestros propios clientes.
```

Add immediately after the question:

```
> ¿Cambia la respuesta el hecho de que el titular del código lo explote además comercialmente
> como servicio en la nube?
```

- [ ] **Step 4: Fix the verifactu library classification**

`docs/compliance/verifactu-findings.md:218` describes `packages/verifactu` as a *"reusable MIT
library for others to build on"*. Change `MIT` to `source-available`. The declaración-responsable
classification that sentence supports — case (b), needing its own DR — is unaffected by the
licence and must not change.

- [ ] **Step 5: Verify no stale claim survives**

```bash
grep -rniE '\bMIT\b' docs --include='*.md' \
  | grep -viE 'borjamrd|inoguerols|zarpilla|doscientos|verifactu-conformance' \
  | grep -viE '2026-07-28-licence-change|implementation-provenance'
```

Expected: no hits. Three categories of surviving mention are correct and must **not** be edited:

- **Third-party licences** (`borjamrd`, `inoguerols`, `zarpilla`, `doscientos`) — factual and true.
- **The licence-change spec and plan** — they describe the MIT→ELv2 migration, so they name MIT by
  necessity. Editing them would falsify the decision record.
- **`implementation-provenance.md`** — its rewritten section states that MIT was superseded, which
  is the point of the record.

Any hit outside those three categories is a stale claim that Waitron is MIT-licensed, and must be
fixed.

- [ ] **Step 6: Commit and open the PR**

```bash
git add -A
git commit -s -m "docs: describe Waitron as source-available, not open source

Corrects the architecture design's framing, the draft consulta's premise
that we neither commercialise nor charge (which the licence change makes
false, and a consulta vinculante binds AEAT only on the facts stated),
and the verifactu library's licence classification.

Third-party MIT references are factual and unchanged."
gh pr create --fill
```

---

## Follow-ups, not in this plan

- **Copyright assignment or exclusive licence to Waitron SL** — [action-plan.md](../../compliance/action-plan.md) Step 6. Without it the company holds no asset. The `CONTRIBUTING.md` grant is already worded to survive it.
- **Add `licence-integrity` and `dco` to branch protection** as required checks.
- **Re-run the Q9(a) legal analysis** in light of commercialisation. A lawyer's job.
- **Send the reworded consulta.**
- **SHA citations in handoff docs and saved memory go dangling** after Task 6 — e.g. *"orphan drift gate (#31, squash 59ded62)"*. PR numbers still resolve; the commit SHAs do not.
