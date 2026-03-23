# AGENTS.md --- Friends & Family Billing

Agent instructions are organized into focused sub-files. Read the relevant file(s) before taking action in this repository.

## Sections

1. **[Repository Overview](docs/agents/repository-overview.md)** --- Tech stack, project structure, application routes
2. **[Agent Operating Rules](docs/agents/operating-rules.md)** --- Auth flow, data architecture, Firestore schema, build system, key modules, state management, Cloud Functions, UI design system, local dev, analytics, troubleshooting
3. **[Code Modification Rules](docs/agents/code-modification-rules.md)** --- High-risk zones (payment/financial logic), ledger immutability, credential hygiene, security rules
4. **[Documentation Rules](docs/agents/documentation-rules.md)** --- Which docs to update and when
5. **[Testing Requirements](docs/agents/testing-requirements.md)** --- Vitest + React Testing Library patterns, what requires tests
6. **[Deployment Process](docs/agents/deployment-process.md)** --- `op-firebase-deploy` commands and predeploy hooks
7. **[Code Review Requirements](docs/agents/code-review-requirements.md)** --- Self-review, external review triggers, enforcement policy
