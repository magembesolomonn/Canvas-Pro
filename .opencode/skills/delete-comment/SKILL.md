---
name: delete-comment
description: Audit Canvas Pro source comments, migrate decisions to ADRs, track implementation debt, and lower the comment lint baseline.
---

Run `node scripts/comment-lint.cjs --inventory` from the repository root. Each entry has a path, current line, exact text and UTF-16 offsets. Review contiguous comments together. Read the implementation, callers and relevant tests before classifying them.

- Delete tautologies that narrate the code and stale descriptions contradicted by current behavior.
- For an excuse, identify the concrete failure or maintenance cost and file an issue with the affected components and acceptance criteria. If the tracker is unavailable, preserve the issue locally and report the publication blocker.
- For a decision record, add its constraint, choice and consequence to the relevant document under `docs/adr/`, then remove the source comment.

Preserve token boundaries, significant newlines, string fixtures, interpreter directives and third-party notices. Audit maintained inputs to generated bundles. Record the original source locations and disposition in `docs/comment-inventory.md` with a new dated section for each subsequent pass.

The baseline maps JSON-encoded pairs of path and exact comment text to occurrence counts. Remove allowances for deleted occurrences. Never regenerate it from the current inventory to make lint pass. Run `npm run check` and `npm test`, plus matching Electron tests when UI behavior changes. Report comment counts and physical source lines removed separately from documentation added.
