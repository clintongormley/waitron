# A947 mock-ups — two local boxes, a spare that takes over

Pictures for [the A947 design](../../../superpowers/specs/2026-10-21-a947-two-box-failover-design.md).
Drawn in HTML with the apps' colour and spacing tokens, not screenshots; nothing here is built.
Screens are in Spanish, as staff see them; captions are in English. The HTML generator is kept
outside the repository. The installation codes (`0CNNW`, `0CZZW`, `0D00B`, `0D0RY`) are the
design's §6.5 five-symbol UTC-minute codes; the Friday is 23 October 2026, Madrid time. Pictures 2
and 4 were redrawn on 2026-10-21 for the owner's answers, and 6 and 7 added then; 2 and 6 were
redrawn again the same evening for the second revision (the owner's 22:25 answers). Picture 5
keeps question 1 as it was asked, with A679's old wording.

| Picture | What it shows |
| --- | --- |
| [1-main-not-answering.png](1-main-not-answering.png) | The main box stops answering: A798's red strip on every till and handheld, «Cambiar al equipo de reserva» for a manager only, «Avisa al encargado» for everyone else (a manager is anyone holding `node.promote`), selling buttons quiet (§6.1) |
| [2-take-over-dialog.png](2-take-over-dialog.png) | The switch: unplug the main box, nobody else recovering a box, the clocks compared, and the manager's own sign-in — a passkey («llave de acceso»), or a password plus the authenticator code for someone who has one; no recovery-sheet code, no emergency key. The refusal when another till still reaches the main box, with the hand-over offered; and the progress after «Cambiar», naming the new series `A-0CZZW` (§6.2–§6.5) |
| [3-servers-screen.png](3-servers-screen.png) | Both boxes on the dashboard's Servers screen, and the "Equipo de reserva" row on A798's Box status page when the spare falls behind (§5) |
| [4-old-main-returns.png](4-old-main-returns.png) | The old main box's own screen when it comes back: replaced, its kept sales handed over, the three checks (the new main box holds every sale, count and fingerprint; the new main box is healthy; this box's database archived), then it becomes the spare by itself. A failed health check, which a manager may override, and a failed record check, which nobody may (§7.2) |
| [5-q1-who-switches.png](5-q1-who-switches.png) | Question 1's worked example, as it was asked: the same Friday evening with a manager switching, and with the boxes switching by themselves (§12). Its proof line (installation code, password and code) is superseded by picture 2 |
| [6-switch-series-worked-example.png](6-switch-series-worked-example.png) | Every series name, five symbols for the UTC minute: Friday 21:40 a switch takes `0CZZW`, 21:55 a second takes `0D00B` at once, a third in the same minute would wait 2 seconds for `0D00C`; Saturday's restore from an old backup with the box's clock wrong, refused, then `0D0RY` once the clock is right; the rules and what AEAT sees (§6.5, §6.7) |
| [7-reaching-the-switch.png](7-reaching-the-switch.png) | Reaching the switch from any device: the QR label on each box, a reloaded handheld landing on the spare's switch page at `waitron.local`, and which sign-ins work with the internet down (§6.6) |
