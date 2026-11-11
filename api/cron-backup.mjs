import { createVercelHandlers } from '../server/vercel/entry.mjs';
const { cronBackup } = createVercelHandlers();
export { cronBackup as GET };
