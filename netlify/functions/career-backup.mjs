import { freeRuntime } from '../../server/free/runtime.mjs';
import { runWithDeadline } from '../../server/free/deadline.mjs';
export const config = { schedule: '0 18 * * *' };
export default async function careerBackup() {
  try {
    const result = await runWithDeadline(async () => (await freeRuntime()).drive.scheduled());
    // Invocation responses contain no account ID, private Drive file ID or name.
    // The owner sees detailed success/error information via authenticated status.
    return new Response(JSON.stringify({ ok: !result.results?.some(item => item.ok === false), skipped: Boolean(result.skipped) }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  catch { return new Response(JSON.stringify({ error: '예약 백업 연결을 확인해 주세요.' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
}
