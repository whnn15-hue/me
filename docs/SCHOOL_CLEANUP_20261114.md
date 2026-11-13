# Screen cleanup and file placement, 2026-11-14

The owner's clarification is the destination rule: dropping a file stores it in the currently open screen and subsection. Content suggestions must not choose another library. A selected research document type or school shelf wins over filename keywords.

The logo and wordmark are centered as one group, with a visible gap between C and 아카이브. Home removes the redundant 나의 성장 heading and gives the growth scene more room. Career browsing retains category/mode tabs and global search, removes the repeated local filter toolbar and privacy footer, and uses compact scope/grade badges in the mixed list. Filters reached from a year marker or the missing-evidence shortcut remain visible and clearable.

학교 contains 수업 자료 and 학급 자료. Existing project records remain accessible inside 수업 자료; existing classroom materials stay in 학급 자료. The optional `schoolSection` field adds `lesson` or `classroom` placement for classroom-purpose materials. Missing values retain the legacy classroom interpretation, so existing records do not need a rewrite. JSON and ZIP normalization preserve the optional field.

File handling uses the existing original storage and workspace APIs. Screen drops must honor current placement, preserve originals, validate batches before writing, avoid duplicate records within a destination, and avoid replaying an ambiguous save. Modal editors retain their own upload behavior. Tests use temporary local stores, never the owner's production data.

Pre-change backup: `backup/before-school-cleanup-20261114` (`abaad57`). After release, undo the batch with `git revert -m 1 <release-commit>` rather than resetting or force-pushing main.

Main changed files:

- `src/App.tsx`, `src/screen-file-drop.css`: whole-screen drop handling and career browsing cleanup.
- `src/branding.tsx`, `src/branding.css`, `src/growth/GrowthOverview.tsx`, `src/growth/command-deck.css`, `src/archive-clarity.css`: branding, home spacing and compact career rows.
- `src/WorkspaceTree.tsx`, `src/workspace/ProjectsView.tsx`, `src/workspace/MaterialsView.tsx`, `src/workspace/ResearchView.tsx`, their styles and `WorkspaceSearch.tsx`: school shelves, current-screen uploads and matching labels.
- `src/workspace/research-file-import.ts`, `src/workspace/material-original.ts`, `src/reuse/ReuseLibrary.tsx`, `src/reuse/submission-drop.ts`: additive file records, duplicate handling, originals and previews.
- `shared/workspace.mjs`, `src/workspace/types.ts`, `src/free/material-import.ts`: backward-compatible school placement. No dependency or production credential changes.

Validation: the complete Node suite passed 466 tests. Desktop Playwright coverage passed all 20 cases (the existing mobile-only case is intentionally skipped), including whole-screen destinations, duplicate imports, raw original bytes, editor isolation, backup restoration, optimistic concurrency and home layouts at 1366×768 and 1440×900. The removed toolbar/dropzone expectations were updated to the new behavior and rerun. The final school row/detail label correction passed its affected browser case again. Both `npm run build` and `npm run build:preview` passed; the existing bundle-size advisory remains. Source is released by one tested main push.

The execution proxy blocks live Vercel verification before the request reaches the site. A Git push confirms the source revision only, not live publication. No owner's live records were used in testing.
