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
