import { freeRuntime } from '../../server/free/runtime.mjs';
export default async function careerApi(request) {
  try { return (await freeRuntime()).handle(request); }
  catch { return new Response(JSON.stringify({ error: '무료 백엔드 환경 설정을 확인해 주세요.' }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }); }
}
