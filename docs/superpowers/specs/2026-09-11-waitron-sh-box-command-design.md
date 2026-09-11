# One box command: `waitron.sh` with `install` and `reset`

**Date:** 2026-09-11
**Status:** design, awaiting owner review

## 1. Why

Setting up a box today, and testing a branch on it, takes three separate scripts under `deploy/`,
and none of them can undo what a branch does to the box's database:

- `install.sh` is a thin run-from-the-web wrapper. It downloads `prepare.sh` and the two files
  `prepare.sh` copies, then hands off.
- `prepare.sh` does the real work once per box: installs Docker, generates the one secret the box
  needs (the Postgres password) into `.env`, copies `compose.yml` next to it, and starts the
  containers. It never overwrites an existing `.env` or `compose.yml`.
- `try-branch.sh` builds a branch's image on the box and runs it, setting the image name inline on a
  single `docker compose up` so the box's `.env` is left untouched.

There is no command that puts the box back to a clean state. The only documented recovery from a
branch that changed the database is "restore from a backup or reinstall", and no script does either.
"Reinstall" in practice means hand-typing `docker compose down -v`, which no doc spells out.

The owner wants one downloadable script with two verbs:

```bash
curl -fsSL https://raw.githubusercontent.com/clintongormley/waitron/main/deploy/waitron.sh -o waitron.sh
sudo bash waitron.sh install            # install and start the published main image
sudo bash waitron.sh install my_branch  # build and start a branch's image, running its migrations
sudo bash waitron.sh reset              # wipe the database and settings, keep the certificate
sudo bash waitron.sh reset --all        # wipe everything including the certificate
```

## 2. What replaces what

`deploy/waitron.sh` is a new single script. `deploy/install.sh`, `deploy/prepare.sh` and
`deploy/try-branch.sh` are deleted. Everything those three did lives in `waitron.sh`, reachable
through the two verbs.

The script is run either straight from the web (downloaded to `waitron.sh`, then run) or from a
checkout (`deploy/waitron.sh …`). It stays non-interactive by default for `install`, because the
future bootable-USB installer runs it unattended. `WAITRON_DIR` still selects where the box's files
live, defaulting to `/opt/waitron`.

## 3. `install [ref]`

`ref` is any ref on the public repository — a branch name or a commit. It defaults to `main`.

The steps, in order:

1. **Install Docker if it is missing, and make it start on every boot.** This is `prepare.sh`'s
   current Docker block, unchanged: it recognises Debian and Ubuntu, adds the Docker apt repository,
   installs the engine and the compose plugin, installs `qrencode` for the finish banner, and enables
   the daemon. All escalation goes through `sudo -n` so an installer with no terminal never stalls on
   a password prompt.

2. **Create `.env` once, with the Postgres password, and never overwrite it after.** This is
   `prepare.sh`'s current password-minting block, unchanged: it generates the password with
   `openssl rand -hex 32`, writes it under a tight umask, never prints it, and checks the file is
   absent before writing so a re-run never mints a second password the existing cluster would reject.
   The password line is the one part of `.env` the script never touches once it exists.

3. **Fetch `compose.yml` and `.env.example` from the installed ref, overwriting the box's copies,
   and say so.** This is a deliberate change from today, where `prepare.sh` copies `compose.yml` only
   if it is missing. The compose file and the image must always come from the same commit, so a
   branch that changes the compose file is tested with that change. The only thing an operator loses
   is a hand edit to `compose.yml` itself, which is why the script prints one line saying it is
   overwriting the file. Operator settings live in `.env`, which is never overwritten.

   Both files are always fetched over the network from the ref, so there is one code path whether the
   script was downloaded on its own or run from a checkout. A developer iterating on an uncommitted
   compose change uses `pnpm build:image` and a local compose invocation instead, which this does not
   affect.

