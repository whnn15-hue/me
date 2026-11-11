import { waitUntil } from '@vercel/functions';
import { createVercelHandlers } from '../server/vercel/entry.mjs';
const { aiBackground } = createVercelHandlers({ waitUntil });
export { aiBackground as POST };
