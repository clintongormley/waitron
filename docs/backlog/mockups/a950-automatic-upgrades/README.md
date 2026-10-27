# A950: checking an update and returning to the previous version

[Design proposal](../../../superpowers/specs/2026-10-27-a950-automatic-upgrades-design.md)

These static illustrations show a proposed main-box update check and a completed return to
its previous version. They use example data and the repository's theme tokens. They do not
show a working updater or prove a filesystem rollback, payment recovery, backup publication
or two-box handover. No design or build approval is recorded.

- [Checking the new version](01-upgrade-check.png): orders and changes are paused. Returning
  to the previous version is an explicit action. Leaving the screen does not stop the checks.
- [Previous version running again](02-rollback-complete.png): this example has positive proof
  that the old state and service were restored. The failed version is not retried automatically.
  Uncertain or committed operations need their own state, defined in the design.

The two short filenames show English, light theme, 390 px. Each also has
`-<en|es>-<light|dark>-<390|1280>.png` variants. These cover layout at phone and desktop widths;
actual product accessibility and runtime qualification remain future build gates.

The first owner decision is whether rollback ends before the first live change or automatic
action, including a refund or fiscal filing that happens before the first new order. The design
recommends that boundary so accepted work cannot disappear. A healthy overnight check does not
expire just because staff arrive later, and opening the till alone does not commit the version.
All of that is a proposal awaiting the owner, not an implemented policy.
