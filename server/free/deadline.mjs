import { AsyncLocalStorage } from 'node:async_hooks';
const deadlines = new AsyncLocalStorage();

// Stop external work before Netlify's 30s limit, leaving time to record an error
// and release the private-vault lease. The vault itself stays outside this budget.
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
