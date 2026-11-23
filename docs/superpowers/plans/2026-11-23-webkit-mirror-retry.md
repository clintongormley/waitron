# WebKit package mirror retry

When a GitHub runner's Ubuntu mirror stalls during WebKit setup, the existing second
attempt should fetch from another mirror and let the two theme checks run. In #4171, both
90-second attempts used the same EC2 host. A later job fetched 140 MB from Azure in two seconds.
[Failed job](https://github.com/clintongormley/waitron/actions/runs/45263235607/job/138004281816)
[Azure job](https://github.com/clintongormley/waitron/actions/runs/45263235607/job/138009511819)

- [ ] Run a scratch job on GitHub-hosted Ubuntu with the current install step. Point the
  runner's Ubuntu mirror list at a local HTTP fixture that forwards signed archive requests
  and holds a required `.deb` response open. Require two 90-second deadlines and a failed
  install. The fixture's request log must show the `.deb` request on both attempts.
- [ ] In `.github/workflows/ci.yml`, keep the first attempt on the runner's mirror list and
  the failed-attempt `dpkg --configure -a` recovery. If `ubuntu.sources` points at the runner's
  `/etc/apt/apt-mirrors.txt`, take the hostname from each mirror entry's URL field and choose
  the first absent hostname from `azure.archive.ubuntu.com` and `mirrors.edge.kernel.org`.
  Before the sole retry, log the chosen host and write its HTTPS archive URL to the list.
  If the source layout differs or neither host is available as a distinct option, log why and
  use the existing retry. Reuse the 90-second GNU timeout, APT configuration and Ubuntu source
  stanzas. The runner is disposable.
- [ ] Repeat the controlled stall with the candidate. Require one deadline, the `.deb`
  fetched from the chosen host in APT's log, and eight WebKit passes per app. A clean-path run
  must succeed on the runner's list. Run `pnpm exec vitest run scripts/ci-workflow.test.mjs`.
  Record the job IDs and observed behavior in `docs/developers/ci-and-gates.md`.

Expect about 18 added workflow lines, no committed test lines and a short guide update.
The probe is disposable. Cache, routes, suite selection and retry counts stay outside this change.
