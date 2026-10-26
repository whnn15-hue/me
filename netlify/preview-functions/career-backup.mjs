// The base Netlify schedule may still invoke this name. There is no real backup.
export default function previewBackup() {
  return new Response(JSON.stringify({ ok: true, skipped: true, preview: true }), { headers: { 'Content-Type': 'application/json' } });
}
