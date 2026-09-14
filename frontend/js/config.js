/* Production uses Cloudflare; the local static server uses the local Worker. */
const familyFindsLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
window.FAMILY_FINDS_CONFIG = {
  googleClientId: '270648649859-sa2p5jdcm7taenr2rdq653kvoq3f0mb2.apps.googleusercontent.com',
  apiOrigin: familyFindsLocal ? 'http://127.0.0.1:8787' : 'https://family-finds-api.zeyi-yang.workers.dev'
};
