/** Exact archive fingerprints approved for automatic additive saving by the
 * owner in chat. No original documents or decryption keys belong here. */
export const approvedEvidenceArchives: readonly string[] = Object.freeze([
  // The earlier three-file batch was superseded by the owner's separate-career correction.
]);

/** Separately approved batches may also add the reviewed new career records. */
export const approvedEvidenceNewCareerArchives: readonly string[] = Object.freeze([
  // 2026-11-13: reviewed scans plus the preceding committee originals.
  "d78e5367b9154010410c5bf9661f05f8fe9e73d58884d4a09510edaf00c0d2a6",
  "e1dd2e4292291f1459dcfd98410be165041bdf4843932daa393b7ad34f36f73a",
  "5697eda36013ab2bb6465e481f9237d9b7a59986f8f18af00e4ec305821c2bc4",
  "ca39aad9c1d9e645241a8cc5d05d4aedad9383e497bd04355b43d68a1e465cf6",
]);

/** Only these reviewed batches may apply source-backed career corrections. */
export const approvedEvidenceDetailArchives: readonly string[] = Object.freeze([
  "d78e5367b9154010410c5bf9661f05f8fe9e73d58884d4a09510edaf00c0d2a6",
  "e1dd2e4292291f1459dcfd98410be165041bdf4843932daa393b7ad34f36f73a",
  // 2026-11-12: owner requested institutions and dates from the 13 supplied originals.
  "f6177b3b7eb9c1e41c6939ee4b0faa4d58cf2c9bbe20a4b38466db3d3267ee1f",
  // 32 additional originals, source-checked corrections, and one new meeting.
  "ca39aad9c1d9e645241a8cc5d05d4aedad9383e497bd04355b43d68a1e465cf6",
]);

/** Exact, owner-reviewed corrections may detach only the specified old link.
 * Originals and unrelated career connections always remain intact. */
export const approvedEvidenceLinkArchives: readonly string[] = Object.freeze([
  "d78e5367b9154010410c5bf9661f05f8fe9e73d58884d4a09510edaf00c0d2a6",
  "e1dd2e4292291f1459dcfd98410be165041bdf4843932daa393b7ad34f36f73a",
]);
