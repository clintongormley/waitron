# Sweep the root CLAUDE.md

The watcher cleared §§2–3 at 18:58 on 24 November. One PR moves supporting text to the guides and keeps each rule, its brief cost and a pointer. Stop when the movable text runs out. Use dated “Root receipts moved on” sections with the source SHA. Check the two backlog pointers.

| Section | Measured bytes | Estimated kB after | What moves |
| --- | ---: | ---: | --- |
| Introduction | 2,419 | 2.4 | Keep the topic index. |
| §1 Writing claims | 3,190 | 3.2 | Keep in full. |
| §2 CI | 13,432 | 11–12 | Hook details, duplicate scope text and guard limits. |
| §3 Conventions | 47,095 | 39–42 | Mechanisms, examples, incidents and guard limits. |
| §4 Testing | 16,776 | 16.8 | Keep in full. |
| §5 Fiscal | 15,970 | 16.0 | Keep in full, including separate clock waits and attributions. |
| §6 Workflow | 6,929 | 6.9 | Keep in full. |
| §7 Upkeep | 2,144 | 2.1 | Keep in full. |
| **Total** | **107,955** | **About 97–101** | Forecast based on the movable passages. |

The only merge candidate is lines 77–79, 111–118 and 139–143 at `ce8d3f6f1474733a701ab982996caa898d00b243`. Combine CI scope sentences where the surviving words can stay verbatim. Reuse guide text only after a word-for-word match ignoring wrapping and link paths. Line 85 matches the sentence at `ci-and-gates.md:651`. The older scope excerpt at 5936–5940 has retired PR-result reuse wording. The fiscal guide’s guard list at `conventions-data.md:6957` omits `hour-setup-defaults`. Keep all go-live migration rules and the guard and hedge beside each rule.

Rebase last and preserve intervening edits. Put the one-off comparison in the PR table, showing the destination for every removed passage and matching guard names and hedges for every changed entry, including unbackticked names. Check new anchors and run `pnpm exec vitest run scripts/claude-md-pointers.test.ts` and `pnpm exec prettier --check CLAUDE.md`. Have Claude sample twenty moves against the rebased base SHA. Record the final byte count. Any later pass over §§4–7 would be a separate PR if the watcher identifies movable text there.
