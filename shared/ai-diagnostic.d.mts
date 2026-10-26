export interface AiDiagnostic {
  code:string;
  stage:'models'|'probe';
  kind:'timeout'|'dns'|'tls'|'network'|'auth'|'quota'|'model'|'service'|'response';
  elapsedMs?:number;
  httpStatus?:number;
}
export function readAiDiagnostic(value:unknown): AiDiagnostic | null;
