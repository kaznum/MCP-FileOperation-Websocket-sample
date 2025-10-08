import express from 'express';
import { createHash } from 'crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const PORT = Number(process.env.PORT) || 8080;
const CLIENT_ID = process.env.CLIENT_ID || 'mcp-client';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'mcp-client-secret';
const ISSUER = process.env.ISSUER || `http://localhost:${PORT}`;
const AUDIENCE = process.env.AUDIENCE || 'mcp-server';
const ALLOWED_SCOPES = (process.env.ALLOWED_SCOPES || 'file.read file.list')
  .split(/\s+/)
  .filter(Boolean);
const TOKEN_TTL = Number(process.env.TOKEN_TTL) || 300;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const { publicKey, privateKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
const jwk = await exportJWK(publicKey);
jwk.kid = createHash('sha256')
  .update(JSON.stringify(jwk))
  .digest('hex')
  .slice(0, 16);
jwk.use = 'sig';
jwk.alg = 'RS256';

const JWKS_RESPONSE = { keys: [jwk] };

function validateClient(authorizationHeader, bodyClientId, bodyClientSecret) {
  if (authorizationHeader?.startsWith('Basic ')) {
    const credentials = Buffer.from(authorizationHeader.replace(/^Basic\s+/i, ''), 'base64').toString('utf-8');
    const separatorIndex = credentials.indexOf(':');
    if (separatorIndex === -1) {
      return false;
    }

    const clientId = credentials.slice(0, separatorIndex);
    const clientSecret = credentials.slice(separatorIndex + 1);
    return clientId === CLIENT_ID && clientSecret === CLIENT_SECRET;
  }

  if (bodyClientId && bodyClientSecret) {
    return bodyClientId === CLIENT_ID && bodyClientSecret === CLIENT_SECRET;
  }

  return false;
}

app.get('/.well-known/openid-configuration', (req, res) => {
  res.json({
    issuer: ISSUER,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/jwks.json`,
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    scopes_supported: ALLOWED_SCOPES
  });
});

app.get('/jwks.json', (req, res) => {
  res.json(JWKS_RESPONSE);
});

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/token', async (req, res) => {
  if (!validateClient(req.headers.authorization, req.body.client_id, req.body.client_secret)) {
    return res.status(401).json({
      error: 'invalid_client',
      error_description: 'Client authentication failed'
    });
  }

  const grantType = req.body.grant_type;
  if (grantType !== 'client_credentials') {
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: 'Only client_credentials grant is supported'
    });
  }

  const scopeString = req.body.scope || ALLOWED_SCOPES.join(' ');
  const requestedScopes = scopeString.split(/\s+/).filter(Boolean);
  const invalidScopes = requestedScopes.filter(scope => !ALLOWED_SCOPES.includes(scope));

  if (invalidScopes.length > 0) {
    return res.status(400).json({
      error: 'invalid_scope',
      error_description: `Unsupported scopes requested: ${invalidScopes.join(', ')}`
    });
  }

  const accessToken = await new SignJWT({
    scope: requestedScopes.join(' ')
  })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL}s`)
    .sign(privateKey);

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL,
    scope: requestedScopes.join(' ')
  });
});

app.listen(PORT, () => {
  console.log('OAuth 2.1 authorization server ready');
  console.log(`  Issuer: ${ISSUER}`);
  console.log(`  Audience: ${AUDIENCE}`);
  console.log(`  Allowed scopes: ${ALLOWED_SCOPES.join(', ')}`);
  console.log(`  Client credentials: ${CLIENT_ID}/${CLIENT_SECRET ? '[set]' : '[missing]'}`);
});
