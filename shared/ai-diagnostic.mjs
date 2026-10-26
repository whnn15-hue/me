// A deliberately small support payload. Never carry keys, URLs, provider text,
// model prompts, document contents, or arbitrary error metadata to the UI/logs.
export function readAiDiagnostic(value) {
  if (!value || typeof value !== 'object'
    || !['models','probe'].includes(value.stage)
    || !['timeout','dns','tls','network','auth','quota','model','service','response'].includes(value.kind)) return null;
  return {
    code:`GEMINI_${value.stage.toUpperCase()}_${value.kind.toUpperCase()}`,
    stage:value.stage, kind:value.kind,
    ...(Number.isSafeInteger(value.elapsedMs) && value.elapsedMs >= 0 && value.elapsedMs <= 60000 ? {elapsedMs:value.elapsedMs} : {}),
    ...(Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? {httpStatus:value.httpStatus} : {}),
  };
}
