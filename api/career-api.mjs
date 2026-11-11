import { createVercelHandlers } from '../server/vercel/entry.mjs';
const { api } = createVercelHandlers();
export { api as GET, api as POST, api as PUT, api as PATCH, api as DELETE };
