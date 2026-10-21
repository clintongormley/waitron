# A947 mock-ups — two local boxes, a spare that takes over

Pictures for [the A947 design](../../../superpowers/specs/2026-10-21-a947-two-box-failover-design.md).
Drawn in HTML with the apps' colour and spacing tokens, not screenshots; nothing here is built.
Screens are in Spanish, as staff see them; captions are in English. The HTML generator is kept
outside the repository. The installation code `06RB` follows A679's hour-code format; the value is illustrative.

| Picture | What it shows |
| --- | --- |
| [1-main-not-answering.png](1-main-not-answering.png) | The main box stops answering: A798's red strip on every till and handheld, «Cambiar al equipo de reserva» for a manager only, «Avisa al encargado» for everyone else (a manager is anyone holding `node.promote`), selling buttons quiet (§6.1) |
| [2-take-over-dialog.png](2-take-over-dialog.png) | The switch: unplug the main box, type the main box's installation code from its recovery sheet (A679; what promotion asks is still open there), the manager's password and authenticator code; the refusal when another till still reaches the main box, with the hand-over offered; and the progress after «Cambiar» (§6.2–§6.4) |
| [3-servers-screen.png](3-servers-screen.png) | Both boxes on the dashboard's Servers screen, and the "Equipo de reserva" row on A798's Box status page when the spare falls behind (§5) |
| [4-old-main-returns.png](4-old-main-returns.png) | The old main box's own screen when it comes back: replaced, its kept sales handed over, «Convertir en equipo de reserva» for a manager; and the same screen when it cannot reach the new main box (§7) |
| [5-q1-who-switches.png](5-q1-who-switches.png) | Question 1's worked example: the same Friday evening with a manager switching, and with the boxes switching by themselves (§12) |
