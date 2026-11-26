# Let WebKit setup fetch a missing Ubuntu package from another mirror

A1604 is done when the WebKit job gets past a package-file 404 on its retry mirror and
runs the browser checks. Both failures hit the first deadline on Azure, switched to
kernel.org, fetched release metadata there and received 404 for the same new Speex package.
The retry overwrote the whole mirror list with a single host, so APT had nowhere else to
fetch the file. Ubuntu published that version the day before, and both mirrors now serve
it. The reason the indexed file was missing at the time remains unverified.
[First job](https://github.com/clintongormley/waitron/actions/runs/45770349270/job/139741805685).
[Second job](https://github.com/clintongormley/waitron/actions/runs/45784713966/job/139788967340).
[Ubuntu publication](https://ubuntu.com/security/notices/USN-9197-1).

- Run the existing install step on a disposable Ubuntu 26.04 GitHub runner. Print its
  mirror list and APT version. Adapt #4176's fixture to hold a required download on the
  first mirror and return 404 for the exact requested `libspeex1` amd64v3 file on the retry.
  If the runner already has that package, use a required amd64v3 file it actually requests
  and record the filename. Forward signed metadata unchanged. Substitute only the retry
  mirror's address in the copied step. Require the first deadline and a failed retry with
  the exact controlled 404.
- In `.github/workflows/ci.yml`, keep the first attempt and existing host selection.
  Write the chosen mirror's HTTPS URL followed by a tab and `priority:1`. Add
  `https://archive.ubuntu.com/ubuntu/` followed by tabs and `priority:2`, `type:deb`.
  The runner list recorded in #4176 puts Azure first and the Canonical archive second.
  Restoring the entire list would put the already stalled Azure host back on the retry.
  Keep both 90-second budgets, bounded dpkg recovery and the existing retry for an unknown
  layout, a failed mirror-list write or no distinct host.
- Run the same hosted case again. Require the same first deadline and 404, a download
  of that exact file over HTTPS from Canonical within the retry, and its elapsed time.
  Run a clean hosted leg and require a first-attempt install. Both legs must pass eight
  theme tests per app and the full dashboard colour-field suite in WebKit. Record test
  counts and job IDs, run `pnpm exec vitest run scripts/ci-workflow.test.mjs` and check
  the selected PR CI jobs on the current head.

Update the mirror paragraph of `docs/developers/ci-and-gates.md` with the hosted receipts
and the absence of a permanent fallback guard. The disposable reproduction checks actual
APT behaviour. There is no A1604 backlog entry. Expect about 5 workflow lines, 0 committed
test lines and 8 guide lines. Scope is limited to WebKit dependency setup.
