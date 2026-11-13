# Search, growth map and navigation cleanup

Pre-change source: `backup/before-ui-simplify-20261113` at `2d7e885`. Work branch: `feat/ui-simplify-20261113`.

## Behavior

- Integrated search contains only search, record-type and tag filters, and matching results. Its empty state no longer lists every record or offers creation, upload or navigation commands. Keyboard selection and the top-bar shortcut remain. 교안 and 영상 작업 can be searched separately.
- The growth map keeps every year from 2020 through the current Seoul year and the existing finite entrance animation. Hovering or focusing a year chooses an actual record from that year, avoiding the immediately previous choice when possible. The preview stays stable while reading and opens the record when selected. Its title and institution appear in a larger centered area above the route.
- The random achievement selection is centered. Decorative English headings, the year-side stroke and the counting-method disclosure are removed.
- The sidebar career triangle reveals the same category definitions and counts as the career page. It remembers expansion and reveals an externally selected category. The career page's existing category and list/overview tabs remain intact.
- Main destinations are 홈, 이력, 수업, 교안, 연구 자료, 영상 작업. The complete logo is centered with a small optical inset.
- Favorite buttons, filters, home shortcuts and their reserved layout space are removed. Existing `favorite` values remain in records and backups and survive normal editing. No records, evidence, links, categories or storage schemas are migrated or deleted.

## Verification

Tests use temporary local stores and synthetic records. No owner Firebase or OneDrive data is accessed or changed. Desktop light/dark views and search were inspected at 1440px with external requests blocked and no page errors.

- The full Node test suite ran with concurrency limited to two browser workers: 436 of 437 initially passed. The remaining legacy HTML-preview case attempted to click through its open filter popover; explicitly closing the filter restored the existing interaction test, which then passed on its own. All 437 cases are covered by these runs.
- Eight affected desktop end-to-end scenarios passed across growth, home, navigation and workspace tests. One outdated classroom format-label assertion was corrected to `교안 / TXT` before its successful rerun.
- Search-only interactions, keyboard selection, per-library filtering, sidebar expansion, preserved career tabs, random year previews, reduced motion, bidirectional record links, and JSON preservation of hidden favorite flags are checked.
- `npm run build` and `npm run build:preview` passed, including TypeScript. Both retain the existing large-chunk advisory; no new build error was introduced. Completion logs and remote/live status are recorded privately under `.cloud-local/ui-simplify-20261113/`.

Principal files: `src/App.tsx`, `src/WorkspaceTree.tsx`, `src/branding.css`, `src/growth/`, `src/home/`, `src/workspace/`, `shared/resources.mjs` and their styles/tests. No dependency was added.

## Rollback

Revert this batch's release merge with `git revert -m 1 <release-merge>` and push the revert. The backup branch preserves the exact previous source. Do not replace live data with an old backup or hard-reset shared main. A pushed release and a verified live deployment must be reported separately.