4. **Select the image and record the choice in `.env`.**
   - For `main`, the published image is used. The script removes any `WAITRON_IMAGE` and
     `WAITRON_PRINT_AGENT_IMAGE` lines from `.env`, so compose falls back to
     `ghcr.io/clintongormley/waitron:main` and the print-agent equivalent.
   - For any other ref, both images are built on the box from the git context
     (`https://github.com/clintongormley/waitron.git#<ref>`) with `deploy/Dockerfile`, tagged after
     the ref (unsafe characters dashed, capped to a valid Docker tag length) exactly as `try-branch.sh`
     does today. The script then writes those two tags into `.env` as `WAITRON_IMAGE` and
     `WAITRON_PRINT_AGENT_IMAGE`, replacing any existing lines.

   Recording the choice in `.env` is the second deliberate change from `try-branch.sh`, which set the
   image inline for one `docker compose up` so a later bare `docker compose up -d` silently dropped
   back to `:main`. With the choice in `.env`, the box stays on whatever was installed across reboots
   and manual compose commands, until the next `install` changes it. `install` with no argument is
   how you deliberately go back to `main`.

5. **Start the containers** with `docker compose up -d`, pulling first for `main`
   (`docker compose pull --ignore-pull-failures`, as `prepare.sh` does).

6. **Wait for the box to report healthy, then print the finish banner** (§6). If the box is not
   healthy within a few minutes, the script prints the app container's last log lines. If those
   contain `provisioning.database_ahead`, it names the cause — the database was migrated by a newer
   image than this ref — and gives advice that depends on the box (§5.1): on a box that is not
   production, run `waitron.sh reset` then install again; on a **production** box, do NOT reset,
   install a newer ref instead, because reset would destroy the fiscal ledger. The script reads the
   same environment signal `reset` uses (§4) to decide which advice to print, so it never tells a
   real box's operator to wipe it.

## 4. `reset [--all]`

`reset` wipes the box and brings it straight back up on whatever `.env` selects, so it lands in
setup mode ready for the wizard, with the same health wait and finish banner as `install`.

- **It refuses if the box was never installed** (no `WAITRON_DIR/compose.yml`), so a mistyped path
  cannot silently do nothing or half-act.
- **It refuses on a production box** (§4.1). This is the guard that matters, because a reset re-mints
  the AEAT chain (§5).
- **It confirms before wiping.** At a terminal it asks the operator to type `reset`. Run without a
  terminal (the unattended installer, a script) it requires `--yes`.
- **It stops the containers**, removes the volumes below with a throwaway container where a volume is
  emptied rather than dropped, then starts again.

Plain `reset` removes these volumes outright: `db`, `logs`, `media`, `backups`, `mailpit`,
`print_agent`. It empties the `state` volume of everything except its `tls/` folder. So the box
keeps the certificate authority the phone already trusts and its own leaf certificate, and loses its
identity files (`instance.env`, `trading.env`, `modules.json`, `backup.env`), the vault key
(`secrets.env`), and everything the wizard wrote. The vault key goes because the database it
protected is gone. The print agent's volume goes, so it re-joins on its own at the next boot, since
its server address is unchanged.

**This destroys the local backups too** (the `backups` volume), which is what would recover a real
box. That is safe only because `reset` refuses on a production box (§4.1); on a preproduction or demo
box the data, including its backups, is disposable by design (§5, one database per environment).

`reset --all` additionally removes the `state` volume, so the certificate authority is gone and a new
one is minted on the next boot. The phone has to trust the new authority once more. `--all` is no
more fiscally dangerous than plain `reset`: the chain, the installation counter and the environment
stamp all live in the `db` volume that both variants wipe, and `tls/` holds no fiscal state.

`.env` survives both, so the fresh cluster is created with the same Postgres password and the image
selection is preserved. Regenerating the password would buy nothing and would lock the box out of a
cluster that kept the old one. `.env` carries no environment or chain state: `WAITRON_ENV` is not in
it (it lives in `trading.env` in the wiped `state` volume), and the database's own environment stamp
goes with the `db` volume. So a reset box comes back unstamped, which the next boot defaults to
preproduction — the honest state for a box whose records are gone.

