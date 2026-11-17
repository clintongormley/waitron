# ROOT-GUARD-WALK-TIME implementation plan

**Finish line:** One PR removes measured unnecessary work from the four guards, preserves their accepted and rejected source patterns, proves detection with planted violations, and records before/after CI case timings.

**Authority:** Lane I driver checks and commits this plan, obtains Claude plan review, then watcher clearance before implementation. Execute inline; no delegation or owner approval request.

**Evidence:** At unchanged `77bc77e31b`, Lane I’s external `receipts/root-guard-walk-time-20261117/profile-before.log` reports 118 passing cases. Local elapsed/parser/read times, rounded milliseconds:

| Guard | Local elapsed / parse / read | Baseline CI named case |
|---|---:|---:|
| action-menu | 2092 / 769 / 56 | 22,316 ms |
| demo-boundaries | 1037 / 455 / 33 | 13,540 ms |
| no-history-length | 732 / 402 / 131 | 11,352 ms |
| no-till-as-issuer | 2359 / 273 / 1590 | 10,111 ms |

Local listing cost was 41 ms for action-menu, 42 ms for no-till, and 2 ms for demo. Instrumentation adds overhead; these measurements identify local work, not the cause of CI slowdown. CI values above are **case**, not whole-file, durations from run `44010882278`, job `133797661909`.

- [ ] **Action-menu — `scripts/action-menu-styles.test.ts`.** Add “skips parsing sources with no possible menu ownership match”: observe the real `ts.createSourceFile` boundary through a test-only pass-through spy and first watch the zero-call assertion fail. Then add a conservative raw-text prefilter to `violations`. Always parse existing named-helper paths, backslash-bearing sources, and candidates containing row-action/menu-row markers or `--wt-button-justify`. Preserve parent links, needed by `named`. Retain every behavioral assertion; supplement escaped template/token findings and CSS-only candidates. Candidate controls must still invoke the parser and return the existing violations.

- [ ] **History — `scripts/no-history-length.test.ts`.** Add “skips parsing unrelated Unicode escapes”; first observe unnecessary real parser calls. Keep literal `POSSIBLE_READ`. Replace blanket `\\u` fallback with conservative Unicode decoding used only to identify possible `history` and `length` names; parse when both could occur, or decoding is ambiguous. Keep original source for parsing and line numbers. Retain trivia, optional-chain, escaped-identifier, comment/string and unrelated-object assertions; supplement combined escapes and malformed Unicode controls.

- [ ] **No-till — `scripts/no-till-as-issuer.mjs` and `scripts/no-till-as-issuer.test.ts`.** Add “does not read ignored histories or migrations”: use disposable fixtures and observe actual `readFileSync` calls, initially failing because ignored paths are read. Share the existing ignored-path predicate between `inspectSource` and `scanTree`, applying it before reads. Leave `sourceFilesIn` output and public behavior intact for its other consumers. Disable unused parser parent links, after first observing unnecessary parent links in the real returned syntax tree. Preserve path-only detection, fiscal/private identifiers, escapes, historical exceptions and live-document controls.

- [ ] **Demo — `scripts/demo-boundaries.test.ts`.** Add “parses runtime imports without parent links”; first fail an assertion that the real returned syntax tree allocates no unused parent links, alongside the import-result assertion, then disable those links. Reuse `runtimeImports`, `forbiddenReachable` and both resolvers unchanged. Retain indirect/static/dynamic imports, type-only edges, cycles and missing-dependency controls. Reprofile all four cases using the existing external setup. Keep only demonstrated work reductions; explain any unprofitable guard left unchanged.

- [ ] **Driver verification and receipts.** Run only the four named files locally with `pnpm exec vitest run` and explicit paths; require passing test counts. In a disposable clone containing the candidate tree, plant one violation at a time: forbidden menu styling, browser history-length read, empty retired-command path, and literal demo import. Each existing whole-tree case must fail with its expected finding; removing the mutation must restore a pass. Retain logs externally. Run normal `finish-branch`, push hook and current-head CI root coverage. Record all four exact named-case timings before/after, SHA, run/job and load limitations; promise no deadline guarantee.

- [ ] **Close only completed backlog work.** Delete the 15 November action-menu paragraph and its incident-row mention in `docs/backlog/ci.md`; remove that incident’s row citation if no remaining incident uses it. Update `docs/backlog.md` only if made stale. Add a brief measured receipt to `docs/developers/ci-and-gates.md`.

**Boundaries and size:** No timeout/worker changes, resolver rewrite, caching framework, allowed/refused-source changes, or edits to the explicitly excluded guards/scripts. Estimate **250 changed lines**: 55 guard implementation, 140 tests, 20 receipts/backlog, 35 plan; target 200–350. Seek watcher opinion before exceeding 375 lines or expanding scope.