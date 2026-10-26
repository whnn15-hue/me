import { AsyncLocalStorage } from 'node:async_hooks';
const deadlines = new AsyncLocalStorage();

// Ordinary requests stop before Netlify's synchronous limit. Background workers
// supply a longer explicit budget, leaving time for status writes and lease
// release. The vault itself stays outside this external-network budget.
export function runWithDeadline(action, milliseconds = 22000) {
  return deadlines.run({ expiresAt: Date.now() + milliseconds }, action);
}
export function budgetedFetch(fetcher) {
  return (url, options = {}) => {
    const expiresAt = deadlines.getStore()?.expiresAt;
    if (!expiresAt) return fetcher(url, options);
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return Promise.reject(Object.assign(new Error('무료 서버 실행 시간 안에 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'), { status: 504 }));
    const budget = AbortSignal.timeout(remaining);
    return fetcher(url, { ...options, signal: options.signal ? AbortSignal.any([budget, options.signal]) : budget });
  };
}
