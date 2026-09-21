const GTM_API_BASE = 'https://tagmanager.googleapis.com/tagmanager/v2';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export class GtmApiError extends Error {
  constructor(message, {status = null, code = null, retryAfter = null} = {}) {
    super(message);
    this.name = 'GtmApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export class GtmClient {
  constructor({clientId, clientSecret, refreshToken, accountId, timeoutMs = 30000}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.accountId = accountId || null;
    this.timeoutMs = timeoutMs;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
  }

  async getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60000) return this.accessToken;
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) {
      throw new GtmApiError('Google OAuth token refresh failed.', {status: response.status, code: body.error});
    }
    this.accessToken = body.access_token;
    this.accessTokenExpiresAt = Date.now() + Number(body.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  async request(path) {
    const token = await this.getAccessToken();
    const response = await fetch(`${GTM_API_BASE}/${path}`, {
      headers: {authorization: `Bearer ${token}`},
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new GtmApiError(body.error?.message || `Google Tag Manager request failed with HTTP ${response.status}.`, {
        status: response.status,
        code: body.error?.status || body.error?.code,
        retryAfter: response.headers.get('retry-after'),
      });
    }
    return body;
  }

  requireAccount(accountId) {
    const value = String(accountId || this.accountId || '').trim();
    if (!value) throw new GtmApiError('A GTM account_id is required.', {code: 'invalid_request'});
    return value;
  }

  requireContainer(accountId, containerId) {
    const account = this.requireAccount(accountId);
    const container = String(containerId || '').trim();
    if (!container) throw new GtmApiError('A GTM container_id is required.', {code: 'invalid_request'});
    return `accounts/${encodeURIComponent(account)}/containers/${encodeURIComponent(container)}`;
  }

  requireWorkspace(accountId, containerId, workspaceId) {
    const container = this.requireContainer(accountId, containerId);
    const workspace = String(workspaceId || '').trim();
    if (!workspace) throw new GtmApiError('A GTM workspace_id is required.', {code: 'invalid_request'});
    return `${container}/workspaces/${encodeURIComponent(workspace)}`;
  }

  listAccounts() { return this.request('accounts'); }
  listContainers(accountId) { return this.request(`accounts/${encodeURIComponent(this.requireAccount(accountId))}/containers`); }
  listWorkspaces(accountId, containerId) { return this.request(`${this.requireContainer(accountId, containerId)}/workspaces`); }
  getWorkspace(accountId, containerId, workspaceId) { return this.request(this.requireWorkspace(accountId, containerId, workspaceId)); }
  getWorkspaceStatus(accountId, containerId, workspaceId) { return this.request(`${this.requireWorkspace(accountId, containerId, workspaceId)}/status`); }
  listResource(resource, accountId, containerId, workspaceId) { return this.request(`${this.requireWorkspace(accountId, containerId, workspaceId)}/${resource}`); }
  getResource(resource, accountId, containerId, workspaceId, resourceId) {
    const id = String(resourceId || '').trim();
    if (!id) throw new GtmApiError(`A GTM ${resource}_id is required.`, {code: 'invalid_request'});
    return this.request(`${this.requireWorkspace(accountId, containerId, workspaceId)}/${resource}/${encodeURIComponent(id)}`);
  }
  listBuiltInVariables(accountId, containerId, workspaceId) { return this.request(`${this.requireWorkspace(accountId, containerId, workspaceId)}/built_in_variables`); }
  listVersions(accountId, containerId) { return this.request(`${this.requireContainer(accountId, containerId)}/versions`); }
  getLiveVersion(accountId, containerId) { return this.request(`${this.requireContainer(accountId, containerId)}/versions:live`); }
}
