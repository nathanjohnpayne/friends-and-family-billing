# Documentation Rules

- **`AGENTS.md` / `docs/agents/`:** Update the relevant sub-file when adding new features, new Cloud Functions, new Firestore collections, or new key modules/services. Update the index (`AGENTS.md`) only when adding or removing a section.
- **`DEPLOYMENT.md`:** Update when the deploy process changes — new targets, credential rotation steps, new environment requirements.
- **`README.md`:** Update when project description, live URL, or major features change.
- **`docs/QUICKSTART.md`:** Update when the local development setup process changes.
- **`docs/FIREBASE_IMPLEMENTATION.md`:** Update when the Firebase architecture changes significantly.
- **`rules/repo_rules.md`:** Update when directory structure changes or new invariants are needed.
- **`.ai_context.md`:** Update when high-risk areas change or external dependencies change.

When changing the behavior of any function documented in [Agent Operating Rules](operating-rules.md), update the corresponding function description before or alongside the code change.
