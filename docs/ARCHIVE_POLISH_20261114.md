# Archive polish, 2026-11-14

This follows the owner's compact-list request. The year pins navigate to their year without selecting the home carousel slide. Automatic slides use a 3.5-second interval, preserving explicit pause, reading holds, hidden-tab suspension and reduced-motion behavior.

Career browsing has one list view. Category navigation remains, but the old manage/overview switch and home overview shortcut are retired. Rows use the same layout for every category, with institutions beside titles and separate scoped research results. Detail browsing prioritizes actual dates, institutions, results and originals. Empty placeholders and permanent upload instructions are removed without deleting stored fields.

School files can move between 수업 자료 and 학급 자료 using the existing revision-guarded workspace update. The record ID, original, creation time and related records remain attached to the same item; the normal update timestamp records the move. No file copy or duplicate record is needed. School search/cross-link focus is consumed after the item opens, so moving a previously searched file does not jump tabs or reopen its detail. A new search request can still open the same file again.

Research browsing shows 보고서 and 참고자료. Existing non-report types remain stored and appear in 참고자료, and editing unrelated fields must not rewrite their legacy type. New files follow the selected shelf, with filename-based suggestions limited to those two visible choices. Compact library rows retain access to originals, editing and previews. Search inputs no longer draw the heavy nested focus rectangle.

Primary files: `src/App.tsx`, `src/archive-clarity.css`, `src/growth/GrowthOverview.tsx`, `src/growth/useCareerCarousel.ts`, `src/home/HomeDashboard.tsx`, `src/record-room.css`, `src/workspace/MaterialsView.tsx`, `src/workspace/ProjectsView.tsx`, `src/workspace/ResearchView.tsx`, `src/workspace/research-shelves.ts`, `src/workspace/research-file-import.ts`, related styles, search display and tests. No new dependencies or production data migration are required.

Backup: `backup/before-archive-polish-20261114` at `c9e4ba3`. Revert the final merge with `git revert -m 1 <release-commit>`; do not reset or force-push main. This reverts code only and does not undo later user edits to records.

Validation: the full Node suite passed 468 tests. Browser testing exposed and fixed the stale school-focus behavior; the 12 affected isolated school/material tests passed after the fix. All 20 desktop Playwright cases passed across the full run and targeted reruns, including school round trips with unchanged originals/links, search, backups, current-screen drops, compact row sizes and focus styling. The existing mobile-only case is intentionally skipped. Test data is isolated from the owner's archive. Both production and isolated-preview builds passed before the single source release. Live Vercel publication is a separate verification from a successful Git push.
