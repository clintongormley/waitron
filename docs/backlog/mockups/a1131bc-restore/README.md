# A1131b/c mock-ups — Recover from backup first deletes the failed setup

Pictures for [the design](../../../superpowers/specs/2026-10-28-a1131bc-restore-replaces-setup-design.md),
revised 2026-10-29. Drawn in HTML with the apps' colour and spacing tokens, not screenshots, at phone
width (375 px); each has a light and a dark version, and the two confirmations have a Spanish twin.
Captions are in English. The blue outline marks what is new. The HTML generator is kept outside the
repository (`~/waitron-campaign/a1131bc-redesign-mockups-src/build.mjs`).

After the deletion the box restarts on the setup page's existing "Join or recover an existing
restaurant" screen, which does not change, so it has no picture.

| Picture | What it shows |
| --- | --- |
| [1-start-again.png](1-start-again.png) ([dark](1-start-again-dark.png), [Spanish](1-start-again-es.png)) | Start again on the repair page: no password and no item counts (design §9a) |
| [2-recover-confirm.png](2-recover-confirm.png) ([dark](2-recover-confirm-dark.png), [Spanish](2-recover-confirm-es.png)) | Recover from backup on the repair page: confirming deletes the setup before any backup is chosen (design §9b) |
| [3-refused-fault.png](3-refused-fault.png) ([dark](3-refused-fault-dark.png)) | Either button, when the setup database holds a record Waitron never deletes: neither is offered (design §9c, §1a) |
| [4-unreadable-setup.png](4-unreadable-setup.png) ([dark](4-unreadable-setup-dark.png)) | Question 2's answer A, approved 2026-10-29: a setup database the box cannot read (design §9d) |
