# Dashboard refresh, 2026-11-13

The header search is directly editable and displays results below the field without changing the current page. Existing cross-library search, type and tag filters remain available. Arrow keys and Enter open a result; Escape and outside clicks dismiss results, and Ctrl/Cmd+K focuses the field. Korean composition does not accidentally open a record.

Home keeps the 2020-to-present journey visible. The old replay/collapse controls and collapsed preference are retired. The rising graph shares the rotating title's space, the four statistics are centered, and viewport-aware spacing keeps ordinary desktop screens compact without hiding overflowing content. The five-second carousel, year previews, achievement links and reduced-motion preference remain supported.

The original logo moves another two SVG units right, with matching regenerated favicons. Research precedes teaching materials in the sidebar. Career view/category controls have separate visual levels, readable count badges and a strong selected state. Research filters gain concise labels and a grouped panel; repeated zero totals and the long introduction are removed.

No record schema, persistence, originals, credentials or backup format changes. Verification uses isolated local data only.

Pre-change restore point: `backup/before-dashboard-refresh-20261113` (`691c31e`). To undo this batch after release, revert its merge commit with `git revert -m 1 <release-commit>`; do not reset or force-push main. The backup branch remains available for inspection.

Validation: all 442 Node tests passed with concurrency limited to two workers. All 16 desktop browser scenarios passed, including 1366×768 and 1440×900 home fit, year-marker hit targets, centered statistics, selected-category contrast, inline keyboard search, themes, concurrent editing and unchanged backup relationships. Production and isolated preview builds both passed. Local screenshots are in `/workspace/artifacts/dashboard-*.png`.

Live-site verification is blocked by the execution environment's proxy (HTTP CONNECT 403 before reaching Vercel); GitHub's status API is also unavailable here. Source delivery and a verified live Vercel deployment remain separate states. Do not trigger another deployment solely to check publication.
