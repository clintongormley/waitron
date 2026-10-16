# Six choices before A773-1 continues

Written 2026-10-16 after you asked for more context and mock-ups for the plan's six open points.
**Every option below is a proposal awaiting your answer.** A is the plan's earlier default;
that does not make it approved. The pictures show worked examples and illustrative wording.
They are drawings, not screenshots of implemented behaviour.

Use the same table throughout: Table 4, with Starters not held, Mains and Desserts held.
New Croquetas go to Fire now; new Solomillo joins a held Mains group when one exists.

| Choice | Picture                                                   | A: plan proposal                                                                          | B: alternative                                                                              |
| ------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1 of 6 | [Held groups in two places](01-current-orders.png)        | Keep held groups in the arranged list and Current orders until A738 reviews the drawer.   | Remove the drawer's duplicate held groups now; keep serving and reminders there.            |
| 2 of 6 | [New and sent selections](02-mixed-ticks.png)             | Select new dishes or sent held dishes at a time; selecting one kind clears the other.     | Keep a mixed selection and handle both kinds in one action, explaining any partial success. |
| 3 of 6 | [A bill paid before Send](03-paid-bill.png)               | Send on the open main bill, making one if needed, follow it and show a notice.            | Stop, keep every line unsent and ask you to choose an open bill before sending again.       |
| 4 of 6 | [Changes after sending](04-changes-after-sending.png)     | Use the shared venue setting temporarily, until A756 gives stations their own.            | Wait for A756 before enabling sent-line selection.                                          |
| 5 of 6 | [Where the course switch lives](05-course-switch.png)     | Add the switch to the existing course list, then move it with A756.                       | Introduce the switch only on A756's dedicated Courses page.                                 |
| 6 of 6 | [A group fired by another waiter](06-fired-under-you.png) | Move its new lines to Fire now, send nothing from that attempt and ask you to send again. | Move them to a fresh held group instead, still asking you to send again.                    |

In choice 3, Bill 2 is the main bill that remains open. In choice 6, neither option silently
sends the Solomillo when another waiter has already fired its destination. B changes the recovery
specified in [spec §10](../../../superpowers/specs/2026-10-16-a773-courses-and-groups-design.md#10-edge-cases);
it is drawn for your decision, not accepted as a spec change.

Choice 5's existing-list switch is already committed on the **unlanded** A773-1 feature branch
(`7d3bd79fff1ae47c7675a56a22a506fe773f09af`, plan Task 1). You can still change that choice;
its presence on the branch is not approval. No dependent task may treat it as approved.

The questions are numbered identically in lane G's local `questions.md` for the watcher to deliver
with the PNGs. The editable SVG beside each PNG contains the same drawing. Colours follow the light
palette in `packages/ui-core/src/tokens/colors.css`; the layout follows the earlier
[A773 boards](../a773-courses-and-groups/).

For the next implementer, apply the owner's answers before the affected tasks in the
[plan](../../../superpowers/plans/2026-10-16-a773-1-unsent-list.md). In particular, the paid-bill
fallback affects Tasks 3 and 10; stale-group recovery affects Tasks 2, 7 and 10; sent-line
selection affects Tasks 15 and 16; mixed selections also affect screen actions and dragging.
Task 6, adding the recorded course to a current-order row, does not pick any of these six options.
