const safeLabel = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : 'Unknown';
export function backendFailure(error, stage, logger = console.error) {
  const name = safeLabel(error?.name), rawCode = safeLabel(error?.code);
  const upstreamStatus = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : undefined;
  logger('career-api failure', { stage: safeLabel(stage), type: name, code: rawCode, ...(upstreamStatus ? { upstreamStatus } : {}) });
  if (name === 'MissingBlobsEnvironmentError') return { status: 503, code: 'BLOBS_CONTEXT_MISSING', message: '백업 저장소에 연결하지 못했습니다. Netlify Functions의 Blobs 환경 설정을 확인해 주세요.' };
  if (name === 'BlobsConsistencyError') return { status: 503, code: 'BLOBS_CONSISTENCY_UNAVAILABLE', message: '백업 저장소의 안전한 읽기를 사용할 수 없습니다. Netlify Functions를 최신 환경으로 다시 배포해 주세요.' };
  if (name === 'BlobsInternalError') return { status: 503, code: 'BLOBS_REQUEST_FAILED', message: '백업 저장소 요청이 실패했습니다. Netlify Functions 로그에서 저장소 연결 상태를 확인해 주세요.' };
  if (rawCode === 'ERR_UNKNOWN_BUILTIN_MODULE' || rawCode === 'ERR_MODULE_NOT_FOUND') return { status: 503, code: 'BACKEND_MODULE_UNAVAILABLE', message: '서버 실행 모듈을 불러오지 못했습니다. Netlify Functions의 Node.js 버전과 배포 파일을 확인해 주세요.' };
  return { status: 500, code: 'BACKEND_REQUEST_FAILED', message: '요청을 처리하지 못했습니다. Netlify Functions 로그에서 서버 상태를 확인해 주세요.' };
}
export function isBlobsFailure(error) { return ['MissingBlobsEnvironmentError', 'BlobsConsistencyError', 'BlobsInternalError'].includes(error?.name); }