After the wipe, the next boot's wizard mints a **new** SIF installation number and starts a **new**
fiscal chain. This is §5's "reimaged box, new chain" path, which is why the production refusal below
exists: the path is correct for a box being rebuilt and destructive for one that has filed to AEAT.

### 4.1 The production refusal

Before touching anything, `reset` reads whether the box is stamped for production and refuses if it
is. Two signals, either of which meaning production is enough to refuse:

- `WAITRON_ENV=production` in `trading.env` in the `state` volume, read with a throwaway container so
  no database need be running (`writeTradingEnv`, `apps/server/src/trading-config.ts`).
- the database's own stamp, `select environment from deployment where id = 1`, the authority the box
  itself trusts (`packages/db/src/deployment.ts`). It is read when the cluster is reachable; the
  `trading.env` signal is the one that works with the box stopped.

A box that has never been provisioned has neither signal and resets freely — that is the whole demo
workflow. A production box always has both, because the wizard writes them before the box can file
anything.

On a production box the refusal explains that the box holds real fiscal records that cannot be
recreated and that the recovery for a broken production box is a backup restore, not a reset, then
exits non-zero. The only way past is deliberate and typed, mirroring §5's "`production` must be typed
out": the command must carry `--force-production`, and at a terminal the operator must also type the
word `production`. `--yes` alone never bypasses this guard; the unattended path cannot reset a
production box by accident.

## 5. What happens across migrations

The owner's question: what if a branch is based on an older `main`, and the box's database was
already migrated forward by a newer `main`?

The box refuses to boot, loudly, and nothing new is written by the check itself. On boot the branch's
image first applies any migrations it carries that the database lacks, then `assertNotAhead`
(`@waitron/provisioning`, called from `apps/server/src/node-entry.ts`) compares the database's
recorded migration hashes against the image's files. The newer `main` migration the database holds is
one the older image does not know, so the check throws `provisioning.database_ahead` and the recovery
page shows it. The script surfaces this in its health-wait failure path (§3, step 6). On a demo box
the fix is `reset` then `install <ref>`.

The other direction is the pre-existing one-way door, unchanged by this work: a branch that is
**ahead** of the running database migrates it forward normally, and there is no backward migration, so
going back to `:main` afterwards can then fail with the same `provisioning.database_ahead`. That is
exactly what `reset` gives a clean answer to on a demo box.

### 5.1 On a production box, `database_ahead` is never a reason to reset

The advice above is for a box whose data is disposable. On a production box, `database_ahead` means
the operator installed an **older** image than the database expects, and the fix is to install a newer
ref, never to wipe. Wiping would cut the AEAT chain and re-mint an installation number the tax agency
already holds — the collision the cold-restore installation-number floor exists to prevent, which a
reset has nothing left to floor from. So both places the script mentions reset — the `database_ahead`
banner (§3, step 6) and the `reset` command itself (§4.1) — read the box's environment first and
refuse or redirect on production. No such production box exists yet; the guard is here so the script
is still correct the day one does.

A related trap is already guarded and out of this work's scope: a branch whose new migration carries
a timestamp at or below `main`'s newest is skipped silently by the migration library, and
`scripts/journal-monotonic.test.ts` fails the PR before it can reach a box.

## 6. The finish banner

After `install` or `reset` brings the box up healthy, the script prints a short list of where to go,
the same list the setup wizard's finish screen shows (§7):

- **Set up:** `https://waitron.local`, with the QR code, which is what a fresh box serves.
- **Once set up:**
  - Till — `https://waitron.local`
  - Dashboard — `https://waitron.local/manage`
  - Email inbox — `https://waitron.local/manage/email`
  - Print agent — `http://waitron.local:9110`

The email inbox is inside the dashboard on purpose. Compose binds Mailpit's own site to the box
loopback only, so it is unreachable from the LAN; those messages carry password resets and invite
links, and an open Mailpit on the shop network would let anyone take over an account. The print
agent's page listens on every interface on port 9110 over plain HTTP and holds no secret — it shows
status and pairs a Bluetooth printer — so it is named directly.

## 7. The setup wizard's finish screen

