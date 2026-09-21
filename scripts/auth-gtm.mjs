import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { URL, URLSearchParams } from 'node:url';

const root = new URL('../', import.meta.url);
const clientPath = new URL('.secrets/gtm-client-secret.json', root);
const tokenPath = new URL('.secrets/gtm-token.json', root);
const scope = 'https://www.googleapis.com/auth/tagmanager.readonly';
const port = Number(process.env.GTM_OAUTH_PORT ?? 8789);
const redirectUri = `http://localhost:${port}/oauth2callback`;

if (!existsSync(clientPath)) {
  throw new Error(`Missing ${clientPath.pathname}`);
}

const clientJson = JSON.parse(await readFile(clientPath, 'utf8'));
const client = clientJson.installed ?? clientJson.web;
if (!client?.client_id || !client?.client_secret) {
  throw new Error('OAuth client JSON must contain client_id and client_secret.');
}

const state = randomBytes(24).toString('hex');
const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authorizationUrl.search = new URLSearchParams({
  client_id: client.client_id,
  redirect_uri: redirectUri,
  response_type: 'code',
  access_type: 'offline',
  prompt: 'consent',
  scope,
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
}).toString();

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', redirectUri);
  if (requestUrl.pathname !== '/oauth2callback') {
    response.writeHead(404).end('Not found.');
    return;
  }
  if (requestUrl.searchParams.get('state') !== state) {
    response.writeHead(400).end('Invalid OAuth state.');
    server.close();
    return;
  }
  const error = requestUrl.searchParams.get('error');
  if (error) {
    response.writeHead(400).end(`Google OAuth failed: ${error}`);
    server.close();
    return;
  }
  const code = requestUrl.searchParams.get('code');
  if (!code) {
    response.writeHead(400).end('Missing OAuth code.');
    server.close();
    return;
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      code,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.refresh_token) {
    response.writeHead(502).end('Google did not return a refresh token.');
    server.close();
    throw new Error(`Token exchange failed with HTTP ${tokenResponse.status}.`);
  }

  await writeFile(tokenPath, `${JSON.stringify({
    refresh_token: token.refresh_token,
    scope,
    token_type: token.token_type,
    created_at: new Date().toISOString(),
  }, null, 2)}\n`, {mode: 0o600});
  response.writeHead(200, {'content-type': 'text/plain; charset=utf-8'});
  response.end('GTM authorization completed. You can close this window.');
  server.close();
  console.log(`Saved GTM refresh token to ${tokenPath.pathname}`);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Open this URL in your browser:\n\n${authorizationUrl}\n`);
  console.log('Waiting for the Google OAuth callback...');
});
