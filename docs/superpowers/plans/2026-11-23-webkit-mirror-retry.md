# WebKit package mirror retry

When a GitHub runner's Ubuntu mirror stalls during WebKit setup, the existing second
attempt should fetch from another mirror and let the two theme checks run. In #4171, both
90-second attempts used the same EC2 host. A later job fetched 140 MB from Azure in two seconds.
[Failed job](https://github.com/clintongormley/waitron/actions/runs/45263235607/job/138004281816)
[Azure job](https://github.com/clintongormley/waitron/actions/runs/45263235607/job/138009511819)

- [ ] Run a scratch job on GitHub-hosted Ubuntu with the current install step. Point the
  runner's Ubuntu mirror list at a local HTTP fixture that forwards signed archive requests
  and holds a required `.deb` response open. The control must reach the 90-second deadline
  twice, report the same mirror on both attempts and fail the install.
- [ ] In `.github/workflows/ci.yml`, keep the first attempt on the runner's mirror list and
  the failed-attempt `dpkg --configure -a` recovery. Before the sole retry, replace the hosted
  runner's `/etc/apt/apt-mirrors.txt` with one Ubuntu mirror whose hostname is absent from the
  original list. Try `azure.archive.ubuntu.com` first, then `us.archive.ubuntu.com`. Print the
  chosen host and fail clearly if neither is distinct. Reuse the same 90-second GNU timeout,
  APT configuration and Ubuntu source stanzas. The job uses a disposable runner.
- [ ] Repeat the controlled stall with the candidate. Require one deadline, a successful
  fetch through the second mirror and eight WebKit passes per app. A clean-path run must
  show the install succeeding on the runner's list. Run `pnpm exec vitest run scripts/ci-workflow.test.mjs`.
  Record the job IDs and observed behavior in `docs/developers/ci-and-gates.md`.

Expect 10–16 added workflow lines, no committed test lines and a short guide update.
The probe is disposable. Cache, routes, suite selection and retry counts stay outside this change.
