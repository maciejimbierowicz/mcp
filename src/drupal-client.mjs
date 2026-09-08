export const DEFAULT_TIMEOUT_MS = 30000;

const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;

/**
 * Reads an optional millisecond timeout, falling back to the default.
 */
export function parseTimeoutMs(value, fallback = DEFAULT_TIMEOUT_MS) {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  const timeout = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT_MS || timeout > MAX_TIMEOUT_MS) {
    throw new Error(
      `DRUPAL_TIMEOUT_MS must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`,
    );
  }

  return timeout;
}

export class DrupalApiError extends Error {
  constructor(message, status = null, code = null) {
    super(message);
    this.name = 'DrupalApiError';
    this.status = status;
    this.code = code;
  }
}

export class DrupalClient {
  constructor({ baseUrl, username, password, timeoutMs, maxResponseBytes }) {
    this.baseUrl = baseUrl;
    this.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    this.timeoutMs = timeoutMs ?? parseTimeoutMs(process.env.DRUPAL_TIMEOUT_MS);
    this.maxResponseBytes = maxResponseBytes ?? 2097152;
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
    let response;
    try {
      response = await fetch(new URL(path, `${this.baseUrl}/`), {
        ...options,
        headers: {
          Accept: 'application/json',
          Authorization: this.authorization,
          ...options.headers,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    }
    catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new DrupalApiError(
          `Drupal did not respond within ${this.timeoutMs} ms.`,
          null,
          'timeout',
        );
      }
      throw new DrupalApiError('Drupal could not be reached.');
    }

    const declaredBytes = Number.parseInt(response.headers.get('content-length') ?? '', 10);
    if (Number.isInteger(declaredBytes) && declaredBytes > this.maxResponseBytes) {
      throw new DrupalApiError(
        'The Drupal JSON response is too large.',
        413,
        'response_too_large',
      );
    }

    const { payload, bytes } = await this.readJson(response);
    if (bytes > this.maxResponseBytes) {
      throw new DrupalApiError(
        'The Drupal JSON response is too large.',
        413,
        'response_too_large',
      );
    }

    if (!response.ok) {
      const apiMessage = payload?.error?.message;
      const apiCode = payload?.error?.code;
      throw new DrupalApiError(
        typeof apiMessage === 'string'
          ? apiMessage
          : `Drupal API returned HTTP ${response.status}.`,
        response.status,
        typeof apiCode === 'string' ? apiCode : null,
      );
    }

    if (!payload || typeof payload !== 'object' || !('data' in payload)) {
      throw new DrupalApiError('Drupal API returned an unexpected response.');
    }

    return payload.data;
  }

  async readJson(response) {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new DrupalApiError(
        `Drupal API response could not be read with HTTP ${response.status}.`,
        response.status,
      );
    }

    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        bytes += value.byteLength;
        if (bytes > this.maxResponseBytes) {
          await reader.cancel();
          throw new DrupalApiError(
            'The Drupal JSON response is too large.',
            413,
            'response_too_large',
          );
        }
        chunks.push(Buffer.from(value));
      }
    }
    catch (error) {
      if (error instanceof DrupalApiError) {
        throw error;
      }
      throw new DrupalApiError(
        `Drupal API response could not be read with HTTP ${response.status}.`,
        response.status,
      );
    }

    try {
      return { payload: JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')), bytes };
    }
    catch {
      throw new DrupalApiError(
        `Drupal API returned a non-JSON response with HTTP ${response.status}.`,
        response.status,
      );
    }
  }
}
