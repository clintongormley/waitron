CREATE TRIGGER verifactu_submissions_guard_update BEFORE UPDATE ON verifactu_submissions
WHEN new.registro_id IS NOT old.registro_id
  OR (old.case_opened_at IS NOT NULL AND (new.case_cause IS NOT old.case_cause
      OR new.case_evidence IS NOT old.case_evidence OR new.case_opened_at IS NOT old.case_opened_at
      OR new.case_open_seq IS NOT old.case_open_seq))
  OR (old.case_resolved_at IS NOT NULL AND (new.case_resolved_at IS NOT old.case_resolved_at
      OR new.case_resolved_by IS NOT old.case_resolved_by
      OR new.case_resolution_action IS NOT old.case_resolution_action
      OR new.case_resolution_key IS NOT old.case_resolution_key
      OR new.case_remedy_registro_id IS NOT old.case_remedy_registro_id))
BEGIN SELECT RAISE(ABORT, 'verifactu_submissions: a filing case and its resolution are set once'); END
--> statement-breakpoint
CREATE TRIGGER verifactu_submissions_no_delete BEFORE DELETE ON verifactu_submissions
BEGIN SELECT RAISE(ABORT, 'verifactu_submissions: a submission row is never deleted'); END
