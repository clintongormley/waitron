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
--> statement-breakpoint
CREATE TRIGGER verifactu_sending_state_no_delete BEFORE DELETE ON verifactu_sending_state
BEGIN SELECT RAISE(ABORT, 'verifactu_sending_state: the sending gate is never deleted'); END
--> statement-breakpoint
CREATE TRIGGER verifactu_identities_guard_update BEFORE UPDATE ON verifactu_identities
WHEN new.id IS NOT old.id OR new.node_id IS NOT old.node_id OR new.nif IS NOT old.nif
  OR new.id_sistema_informatico IS NOT old.id_sistema_informatico
  OR new.numero_instalacion IS NOT old.numero_instalacion OR new.environment IS NOT old.environment
  OR new.event_key IS NOT old.event_key OR new.allocation_key IS NOT old.allocation_key
  OR new.allocation IS NOT old.allocation OR new.approval IS NOT old.approval
  OR new.bases IS NOT old.bases OR new.result IS NOT old.result
  OR new.registrado_en IS NOT old.registrado_en
  OR (old.revocado_en IS NOT NULL AND new.revocado_en IS NOT old.revocado_en)
BEGIN SELECT RAISE(ABORT, 'verifactu_identities: only revocado_en may be set, once'); END
--> statement-breakpoint
CREATE TRIGGER verifactu_identities_no_delete BEFORE DELETE ON verifactu_identities
BEGIN SELECT RAISE(ABORT, 'verifactu_identities: an identity is never deleted'); END
