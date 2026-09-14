import {createRemoteJWKSet, jwtVerify} from 'jose';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

// Only Google's signed identity is trusted; browser-supplied profile fields are ignored.
export async function verifyGoogleCredential(credential, clientId, keys = googleKeys) {
  const {payload} = await jwtVerify(credential, keys, {
    audience: clientId,
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'email', 'email_verified', 'exp', 'iat'],
  });
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255 ||
      typeof payload.email !== 'string' || payload.email_verified !== true) {
    throw new Error('Google account must have a verified email.');
  }
  return payload;
}
