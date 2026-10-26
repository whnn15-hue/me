import {freeRuntime} from '../../server/free/runtime.mjs';
import {backendFailure} from '../../server/free/errors.mjs';

// Netlify acknowledges with 202 while the owner-only worker continues.
// The key is never written to a job record or returned by its status endpoint.
export const config={background:true};
export default async function careerAiBackground(request) {
  try {await (await freeRuntime()).runAiConnection(request);}
  catch(error) {backendFailure(error,'ai-worker');}
}
