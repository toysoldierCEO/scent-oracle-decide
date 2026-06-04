# Codex Prompt — Docs Conformance Audit

Run an ODARA / VESPER docs conformance audit.

Goal:
Verify the current app/code behavior against the current docs in `docs/`, especially:

- `ODARA_CURRENT_LAUNCH_DOCTRINE.md`
- `ODARA_UI_STATE_MACHINES.md`
- `ODARA_RC_SMOKE_CHECKLIST.md`
- `ODARA_BACKEND_CONTRACTS.md`
- `ODARA_BACKEND_PROCESS_RULES.md`
- `ODARA_KNOWN_LIMITATIONS_6_11.md`

Hard rules:
- Do not modify files
- Do not apply migrations
- Do not alter SQL
- Do not mutate data
- Do not commit
- Do not push

Return:
1. verdict: ready / ready with cautions / blocked
2. doctrine violations
3. outdated docs
4. code/doc mismatches
5. launch blockers
6. cautions
7. final git status
