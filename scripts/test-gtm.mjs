import assert from 'node:assert/strict';
import {GtmApiError, GtmClient} from '../src/gtm-client.mjs';

const originalFetch = globalThis.fetch;
const requests = [];

globalThis.fetch = async (input) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') {
    return new Response(JSON.stringify({access_token: 'test-access-token', expires_in: 3600}), {
      status: 200,
      headers: {'content-type': 'application/json'},
    });
  }

  requests.push(url);
  if (url.endsWith('/accounts/3005065908')) {
    return new Response(JSON.stringify({accountId: '3005065908', name: '4Grow'}), {
      status: 200,
      headers: {'content-type': 'application/json'},
    });
  }
  if (url.includes('/version_headers')) {
    return new Response(JSON.stringify({containerVersionHeader: [{containerVersionId: '113'}]}), {
      status: 200,
      headers: {'content-type': 'application/json'},
    });
  }
  throw new Error(`Unexpected test request: ${url}`);
};

try {
  const client = new GtmClient({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    accountId: '3005065908',
  });

  const accounts = await client.listAccounts();
  assert.deepEqual(accounts.account.map(({accountId}) => accountId), ['3005065908']);
  assert.match(requests[0], /\/accounts\/3005065908$/);

  const versions = await client.listVersions(undefined, '8885388', 'next-page');
  assert.equal(versions.containerVersionHeader[0].containerVersionId, '113');
  assert.match(requests[1], /\/accounts\/3005065908\/containers\/8885388\/version_headers\?pageToken=next-page$/);

  assert.throws(
    () => client.listContainers('999999'),
    (error) => error instanceof GtmApiError && error.code === 'account_not_allowed' && error.status === 403,
  );

  console.log(JSON.stringify({status: 'ok', assertions: 4}));
}
finally {
  globalThis.fetch = originalFetch;
}
