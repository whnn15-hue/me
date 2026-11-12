/** Exact archive fingerprints approved for automatic additive saving by the
 * owner in chat. No original documents or decryption keys belong here. */
export const approvedEvidenceArchives: readonly string[] = Object.freeze([
  // 2026-11-12: owner requested direct saving of the three supplied documents.
  "29d3514a22b64b61cc36a79f9bd227d4f061691b57c51d699cc8fbd6138902dd",
]);

/** Separately approved batches may also add the reviewed new career records. */
export const approvedEvidenceNewCareerArchives: readonly string[] = Object.freeze([
  "5697eda36013ab2bb6465e481f9237d9b7a59986f8f18af00e4ec305821c2bc4",
]);

/** Only these reviewed batches may enrich existing institutions and dates. */
export const approvedEvidenceDetailArchives: readonly string[] = Object.freeze([
  // 2026-11-12: owner requested institutions and dates from the 13 supplied originals.
  "f6177b3b7eb9c1e41c6939ee4b0faa4d58cf2c9bbe20a4b38466db3d3267ee1f",
]);
