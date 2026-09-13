/* Production uses Cloudflare; the local static server uses the local Worker. */
const familyFindsLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
window.FAMILY_FINDS_CONFIG = {
  apiOrigin: familyFindsLocal ? 'http://127.0.0.1:8787' : 'https://family-finds-api.zeyi-yang.workers.dev'
};
