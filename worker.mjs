// cloudflare worker entry: `wrangler deploy` serves link.tryliner.fun.
import { createApp } from './app.mjs';

const app = createApp();

export default {
  fetch(request, env) {
    return app.fetch(request, env);
  },
};
