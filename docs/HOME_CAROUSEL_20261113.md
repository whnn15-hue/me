# Automatic career preview above the growth years

Backup: `backup/before-home-carousel-20261113` at `46cb79c`. Work branch: `feat/home-carousel-20261113`.

The owner clarified that the automatic banner belongs in the existing large career preview directly above the growth map's year pins. It does not add another home panel.

- The preview advances every five seconds through a shuffled cycle, giving every eligible career one turn before repeating. Past records, records before 2020 and records without a date can appear. Future activities are not presented as past achievements. No date is invented for an undated record.
- The title, year, category and available institution stay centered. Short directional transitions reuse the existing neutral and mint theme. Previous/next controls, a position counter and a pause/play control sit below the title.
- Pointer hover and keyboard focus hold the preview. A year pin still previews a random record from that year; it holds automatic playback while being read. The title opens the exact visible record, while the year pin retains its existing year-list navigation.
- Explicit pause persists while browsing within the mounted home view. Leaving a hovered/focused area or returning from a hidden tab starts a fresh five-second interval. Collapsed maps have no running slide timer. Reduced-motion preferences start playback paused, with manual navigation and explicit playback available; visual transitions remain disabled under reduced motion.
- Empty and single-record states do not show useless controls. Live record updates reconcile the displayed record. All carousel state is presentation-only: careers, links, originals and backups are unchanged.

## Validation

The full Node suite passed 441/441 with concurrency limited to two. After refining pointer-versus-keyboard focus holds, all four carousel browser scenarios passed again, including pointer-only exit after pressing Play and replacement of a keyboard-focused title by a year preview. Tests use temporary local stores and browser fixtures without owner cloud writes.

The two existing growth/home desktop E2E scenarios passed, covering year navigation, preserved layout and data round trips. Light and dark desktop screenshots were inspected. `npm run build` and `npm run build:preview` both passed, including TypeScript; only the existing bundle-size advisory remains. Logs and deployment verification belong in `.cloud-local/home-carousel-20261113/`.

## Rollback

Revert this batch's release merge using `git revert -m 1 <release-merge>`. The backup branch preserves the pre-change code. No data restoration or schema migration is required.