`apps/setup/src/screens/done-screen.ts`, the screen that today offers "Reload to open the till" and a
link to set up backups, also lists the same four links: Till at the root, Dashboard at `/manage`,
Email inbox at `/manage/email`, and Print agent at the same host on port 9110 over plain HTTP. The
links are built from the page's own address so they are correct whether the phone reached the box as
`waitron.local` or by IP. The existing "Reload to open the till" button and backups link stay as they
are. The screen's test is extended to assert the four links are present.

This is the only change outside `deploy/` and the guards.

## 8. Guards and tests

`scripts/deploy-image-env.test.ts` reads the scripts as text. Its two describe-blocks for the
run-from-web installer and the try-a-branch helper are replaced by one for `waitron.sh`, and the
hostname block's `prepare.sh` read moves to `waitron.sh`:

- It is a bash script.
- It fetches the files it downloads from `raw.githubusercontent.com/clintongormley/waitron`.
- The install ref defaults to `main` and is overridable.
- For a branch ref it builds from the git context with `-f deploy/Dockerfile` and the
  `…waitron.git#<ref>` fragment taken from the argument, not a hardcoded ref.
- It records the image selection in `.env` — a `WAITRON_IMAGE=` write, not an inline-only override.
  This pins the behaviour change in §3, step 4.
- It honours `WAITRON_DIR`, defaulting to `/opt/waitron`.
- It reports a `waitron.sh:`-prefixed error to stderr when misused.
- The box hostname it puts in the QR / reach URL is the one `boot.ts` declares (moved here from the
  deleted `prepare.sh` read).

A new executable test in the root Vitest project runs `waitron.sh` under a stub `docker` and stub
`curl` placed first on `PATH`, which record their arguments to a file instead of doing anything, and
asserts what each verb does. Reading the script cannot prove that `reset` removes the right volumes;
running it can (CLAUDE.md §4, "Reading is not verification"):

- `install` (no arg) pulls, starts, and leaves no `WAITRON_IMAGE` line in `.env`.
- `install <ref>` builds both images from the git context, writes the two image lines into `.env`,
  and starts.
- `reset` (with `--yes`) stops, removes exactly `db logs media backups mailpit print_agent`, empties
  the `state` volume but leaves `tls/`, keeps `.env`, and starts.
- `reset --all` (with `--yes`) additionally removes the `state` volume.
- `reset` on a box with no `compose.yml` refuses.
- `reset` refuses, and removes no volume, when the box is stamped production — proven by seeding the
  stub with a `trading.env` carrying `WAITRON_ENV=production`, and again with the stub `docker`
  returning `production` for the deployment-stamp query. This is the fiscal guard (§4.1), so it is
  proven by the volumes staying untouched, not by reading the script.
- `reset --force-production --yes` on a production-stamped box does proceed, so the deliberate
  override is not dead.

`scripts/changed-scope.test.mjs` names `deploy/prepare.sh` in its image-input list; that becomes
`deploy/waitron.sh`. The classifier itself (`scripts/changed-scope.mjs`) matches the whole `deploy/`
directory, so it needs no logic change, only the comment that lists the files by name.

## 9. Docs and comments to update

- `deploy/README.md`: the new usage for both verbs, a "Resetting a demo box" section, and removal of
  the "Trying a branch before it merges" section (folded into `install <ref>`).
- Comments that name the deleted scripts: `deploy/compose.yml`, `deploy/.env.example`,
  `deploy/Dockerfile`, `apps/server/src/boot.ts` (the hostname-copy comment), and
  `scripts/changed-scope.mjs`.
- `CLAUDE.md`: the entry that calls `try-branch.sh` a one-way door is reworded for `install <ref>`,
  and it gains the fact that `reset` is the clean answer on a demo box.
- `docs/backlog.md`: the rows that describe the three scripts by name.

## 10. Out of scope

CI publishing an image per branch. The box builds a branch image in a few minutes at no CI cost, and
publishing on every pull-request push would lengthen the image job on every PR and fill the registry
with branch images nobody prunes. If it is ever wanted, `install <ref>` can try a pull before
building without the typed command changing.
