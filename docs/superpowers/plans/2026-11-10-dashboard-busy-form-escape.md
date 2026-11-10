# Keep five busy dashboard forms open — implementation plan

Lane D’s queued ask is only the five sibling forms in the “Wt dialog lifecycle” bundle (`docs/backlog/dashboard.md`), not its other bullets. Codex wrote this plan; Claude review and watcher clearance are pending. No owner design approval is recorded.

**Finish line:** repeated Escape cannot close these forms while saving. Once idle, existing dismissal and unsaved-draft protection still apply. One PR within three active hours.

**Smallest route:** add `.dismissible=${!this.busy}` to each existing `wt-modal`, following `variant-form.ts`. Reuse the shared dialog’s native dismissal protection and all existing close handlers. No primitive changes, routing, new state, dependencies, other forms or lifecycle fixes.

All paths below start `apps/dashboard/src/widgets/`; each matching `.test.ts` owns its form’s busy behavior:

| Production file | Existing case to extend |
| --- | --- |
| `option-label-form.ts` | holds the dialog open against Escape only while saving |
| `add-to-menus.ts` | holds every place still while requests run |
| `section-details-form.ts` | prevents duplicate save and dismissal in flight |
| `category-color-form.ts` | sends nothing and cannot be dismissed while saving |
| `include-folder-form.ts` | blocks Save and closing while busy |

1. **Red:** the retained seven-case probe already reproduces five native `[true,false]` results on `73164dcfb9f014b5cf689948e41961efede5119b`; busy variant and idle option-label controls pass. Move each regression into its existing typed case: focus the modal body before busy, send two real `userEvent.keyboard("{Escape}")` calls, await `closeReportsDelivered` after each, and assert native `dialog.open` and no cancellation. Keep disabled/inert, Save, Cancel and duplicate-submission assertions; retain the unrelated Enter check. Preserve section-details’ submission-driven busy transition. Recheck idle option-label Escape. No scratch loop, `any` or new support ships.
2. **Green:** add the five bindings. Run all five changed test files, variant’s existing file and existing section-details/include-folder/variant unsaved files. In an installed disposable clone, delete each binding separately: its second native-open assertion must fail; restore and pass.
3. **Docs:** remove only the delivered bundle bullet and five-form detail, retaining the heading and unqueued menu/modifier/media checks. Add one short wait-for-placement-result instruction to English/Spanish `apps/server/src/guide/*/products.md` under the existing `{#menus}` heading. Run `guide-content.test.ts` and `scripts/guide-links.test.ts`; inspect the changed forms in both themes/languages at phone and desktop widths.

**Forecast:** production +5/−0; tests about 80–120 changed lines in five existing suites; support 0; two short guide additions, targeted backlog deletion and this plan. Focused checks, normal finish-branch reviews, hook, current-head CI and locked landing; no whole-package local run.
