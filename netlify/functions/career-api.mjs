import { freeRuntime } from '../../server/free/runtime.mjs';
import { backendFailure } from '../../server/free/errors.mjs';
export default async function careerApi(request) {
  try { return await (await freeRuntime()).handle(request); }
  catch (error) {
    const failure = backendFailure(error, 'runtime');
    return new Response(JSON.stringify({ error: failure.message, code: failure.code }), { status: failure.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
}
