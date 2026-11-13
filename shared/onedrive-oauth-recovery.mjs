// Only fixed, non-sensitive reasons may cross the OAuth callback redirect.
// Never include provider messages, authorization codes or state in these URLs.
const messages = Object.freeze({
  state_used: '이미 처리한 OneDrive 연결 주소입니다. 연결 상태를 확인하고, 다시 연결이 필요하면 아래에서 새로 시작해 주세요.',
  state_missing: '이 연결 요청을 찾지 못했습니다. 아래에서 OneDrive 연결을 새로 시작해 주세요.',
  state_expired: 'OneDrive 로그인 대기 시간이 지났습니다. 아래에서 새 연결을 시작해 주세요.',
  request_invalid: 'OneDrive 연결 요청을 확인하지 못했습니다. 아래에서 새 연결을 시작해 주세요.',
  callback_incomplete: 'OneDrive 연결 응답 정보가 빠져 있습니다. 아래에서 새 연결을 시작해 주세요.',
  permission_declined: 'OneDrive 연결이 취소되었거나 권한이 허용되지 않았습니다. 연결하려면 아래에서 새로 시작해 주세요.',
  busy: '다른 저장 작업이 진행 중이어서 연결을 완료하지 못했습니다. 잠시 후 아래에서 새 연결을 시작해 주세요.',
  connection_cancelled: '이 OneDrive 연결 요청은 취소되었습니다. 아래에서 새 연결을 시작해 주세요.',
  exchange_failed: 'Microsoft 로그인 정보를 확인하지 못했습니다. 아래에서 새 연결을 시작해 주세요.',
  scope_missing: 'OneDrive 앱 폴더 사용 권한을 허용해 주세요. 아래에서 연결을 새로 시작할 수 있습니다.',
  account_check_failed: 'Microsoft 계정을 확인하지 못했습니다. 아래에서 연결을 새로 시작해 주세요.',
  account_mismatch: '처음 연결한 Microsoft 계정으로 다시 로그인해 주세요. 다른 계정의 OneDrive에서는 기존 원본을 찾을 수 없습니다.',
  offline_permission_missing: '자동 백업 권한이 필요합니다. 아래에서 OneDrive를 다시 연결하고 권한을 허용해 주세요.',
  unavailable: 'OneDrive 연결을 마치지 못했습니다. 잠시 후 아래에서 새 연결을 시작해 주세요.',
});

export function readOneDriveOAuthError(code) {
  return typeof code === 'string' && Object.hasOwn(messages, code) ? { code, message: messages[code] } : null;
}

export function oneDriveOAuthRecoveryURL(origin, code) {
  const url = new URL('/#settings', origin);
  url.searchParams.set('onedriveError', readOneDriveOAuthError(code)?.code || 'unavailable');
  return url.href;
}
