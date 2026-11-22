# Cut a release

A release is a numbered version of Waitron, such as `0.1.0`, that boxes in production run. The law
asks the software's producer to write a declaration for every version and keep it visible in the
software: a statement, in Spanish, that this version meets the Veri\*Factu rules (the
*declaración responsable*). It names the date and place it was made, and needs no electronic
signature. Each version's text is committed as
`packages/fiscal-verifactu/declarations/v<version>.md`, and a release is cut by the owner, or by a
lane on the owner's instruction, in two commands: `pnpm release prepare` writes that file and opens a pull request for it,
and `pnpm release tag` puts the version's name (a git tag, `v0.1.0`) on the release branch tip once that pull
request has landed. Use `main` for new releases and a protected maintenance branch for an older release line.

## The declaration's item d)

Version 0.1.0's declaration uses the earlier draft of item d), which lists what the system is made
of (question 9 of the [19 November adviser sheet](../compliance/2026-11-19-adviser-meeting.md), Q53
before it), without its cloud-server phrase and without saying that `@waitron/verifactu` has its
own declaration: this version cannot run in Waitron Cloud, and the library's 0.2.1 has none (owner,
22 November: "Just put in whatever we have for now, we can update it later"). The asesor's (tax
adviser's) answer goes into the template for a later version, since a released version's
declaration never changes. The spare-server sentence stays: this version can add a spare box and
switch to it (A947). A line of the form `<!-- release-blocker: … -->` anywhere in
[`template.md`](../../packages/fiscal-verifactu/declarations/template.md) still makes
`pnpm release prepare` refuse, answering `declaration.release_blocked` with the number of such
lines; `pnpm release tag` refuses a written `v<version>.md` that carries one.

Never push a `v*` tag by hand (`git tag v0.1.0 && git push origin v0.1.0`). The two commands check
what they can before the tag exists, and a tag pushed by hand skips those checks. CI then refuses to
publish a tag unless its commit qualifies through `main` or a protected maintenance branch. It
also checks the tag name and annotation, the declaration and the registry before publishing.

## Set up signing before the first signed release

The repository owner sets up signing. Do it before cutting the release so its tag
includes both trusted public keys.

1. Generate two Ed25519 key pairs outside the checkout. Use one as the current key
   and keep the spare private key offline. You can export the public half of either
   pair with `openssl pkey -in <private-key.pem> -pubout`.
