# Cut a release

A release is a numbered version of Waitron, such as `1.0.0`, that boxes in production run. The law
asks the software's producer to sign a declaration for every version: a statement, in Spanish,
that this version meets the Veri\*Factu rules (the *declaración responsable*). Each version's
signed text is committed as `packages/fiscal-verifactu/declarations/v<version>.md`, and a release
is cut in two commands: `pnpm release prepare` writes that file and opens a pull request for it,
and `pnpm release tag` puts the version's name (a git tag, `v1.0.0`) on `main` once that pull
request has landed.

## No release can be cut yet

Both commands refuse today, on purpose. The declaration's template,
[`template.md`](../../packages/fiscal-verifactu/declarations/template.md), opens with two
"release blocker" lines, and the package command both release commands call refuses while any is
present, answering `declaration.release_blocked {"count":2}`:

- **The first line is for the asesor's question Q53.** Item d) of the declaration, which lists
  what the system is made of, is still the draft sent to the asesor (the tax adviser) as Q53.
  Whoever records the asesor's answer replaces item d) with the answered wording, keeping the
  cloud-server phrase and the spare-server sentence only if the version can do them, and deletes
  the line.
- **The second line is for A940 slice 4.** Pushing a tag whose name starts with `v` already makes
  CI publish an image under that version's number, but that image does not yet carry the
  version's number in its records, nor its declaration. Slice 4 makes it carry both, and deletes
  the line.

Never push a `v*` tag by hand (`git tag v1.0.0 && git push origin v1.0.0`). Only the two commands
read the blocker lines, so a tag pushed by hand skips them and publishes the image anyway. Slice 4
will make CI refuse such a tag.

## 1. Make the release worktree

`prepare` runs only on a branch named `release/<version>` whose last commit is `main`'s latest,
with nothing uncommitted. The worktree script starts a new branch from the main checkout's current
commit, so bring the main checkout up to date first:

```sh
git -C ~/workspace/repos/waitron pull --ff-only
python3 ~/workspace/tools/worktree.py new waitron release/1.0.0 --headless
cd ~/workspace/worktrees/waitron-release-1.0.0
```

## 2. Check these before `prepare`

- [`functions.md`](../../packages/fiscal-verifactu/declarations/functions.md) still matches the
  code: each line names a function beside the route or file that serves it. Take off a function
  whose route is gone or refused, and add a new one.
- Item d) in the template mentions the cloud server and the spare box on site only if this
  release can do them.
- Item d) still names every service of ours that this version can call in production (none
  today). A release that adds one changes item d) and has its wording checked again.
- AEAT's frequently asked questions about the declaration, and its worked example, are read again
  for changes ([our notes on them](../compliance/verifactu-faq-notes.md)).
- The repository is still public (`gh repo view clintongormley/waitron --json visibility`). Its
  releases page is the public archive of every declaration.

## 3. Load the producer's settings

The declaration names its producer by name, tax number and postal address, read from three
settings: `WAITRON_PRODUCER_NAME`, `WAITRON_PRODUCER_TAX_ID` and `WAITRON_PRODUCER_ADDRESS`. Their
real values are kept in `~/waitron-campaign-shared/private/producer-identity.env` and are never
committed. Load them into the shell that will run `prepare` and `tag`, without printing them:

```sh
while IFS= read -r line; do export "$line"; done < ~/waitron-campaign-shared/private/producer-identity.env
```

Use this loop rather than `set -a; . <file>`. The file's values are written without quotes, and
two of them hold spaces, so the shell would run the words after the first space as a command. On
a stand-in file of the same shape, this loop exported every value whole in both `zsh` and `bash`,
while `set -a; . <file>` failed in both (`command not found: PERSON` in zsh).

## 4. Prepare and sign

From the release worktree, with the town where you sign:

```sh
pnpm release prepare 1.0.0 --place "<town>"
```

It stops at the first thing that is wrong, and changes nothing until you sign. In order, it:

1. checks that the version looks like `1.2.3`, that you are on `release/1.0.0` with nothing
   uncommitted in files git tracks (untracked files are ignored), and that the branch is
   `origin/main`'s latest commit;
2. refuses a version that is already released, or that is not above the highest released one;
3. prints the whole declaration with your three settings filled in and today's date in Madrid;
4. asks you to type `yes`. Typing it is the producer signing; anything else stops with nothing
   written;
5. writes `declarations/v1.0.0.md`, commits it as "Release 1.0.0", pushes the branch and opens the
   pull request.

The committed file leaves the producer's three facts as blanks; the declaration printed in step 3
fills them from the settings in your shell.

## 5. Land the pull request

The release pull request lands like any other, after its CI.

## 6. Tag

From the main checkout, brought up to date, with the producer's settings loaded as in step 3:

```sh
cd ~/workspace/repos/waitron
git pull --ff-only
pnpm install
pnpm release tag 1.0.0
```

It refuses unless you are on `main` with no uncommitted change to a file git tracks (untracked
files are ignored here too), at `origin/main`'s latest commit; unless `main` holds
`declarations/v1.0.0.md`; unless that file still carries no blocker line and its name, system
code, version and yes/no answers still match the code; unless the version is still unreleased and above the highest released one; and unless
`main`'s CI run for that commit has finished green. Other pull requests can land between `prepare`
and `tag`, which is why it checks the declaration again. Then it makes the annotated tag
`v1.0.0` ("Waitron 1.0.0") and pushes it.

`main`'s green run proves less than it sounds: an ordinary push to `main` runs no package tests.
The tag's own CI run is the full one, and publishing the image waits for it.

The push goes through the repository's pre-push hook. Nobody has pushed a tag through it yet:
what it does with an annotated tag's id, which is the tag's own id rather than its commit's, was
read (`.husky/pre-push:24-40`), not run. If the push stops there, read the hook's message, and
never push with `--no-verify`.

## 7. Watch the tag's CI run

```sh
gh run list --workflow ci.yml --limit 5
gh run watch <run id>
```

Pick the run whose branch is `v1.0.0`. Its `publish` job publishes the image only after the whole
run is green.

## Read the draft before the blockers go

To read the whole declaration as it stands, blockers and all, run the package command with
`--draft`, after loading the settings as in step 3:

```sh
pnpm --filter @waitron/fiscal-verifactu declaration show --draft --version 1.0.0 --place "<town>" --date 2026-11-11
```

It prints the declaration, and each blocker line on the error output, and writes nothing. It needs
all of `--version`, `--place` and `--date`.

## When the producer or the system code changes

A release that changes the producer, or the two-character code that names the system, says so in
the first line of its pull request: every box that files opens a new installation when it is
upgraded to it. No such release is cut while A993 (the step that opens that new installation by
itself) is parked: until then a production box refuses to start under another producer's tax
number (`sif.producer_changed`). Going back to an older release across such a change is not done,
because it would open yet another installation.
