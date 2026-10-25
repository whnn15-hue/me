export default function previewApi() {
  return new Response(JSON.stringify({ error: '미리보기는 브라우저 안에서만 동작합니다. 실제 데이터 서버에는 연결하지 않습니다.' }), {
    status: 403, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
