# Sweep the root CLAUDE.md

Aim for one to three lines per rule, with its cost and a pointer. Move supporting text verbatim into “Root receipts moved on” sections in the linked developer guides. Name the source SHA and explain where “here” means the root. One PR with roughly six guides and the two backlog pointers, about 200–300 lines moved. No product, workflow or test changes.

| Section | Measured bytes | Estimated kB after | What moves |
| --- | ---: | ---: | --- |
| Introduction | 2,419 | 2.4 | Keep the topic index. |
| §1 Writing claims | 3,190 | 3.2 | Read it in full and leave it intact. |
| §2 CI | 13,432 | 10–11 | Hook details, overlapping CI scope text, and guard limits. |
| §3 Conventions | 47,095 | 36–40 | Examples, mechanisms, receipt history, and detailed exception lists. |
| §4 Testing | 16,776 | 13–14 | Incident detail, guard limits, and fixture mechanics. |
| §5 Fiscal | 15,970 | 15–16 | Receipt detail and guard limits. Keep fiscal exceptions and their attributions. |
| §6 Workflow | 6,929 | 5.5–6 | Incidents and command details. Keep all four landing checks. |
| §7 Upkeep | 2,144 | 1.8–2.1 | Pointer guard limits and rationale. |
| **Total** | **107,955** | **87–95** | Forecast. Preserve rules even if the file exceeds it. |

Line references use `ce8d3f6f1474733a701ab982996caa898d00b243`. In §2, combine lines 77–79, 111–118 and 139–143 around the detailed CI scope entry. Keep the local-test rule, shard ceiling, current-head verification, and publication conditions. Reuse the exact CI sentence at line 85, also at `ci-and-gates.md:651`. Move the current scope excerpt verbatim because `ci-and-gates.md:5936–5940` still quotes retired PR-result reuse. Keep §5 lines 977–987 and 1012–1039 separate because the summary gives the 15-second watch interval and the detailed rules carry distinct conditions. The comparison with `conventions-data.md:4492–4503` found those passages differ. That guide’s list at 6957 also omits `hour-setup-defaults` from root line 1102. Keep the root list, the separate decisions at 1094 and 1100, and the dormant go-live rules at 691–711.

Rebase last and preserve other lanes’ edits. Record every changed entry in the PR table. Compare guard names and hedge counts per entry against the rebased root, including unbackticked suite names and every “weaker than” wording. Put the limits behind its pointer. Account for every removed passage as verbatim text at its destination, a named merge, or a superseded rule named in the commit. Reuse guide text only after a word-for-word match ignoring wrapping and link destinations. Check linked anchors and run `pnpm exec vitest run scripts/claude-md-pointers.test.ts` and `pnpm exec prettier --check CLAUDE.md`. Ask Claude to sample twenty moves against the rebased base SHA. Record the final byte count.
