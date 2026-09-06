"""Exercise the proof's real normaliser without booting PostgreSQL.

Removing the folded-REVOKE refusal must fail these tests: silently rewriting a
REVOKE cannot represent the final privilege union. Full dump controls remain in
schema-equivalence.sh; these inputs cover edges absent from the current dumps.
"""

import pathlib
import sys
import unittest
from unittest.mock import patch


script = pathlib.Path(__file__).with_name("schema-equivalence.sh").read_text()
python = script.split("<<'PY'\n")[-1].split("\nPY\n")[0]
definitions = python.split("residue, raws = {}, {}")[0]
namespace = {}
with patch.object(sys, "argv", ["normaliser", "unused", "0"]):
    exec(compile(definitions, "schema-equivalence.sh:normaliser", "exec"), namespace)
fold = namespace["fold_table_grants"]


class FoldTests(unittest.TestCase):
    def test_folded_revokes_fail_with_the_original_statement(self):
        for role in ("sync_tailer", "sync_retention"):
            for privilege in ("SELECT", "UPDATE(last_seen_at)"):
                statement = f"REVOKE {privilege} ON TABLE public.sync_peers FROM {role};"
                with self.subTest(statement=statement):
                    with self.assertRaises(ValueError) as raised:
                        list(fold([statement]))
                    self.assertIn(statement, str(raised.exception))

    def test_unmeasured_explicit_verbs_fail_instead_of_being_normalised(self):
        for verb in ("TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"):
            with self.subTest(verb=verb):
                with self.assertRaises(ValueError) as raised:
                    list(fold([f"GRANT {verb} ON TABLE public.sync_log TO sync_tailer;"]))
                self.assertIn(verb, str(raised.exception))
                self.assertIn("public.sync_log", str(raised.exception))

    def test_observed_union_and_column_grants_stay_distinct(self):
        statements = [
            "GRANT INSERT ON TABLE public.sync_peers TO app_user;",
            "GRANT SELECT ON TABLE public.sync_peers TO sync_tailer;",
            "GRANT SELECT,UPDATE ON TABLE public.sync_peers TO sync_retention;",
            "GRANT UPDATE(last_seen_at) ON TABLE public.sync_peers TO sync_tailer;",
        ]
        self.assertEqual(list(fold(statements)), [
            "GRANT SELECT,INSERT,UPDATE ON TABLE public.sync_peers TO app_user;",
            "GRANT UPDATE(last_seen_at) ON TABLE public.sync_peers TO app_user;",
        ])

    def test_app_user_revoke_remains_unchanged(self):
        statement = "REVOKE ALL ON TABLE public.sync_log FROM app_user;"
        self.assertEqual(list(fold([statement])), [statement])


if __name__ == "__main__":
    unittest.main()
