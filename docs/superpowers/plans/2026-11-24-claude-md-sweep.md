# Sweep the root CLAUDE.md

Keep every active rule, its brief cost, guard names and hedges in the root. Aim for one to three rule lines where the wording allows. The 107,955-byte baseline comes from `wc -c CLAUDE.md`. The forecast is about 92–100 KB, with 71 KB a guide, never a gate.

| Area | Now → estimated KB | What moves |
| --- | --- | --- |
| Introduction and §1 | 5.6 → 5.6 | Read both. Respect §1’s instruction to stay in full. |
| §2 CI | 13.4 → 11–12 | Setup mechanics and guard limits. Merge overlapping CI scope entries. |
| §3 UI and data | 47.1 → 39–42 | Mechanisms, receipts and detailed limits. Preserve the go-live rebuild rules. |
| §4 Testing | 16.8 → 14–15.5 | Incident detail and guard limits. |
| §5 Fiscal | 16.0 → 15–16 | Receipts and guard limits. Keep fiscal exceptions and approval attributions. Cross-reference repeated clock waits only where every condition survives in the root. |
| §§6–7 Workflow and housekeeping | 9.1 → 7–9 | Incidents and procedural detail. |

Move prose verbatim to dated “Root receipts moved on” sections under `docs/developers/`. Follow existing topic pointers where they lead there. Cite the old root SHA and note when “here” means the root. Reuse existing passages only when the words match, allowing for wrapping and relative link destinations. Keep the hedge beside each guard and move its detailed limits. Merge overlapping rules without losing conditions or distinct authorities. Name superseded wording and the later rule in the signed-off commit. Check the housekeeping pointers in `docs/backlog.md` and `docs/backlog/ci.md`.

Rebase before opening the PR and preserve intervening edits. Use the rebased base SHA for the PR table of every changed entry. Account for all removed wording and compare each entry’s guard names, including unbackticked names, and hedges. Check the new anchors, run `pnpm exec vitest run scripts/claude-md-pointers.test.ts` and `pnpm exec prettier --check CLAUDE.md`, and record the final byte count. Have Claude compare twenty moved entries across sections with that base. One normal PR. Product code, workflows and tests stay untouched.
