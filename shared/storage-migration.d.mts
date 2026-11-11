export interface MigrationTarget { id: string; sha256: string; size?: number }
export declare function planFileIdSwap<T extends { id: string; driveFileId?: string; sha256?: string; size?: number }>(
  documents: T[], mapping: Record<string, MigrationTarget>,
): { updates: T[]; skipped: string[] };
