const REQUEST_TIMEOUT_MS = 10000;

export class DrupalApiError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'DrupalApiError';
    this.status = status;
  }
}

export class DrupalClient {
  constructor({ baseUrl, username, password }) {
    this.baseUrl = baseUrl;
    this.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  async get(path) {
    return this.request(path, { method: 'GET' });
  }

  async post(path, body) {
    return this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async request(path, options) {
    const response = await fetch(new URL(path, `${this.baseUrl}/`), {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: this.authorization,
        ...options.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const payload = await this.readJson(response);
    if (!response.ok) {
      const apiMessage = payload?.error?.message;
      throw new DrupalApiError(
        typeof apiMessage === 'string'
          ? apiMessage
          : `Drupal API returned HTTP ${response.status}.`,
        response.status,
      );
    }

    if (!payload || typeof payload !== 'object' || !('data' in payload)) {
      throw new DrupalApiError('Drupal API returned an unexpected response.');
    }

    return payload.data;
  }

  async readJson(response) {
    try {
      return await response.json();
    }
    catch {
      throw new DrupalApiError(
        `Drupal API returned a non-JSON response with HTTP ${response.status}.`,
        response.status,
      );
    }
  }
}
