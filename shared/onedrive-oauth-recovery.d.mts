export type OneDriveOAuthErrorCode = 'state_used' | 'state_missing' | 'state_expired' | 'request_invalid'
  | 'callback_incomplete' | 'permission_declined' | 'busy' | 'connection_cancelled' | 'exchange_failed'
  | 'scope_missing' | 'account_check_failed' | 'account_mismatch' | 'offline_permission_missing' | 'unavailable';
export interface OneDriveOAuthError { code: OneDriveOAuthErrorCode; message: string; }
export function readOneDriveOAuthError(code: unknown): OneDriveOAuthError | null;
export function oneDriveOAuthRecoveryURL(origin: string, code: unknown): string;
