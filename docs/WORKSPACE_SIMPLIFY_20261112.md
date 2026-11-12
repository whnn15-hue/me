# Compact archive workspace

Backup branch: `backup/before-workspace-simplify-20261112` at `852f702`.

## Changes

- Home opens with the animated growth journey for every year from 2020 to the current Seoul year. Earlier records remain accessible and included in cumulative totals. Empty years remain visible without inventing activity. Motion is finite and respects reduced-motion preferences.
- The missing-evidence action is compact and below the map. Sidebar has six main destinations; research reports, competition submissions and photos share the research group. Document vault, submission builder and backup/settings open from the top-right gear.
- Career categories use one selector. Additional filters are collapsible, lectures retain year grouping and visible institutions, and evidence badges indicate presence rather than file counts. Long role text is hidden in browsing views but retained in storage and exports.
- The reviewed classroom archive competition activity is presented under competition awards without fabricating personal grades.
- Learning material and video production assets are separate views over existing records. New uploads retain their chosen destination; no bulk migration or rewriting of existing materials is performed. Sound, music and templates no longer appear as learning filters.
- Submission builder starts with a HWPX form upload or a request for relevant records. Keyword recommendations and explicit placeholders can fill a draft. Arbitrary blank cells still require mapping, and HWP files require HWPX conversion. Existing CSV, print/PDF and evidence ZIP exports remain available.

## Data and report status

No storage schema was changed. No owner Firebase, Drive or OneDrive data was used for tests. Existing roles, dates, links and document originals remain unchanged.

The newly supplied research report exceeds the chat download tool's 32 MiB transfer limit. Its bytes could not be retrieved. The report was not read, compressed, imported or linked. An accessible original download link or a smaller copy is required before processing. Do not treat the filename-based career candidate as a verified match.

## Verification and rollback

Completed `npm test` (360 passing), `npm run build`, `npm run build:preview`, and seven desktop Playwright scenarios. The optional mobile scenario was skipped as requested. Obsolete selectors from the old layout were updated and the affected cases rerun successfully. These cover full career editing, preserved roles/dates, evidence ZIP and HWPX exports, backup restore, growth-year filtering, reduced motion, keyboard gear navigation, separated resource libraries and unchanged existing records. All fixtures use temporary local data or in-browser synthetic records. Light and dark screenshots were inspected at 1800px. Publication requires checking the remote revision separately from the live host.

Primary implementation files: `src/App.tsx`, `src/ArchiveTools.tsx`, `src/WorkspaceTree.tsx`, `src/CareerOverview.tsx`, `src/ResumeBuilder.tsx`, `src/home/`, `src/growth/`, `src/workspace/MaterialsView.tsx`, `src/workspace/material-destination.ts`, `shared/resources.mjs`, `shared/career-organization.mjs`, and their styles and tests. No new dependency was added.

To undo this batch after release, revert the release merge commit with `git revert -m 1 <release-commit>` and push the revert. This reverses code without deleting private records. The backup branch also preserves the exact pre-change source. Do not hard-reset or restore an old data archive over the owner's current records.
