# Cut a release

A release is a numbered version of Waitron, such as `1.0.0`, that boxes in production run. The law
asks the software's producer to write a declaration for every version and keep it visible in the
software: a statement, in Spanish, that this version meets the Veri\*Factu rules (the
*declaración responsable*). It names the date and place it was made, and needs no electronic
signature. Each version's text is committed as
`packages/fiscal-verifactu/declarations/v<version>.md`, and a release is cut by the owner, or by a
lane on the owner's instruction, in two commands: `pnpm release prepare` writes that file and opens a pull request for it,
and `pnpm release tag` puts the version's name (a git tag, `v1.0.0`) on `main` once that pull
request has landed.

## No release can be cut yet

Both commands refuse today, on purpose. The declaration's template,
[`template.md`](../../packages/fiscal-verifactu/declarations/template.md), opens with a
"release blocker" line, and the package command both release commands call refuses while one is
present, answering `declaration.release_blocked {"count":1}`.

The line is for the asesor's question Q53. Item d) of the declaration, which lists what the system
is made of, is still the draft sent to the asesor (the tax adviser) as Q53. Whoever records the
asesor's answer replaces item d) with the answered wording, keeping the cloud-server phrase and the
spare-server sentence only if the version can do them, and deletes the line.

Never push a `v*` tag by hand (`git tag v1.0.0 && git push origin v1.0.0`). The two commands check
what they can before the tag exists, and a tag pushed by hand skips those checks. CI then refuses to
publish a tag that is not on a commit of `main`, whose name is not `v` followed by a version such as
`1.0.0`, whose declaration file is missing, still carries a blocker line or disagrees with the
code, or whose version is already published.

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
- Item d) still names every service of ours that this version can call in production. A release
  that adds one changes item d) and has its wording checked again.
- AEAT's frequently asked questions about the declaration, and its worked example, are read again
  for changes ([our notes on them](../compliance/verifactu-faq-notes.md)).
- The repository is still public (`gh repo view clintongormley/waitron --json visibility` answers
  `"visibility":"PUBLIC"`). The declaration's annex item 2.b) links its releases page, the public
  archive of every declaration. If the repository is not public, stop: the
  declarations move to a public place first, and this version's item 2.b) names the new address.

## 3. Load the producer's settings

The declaration names its producer by name, tax number and postal address, read from three
settings: `WAITRON_PRODUCER_NAME`, `WAITRON_PRODUCER_TAX_ID` and `WAITRON_PRODUCER_ADDRESS`. Their
real values are kept in `~/waitron-campaign-shared/private/producer-identity.env` and are never
committed. Load them into the shell that will run `prepare`, without printing them:

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

If `prepare` stops after you typed `yes`, at the push or at opening the pull request, the commit
is already made. The branch is then ahead of `origin/main`, so running `prepare` again refuses
(`release/1.0.0 must point at origin/main`). Run `git log -1 --stat`: if the last commit is
"Release 1.0.0" adding `declarations/v1.0.0.md`, fix what stopped it and finish by hand. Skip the
push if `git status` says the branch is up to date with `origin/release/1.0.0`:

```sh
git push -u origin release/1.0.0
gh pr create --base main --title "Release 1.0.0" --body 'Adds packages/fiscal-verifactu/declarations/v1.0.0.md, the declaration for Waitron 1.0.0, which the producer read and signed with `pnpm release prepare`.'
```

## 5. Land the pull request

The release pull request that `pnpm release prepare` opened goes through `/finish-branch` like any
branch, on the light review path when it touches no risk trigger, and lands only after that, never
on green CI alone. The reason: the review seat that runs the change runs on every branch (the
owner's standing rule), a generated declaration file is no exception, and the declaration is the
legal document the producer signs. Source: the watcher's decision of 2026-11-11 15:53, in lane A's
`~/waitron-campaign/questions.md`.

## 6. Tag

From the main checkout, brought up to date (`tag` does not read the producer's settings):

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

The push goes through the repository's pre-push hook, whose messages are printed as it runs.
Nobody has pushed a tag through it yet: what it does with an annotated tag's id, which is the
tag's own id rather than its commit's, was read (`.husky/pre-push:24-40`), not run. If the push
stops, the command deletes the tag it made on your machine; fix what the push's messages name and
run `pnpm release tag 1.0.0` again. If that run says `1.0.0 is already released`, the tag reached
GitHub before the push stopped: go on to step 7. Never push with `--no-verify`.

## 7. Watch the tag's CI run

```sh
gh run list --workflow ci.yml --limit 5
gh run watch <run id>
```

Pick the run whose branch is `v1.0.0`. It runs every check, as the nightly run does, and then
two jobs make the release:

1. **`publish`** waits for the whole run to be green. It refuses a tag that is not on `main` or
   whose name is not a release version, then builds the image with the version stamped in. The
   build renders the version's declaration into `/app/declaration/`, and fails if the committed
   `declarations/v1.0.0.md` is missing, carries a blocker line or disagrees with the code. It runs
   `check-release 1.0.0` inside the built image, refuses a version the registry already holds, and
   only then pushes `ghcr.io/clintongormley/waitron:1.0.0` and the print agent's `:1.0.0`.
2. **`release`** pulls that published image, copies its declaration's PDF and plain text out of
   it, and attaches them to the GitHub Release `v1.0.0` as `waitron-1.0.0-declaration.pdf` and
   `waitron-1.0.0-declaration.txt`, making the Release if there is none. Because the files come
   out of the published image, they are the same bytes every box running `1.0.0` serves.

Check the Release once the run is green:

```sh
gh release view v1.0.0
```

It should list both files. Open the PDF and check that it names version `1.0.0`, the producer and
the date you signed.

If `release` fails, for example on a network error, re-run only the failed job:

```sh
gh run rerun <run id> --failed
```

That repeats the upload and replaces the two files from the image the tag names. Do not re-run the
whole workflow: its `publish` job stops, because the version is already published, and `release`
never runs.

## 8. Install the release on a box

On the box, give `waitron.sh install` the tag:

```sh
sudo bash waitron.sh install v1.0.0
```

It pulls the published images for `1.0.0` rather than building anything, and pins them in the
box's `.env`, so the box stays on that release. A production box starts only on a release: on any
other build its start stops on the recovery page with `server.unreleased_build`. The box's own
steps are in [the deploy guide](../../deploy/README.md#installing-a-release).

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
the first line of its pull request. No such release is cut while A993 is parked: until then a
production box refuses to start under another producer's tax number (`sif.producer_changed`), and
nothing opens the new installation such a change needs.
