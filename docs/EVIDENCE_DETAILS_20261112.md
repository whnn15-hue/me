# Evidence institutions and dates, 2026-11-12

The owner requested removal of the Other career category and institution/date completion from the 13 uploaded originals. Backup: `backup/before-evidence-details-20261112` at `7594432`.

The career menu, filters and editor choices omit Other. Supported old entries are classified by their activity title/role, including lead teachers and master teachers under committees/support teams. Unknown historical entries remain visible in the full archive and search. Legacy stored values and JSON backups remain compatible; no records are deleted or rewritten for classification.

An optional `evidenceImport.careerDetails` marker adds bounded, source-linked institution/date patches and provenance notes. Only a separately approved exact archive fingerprint may apply them during automatic import. Every target is matched to a fresh snapshot. Institutions use compare-and-set, date ranges and precision change together, intervening edits survive, and notes append without truncation. A duplicate-only import can save metadata; re-opening the same package performs no further write. Existing CAS revision handling and original cleanup apply. No storage schema change or migration is required.

The prepared encrypted package contains 13 unchanged originals, matched to 13 existing activities with 15 links. Twelve originals match the known local archive hashes; the live import checks them again. Eleven activity dates/ranges can be refined. A qualification uses its acquisition date instead of its certificate issue date. Preparatory meetings and writing meetings are recorded separately when they do not establish the whole project's period. The package adds no new careers. Plaintext documents, personal details and the decryption key are kept only in the ignored workspace.

Validation covers duplicate-only metadata commits, replay, modified fields, date consistency, source mismatches, malformed patches, concurrent revision conflicts, other-workspace preservation, automatic browser saving and category browsing. Tests use synthetic data and an isolated local server, never production data. Validation passed: 340 tests, production and preview builds, and three desktop end-to-end scenarios (overview, career collections, HTML library).

Release through one main push with `[skip netlify]`, after the test suite and both builds pass. Source publication is not proof of Vercel publication or live import. The private fragment link opens the package in the signed-in owner's app and saves through its existing storage connection.

To roll back code, revert the final merge with `git revert -m 1 <release-merge>`; the backup branch retains the exact previous source. Code rollback does not remove imported originals or overwrite user data. Any data restoration should use the owner's archive backup.
