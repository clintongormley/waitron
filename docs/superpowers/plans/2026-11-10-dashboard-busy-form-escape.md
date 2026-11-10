# Keep five busy dashboard forms open — implementation plan

Lane D’s queued ask is only the five sibling forms in the “Wt dialog lifecycle” bundle (`docs/backlog/dashboard.md`), not its other bullets. A separate GPT-6.1 Sol high-effort run drafted this plan; the Codex driver checked and shortened it. Claude reviewed it (131 seconds); watcher clearance is pending. No owner design approval is recorded.

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

1. **Red:** the retained seven-case probe already reproduces five native `[true,false]` results on `73164dcfb9f014b5cf689948e41961efede5119b`; busy variant and idle option-label controls pass. Move each regression into its existing typed case deliberately, rather than shipping the scratch matrix. Keep each current fixture: add-to-menus and category-color open busy; the others keep their existing transition into busy. Focus the modal body, send two real `userEvent.keyboard("{Escape}")` calls, await `closeReportsDelivered` after each, and assert native `dialog.open` and no cancellation. Keep disabled/inert, Save, Cancel and duplicate-submission assertions; retain the existing synthetic-key and unrelated Enter checks. Preserve section-details’ submission-driven busy transition. Recheck idle option-label Escape. No scratch loop, `any` or new support ships.
2. **Green:** add the five bindings. Run every existing `src/widgets/{option-label-form,add-to-menus,section-details-form,category-color-form,include-folder-form,variant-form}*.test.ts` file, including save-state/unsaved/a11y consumers. The five edited cases must fail against unchanged production before adding bindings, then pass: that red/green comparison is the binding proof, without five extra clone-removal runs. The probe’s variant case remains a disposable positive control, not another shipped scenario.
3. **Docs:** replace the delivered five-form bundle bullet with one for the remaining repeated-key menu/modifier-delete and media-save/delete checks. Remove the delivered reproduction and binding instruction; rename its detail heading to name those remaining checks and update the retained bullet’s link. Keep every other bundle bullet. No guide or visual change: dismissal protection renders no different screen and asks staff to do nothing new.

**Forecast:** production +5/−0; tests about 80–120 changed lines in five existing suites; support 0; targeted backlog retirement and this plan. Focused checks, normal finish-branch reviews, hook, current-head CI and locked landing; no whole-package local run.