2. In GitHub's repository settings, create the `release` environment. Under
   **Deployment branches and tags**, select **Selected branches and tags** and add
   a single **Tag** rule matching `v*`. Read both settings back from the checkout.

   ```sh
   gh api 'repos/{owner}/{repo}/environments/release' --jq '.deployment_branch_policy'
   gh api 'repos/{owner}/{repo}/environments/release/deployment-branch-policies' --paginate --jq '.branch_policies[] | [.type, .name] | @tsv'
   ```

   The first command should show `custom_branch_policies: true` and
   `protected_branches: false`. The second should show one row with `tag` and `v*`.
   [GitHub's deployment branch and tag policies](https://docs.github.com/en/rest/deployments/branch-policies)
3. Once those rules are in place, put the current private key in the `release`
   environment's `WAITRON_RELEASE_SIGNING_KEY` secret. For example, run
   `gh secret set WAITRON_RELEASE_SIGNING_KEY --env release < /path/to/current-private.pem`.
4. Open a pull request with the public keys in
   `deploy/box/release-keys/current.pem` and `deploy/box/release-keys/spare.pem`.
   Wait for the keys to land on main before tagging a release.

The release job skips signing while both public keys and the secret are absent.
A missing key or a secret that matches neither public key fails signing after the
job has attached the declaration. The two public keys must be distinct.

Before publishing the first signed release, wait for the app, print agent and tunnel
digests to be included in its signed file. Seed test boxes with the matching installer
and verifier through the published main image or the USB recipe.

To rotate a key, keep the other trusted key in both sets. Sign the release carrying the
updated keys with that shared key. A box must complete a checked upgrade to that release
before it can accept a release signed only by the new key.

If a verifier needs another file, add it to the download list in `deploy/waitron.sh`
and the recipe list in `deploy/box/build.sh` one release before the verifier uses it.
The box uses its retained installer to download trust files, so it learns the expanded
list on that first upgrade. Keep the same keys in the release that introduces the file.
Upgrade through that release on any box whose installer still has the earlier list.

## 1. Make the release worktree

`prepare` runs only on a branch named `release/<version>` whose last commit is `main`'s latest,
with nothing uncommitted. The worktree script starts a new branch from the main checkout's current
commit, so bring the main checkout up to date first:

```sh
git -C ~/workspace/repos/waitron pull --ff-only
python3 ~/workspace/tools/worktree.py new waitron release/0.1.0 --headless
cd ~/workspace/worktrees/waitron-release-0.1.0
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
pnpm release prepare 0.1.0 --place "<town>"
```

It stops at the first thing that is wrong, and changes nothing until you sign. In order, it:

1. checks that the version looks like `1.2.3` or `1.2.3-rc.1`, that you are on `release/0.1.0` with nothing
   uncommitted in files git tracks (untracked files are ignored), and that the branch is
   `origin/main`'s latest commit;
2. refuses a version that is already released, or that is not above the highest released one;
3. prints the whole declaration with your three settings filled in and today's date in Madrid;
4. asks you to type `yes`. Typing it is the producer signing; anything else stops with nothing
   written;
5. writes `declarations/v0.1.0.md`, commits it as "Release 0.1.0", pushes the branch and opens the
   pull request.

The committed file leaves the producer's three facts as blanks; the declaration printed in step 3
fills them from the settings in your shell.

If `prepare` stops after you typed `yes`, at the push or at opening the pull request, the commit
is already made. The branch is then ahead of `origin/main`, so running `prepare` again refuses
(`release/0.1.0 must point at origin/main`). Run `git log -1 --stat`: if the last commit is
"Release 0.1.0" adding `declarations/v0.1.0.md`, fix what stopped it and finish by hand. Skip the
push if `git status` says the branch is up to date with `origin/release/0.1.0`:

```sh
git push -u origin release/0.1.0
gh pr create --base main --title "Release 0.1.0" --body 'Adds packages/fiscal-verifactu/declarations/v0.1.0.md, the declaration for Waitron 0.1.0, which the producer read and signed with `pnpm release prepare`.'
```

## 5. Land the pull request

For a release on `main`, the pull request that `pnpm release prepare` opened goes through
`/finish-branch` like any branch, on the light review path when it touches no risk trigger, and lands only after that, never
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
pnpm release tag 0.1.0
```

It refuses unless you are on `main` with no uncommitted change to a file git tracks (untracked
files are ignored here too), at `origin/main`'s latest commit; unless `main` holds
`declarations/v0.1.0.md`; unless that file still carries no blocker line and its name, system
code, version and yes/no answers still match the code; unless the version is still unreleased and above the highest released one; and unless
`main`'s CI run for that commit has finished green. Other pull requests can land between `prepare`
and `tag`, which is why it checks the declaration again. Then it makes the annotated tag
`v0.1.0` ("Waitron 0.1.0") and pushes it.

To publish a version for manual installation only, give it a suffix such as `1.3.0-rc.1`.
Use the full version in the branch name, in `pnpm release prepare 1.3.0-rc.1 --place …` and,
once its declaration has landed, in `pnpm release tag 1.3.0-rc.1`. The tag is `v1.3.0-rc.1`
and its annotation is “Waitron prerelease 1.3.0-rc.1”. You can use `-alpha.N`, `-beta.N` or
`-rc.N`. Each number can be zero. Leave off any leading zeroes and keep the full version within
50 characters.

On `main`, each version must be above every version already tagged. Compare the three version numbers first. For the same
three numbers, alpha comes before beta, then release candidates, then stable. Within each
suffix, the largest sequence number comes last. After `1.3.0-rc.1` you can prepare
`1.3.0-rc.2` or `1.3.0`. A `1.2.1` patch is below that candidate and the command refuses it.
If you abandon a prepared version before tagging it, remove its declaration from the target branch
through a pull request before preparing the next one. Once tagged, keep the tag and its
declaration fixed. CI checks that the annotation agrees with the version and passes the
prerelease flag to the GitHub Release and signed release file.

`main`'s green run proves less than it sounds: an ordinary push to `main` runs no package tests.
The tag's own CI run is the full one, and publishing the image waits for it.

The push goes through the repository's pre-push hook, whose messages are printed as it runs.
Nobody has pushed a tag through it yet: what it does with an annotated tag's id, which is the
tag's own id rather than its commit's, was read (`.husky/pre-push:24-40`), not run. If the push
stops, the command deletes the tag it made on your machine. Fix what the push's messages name and
repeat your tag command with the same version. If that run says `0.1.0 is already released`, the tag reached
GitHub before the push stopped: go on to step 7. Never push with `--no-verify`.

## Cut a release on an older line

Before creating the first maintenance branch, the repository owner adds an **active branch
ruleset** targeting `refs/heads/maintenance/*`. Use these settings:

- Restrict creations and deletions, and block force pushes.
- Require a pull request before merging. Allow squash and rebase merges, dismiss stale approvals,
  and require all conversations to be resolved, as on `main`.
- Require the `ci` status check and require branches to be up to date before merging.
- Let the repository administrator bypass the creation restriction to create the branch at the
  older release tag. Use pull requests for later changes, including the declaration.

You can read the active rules for a branch before creating it with
`gh api 'repos/{owner}/{repo}/rules/branches/maintenance%2F1.x'`. GitHub composes all applicable
active rules. [GitHub branch rules API](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch)

For example, the administrator creates `maintenance/1.x` at `v1.2.0`. Land your fix there. Carry
it forward to each newer branch that needs it with `git cherry-pick`. Keep the release histories
separate so a tag keeps its source branch on a publish retry. If the older release predates this
tooling, backport the release commands and CI to the maintenance branch before using them.

Start `release/1.2.1` at the current `origin/maintenance/1.x` tip. Run
`pnpm release prepare 1.2.1 --base maintenance/1.x --place "<town>"`, and land the declaration
pull request against `maintenance/1.x` after review and green CI. Keep that review and the
pull request based on the maintenance branch. Switch to that branch, update it to the remote tip, and
run `pnpm release tag 1.2.1`. Both commands require that the branch contain the latest stable
release below the version you are preparing. Tag also requires a green push run for that exact
tip. A maintenance release keeps the major version of its original release tag. You can cut a
new minor from that line the same way.

Use the release command for every tag. Only the command verifies that the branch contains the
latest lower stable release. The publish step checks the tagged commit's history so a later tag from a
sibling branch leaves the original release eligible for a publish retry.

Keep the branch and its original tag so GitHub can still publish the version if a job needs a
retry. If you need to retry a release from earlier main, use its existing tag and run.

## 7. Watch the tag's CI run

```sh
gh run list --workflow ci.yml --limit 5
gh run watch <run id>
```

Pick the run whose branch is `v0.1.0`. It runs every check, as the nightly run does, and then
two jobs make the release:

1. **`publish`** waits for the whole run to be green. It requires a tag named `v` followed by the full version,
   with the matching annotation from step 6 and a direct pointer to a qualifying commit. The commit
   must contain no other release tag for the same or a higher version and be on `main` or on a protected maintenance
   branch that forked from `main` at a lower release tag. It then builds the
   image with the version stamped in. The build renders the version's declaration into
   `/app/declaration/` and fails if the committed `declarations/v0.1.0.md` is missing, carries a
   blocker line or disagrees with the code. It runs `check-release 0.1.0` inside the built image,
   refuses a version the registry already holds, and
   only then pushes the print agent and tunnel companion's `:0.1.0` tags. It pushes the app last.
2. **`release`** pulls the published app image by its digest, copies its declaration's PDF and plain text out of
   it, and attaches them to the GitHub Release `v0.1.0` as `waitron-0.1.0-declaration.pdf` and
   `waitron-0.1.0-declaration.txt`, making the Release if there is none. Because the files come
   out of the published image, they are the same bytes every box running that image serves.
   For a version with a prerelease suffix, this job creates a GitHub prerelease. A prerelease or
   maintenance release leaves GitHub's Latest slot alone.
   When signing is configured, it also attaches `waitron-release.json`. The signed
   payload names the release, its prerelease flag, the source commit and the app, print agent and
   tunnel image digests.

Check the Release once the run is green:

```sh
gh release view v0.1.0
```

Check for both declaration files and, after signing is set up, `waitron-release.json`. Open the PDF and check that it names version `0.1.0`, the producer and
the date you signed.

If `release` fails, for example on a network error, re-run only the failed job:

```sh
gh run rerun <run id> --failed
```

That repeats the declaration upload from the same app digest. The signed file is
kept if its bytes match and the job fails if they differ, including if the signing
key changed between attempts. Re-run only the failed job because `publish` refuses
to push a version the registry already holds. For a signing setup error, restore a
secret matching one of the keys in the tagged commit before retrying. If the tag
lacks two valid, distinct public keys, cut a new numbered release after you
correct the keys on the release branch.

If the existing GitHub Release has a different prerelease flag, check the tag's annotation and
the signed file if one exists. If the two disagree, preserve the signed file and cut a new
numbered release. Otherwise, restore the Release's flag to match the annotation and retry.

If `publish` fails while pushing, re-run it with `gh run rerun <run id> --failed`. The app image is
pushed last, so a run that stopped before that push has not published the version, and the re-run
pushes all three images.

## 8. Install the release on a box

On the box, give the retained installer the release tag.

```sh
sudo bash /opt/waitron-host/waitron.sh install v0.1.0
```

The installer verifies the signed release file with the public keys already on the box and
pulls the three images it names by digest. If your box has an earlier verifier, use the checked
main upgrade in the deploy guide to update the retained verifier and keys. [Install a release](../../deploy/README.md#installing-a-release)

For the first publication of the tunnel companion, run full verification on main after merging.
Before a fresh `install main`, check that a box without registry credentials can pull
`ghcr.io/clintongormley/waitron-tunnel:main`. If GHCR refuses the pull because the package is
private, make the companion package public and check the pull again.
Use the full tag for a signed prerelease. Update the retained installer and verifier first.
Before asking a production venue with an older installer to try a prerelease, publish a
stable release that includes suffix support so the venue can update its installer.
[Install a release](../../deploy/README.md#installing-a-release)

```sh
sudo bash /opt/waitron-host/waitron.sh install v1.3.0-rc.1
```

## Offer a release to a group

Once a stable release includes the publication workflow and has a signed
`waitron-release.json`, use that tag to publish an upgrade offer. First create the
dedicated `upgrade-offer` release once. Keep it out of the latest-release slot so
operators still see the latest numbered release.

```sh
gh release create upgrade-offer --latest=false --title "Waitron upgrade offer" \
  --notes "Holds the signed upgrade offer for Waitron boxes."
```

Pass one JSON value as the workflow input. In this example the first 10% of boxes
for version 1.4.0 get that version and everyone else can move to 1.3.0.

```sh
gh workflow run publish-upgrade-offer.yml --ref v1.4.0 \
  -f 'offer={"format":1,"entries":[{"condition":{"bucketBelow":10},"target":"1.4.0"}],"default":"1.3.0"}'
```

The first matching entry supplies the version. Use `installations` with a list of
box IDs or `atLeast` with an installed version to name another group. Use `none`
as a target to pause a group. For a paused percentage group, keep the version
that defined its membership in the condition's `bucketVersion`. To pause
everyone, dispatch `{"format":1,"entries":[],"default":"none"}`.

Use stable versions for the dispatch tag, offer targets, `atLeast` and `bucketVersion`.
A box on `1.3.0-rc.1` is below `atLeast: "1.3.0"` and continues through the remaining rules.
The workflow checks the dispatch tag's signed release file and checks that every target is
published, signed, and stable. It writes only `waitron-offer.json` on
the `upgrade-offer` release, then reads it back to compare the exact bytes. The
workflow run number is the offer's serial. Keep the workflow at
`.github/workflows/publish-upgrade-offer.yml` so that its run numbers continue
the sequence boxes already remember. Wait for the run to finish and check its
uploaded serial, conditions and targets before dispatching another change.
[GitHub Actions run numbers](https://docs.github.com/en/actions/reference/workflows-and-actions/variables#default-environment-variables)

```sh
gh run watch <run-id> --exit-status
gh release download upgrade-offer --pattern waitron-offer.json --output - |
  node -p 'JSON.stringify(JSON.parse(Buffer.from(JSON.parse(require("node:fs").readFileSync(0)).payload, "base64url")), null, 2)'
```

GitHub CLI removes the old asset before uploading its replacement. If a run
fails and the asset is missing, dispatch a new run to get a new serial. Cancel
outstanding publication runs before an emergency pause. Once those runs have stopped, remove
the asset and dispatch the empty offer with default `none`. Before retiring a
signing key, publish the offer again with the key both releases trust so the next
publisher can verify the file it is replacing. [GitHub CLI release upload](https://cli.github.com/manual/gh_release_upload)

## Read the declaration without signing

To read the whole declaration as it stands, with any blocker lines listed, run the package command
with `--draft`, after loading the settings as in step 3:

```sh
pnpm --filter @waitron/fiscal-verifactu declaration show --draft --version 0.1.0 --place "<town>" --date 2026-11-11
```

It prints the declaration, and each blocker line on the error output, and writes nothing. It needs
all of `--version`, `--place` and `--date`.

## When the producer or the system code changes

A release that changes the producer, or the two-character code that names the system, says so in
the first line of its pull request. No such release is cut while A993 is parked: until then a
production box refuses to start under another producer's tax number (`sif.producer_changed`), and
nothing opens the new installation such a change needs.
