import { parseTimeoutMs } from './drupal-client.mjs';

function requiredEnvironmentVariable(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePort(value) {
  const port = Number.parseInt(value ?? '3000', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MCP_PORT must be an integer between 1 and 65535.');
  }
  return port;
}

function parseBaseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('DRUPAL_BASE_URL must use HTTP or HTTPS.');
  }
  return url.toString().replace(/\/$/, '');
}

function parseAllowedHosts(value) {
  const hosts = ['127.0.0.1', 'localhost'];
  if (!value) {
    return hosts;
  }

  for (const host of value.split(',')) {
    const trimmed = host.trim();
    if (trimmed !== '') {
      hosts.push(trimmed);
    }
  }

  return [...new Set(hosts)];
}

function parseBoundedInt(name, value, fallback, min, max) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

export const config = Object.freeze({
  port: parsePort(process.env.MCP_PORT),
  allowedHosts: parseAllowedHosts(process.env.MCP_ALLOWED_HOSTS),
  mcpAuthToken: requiredEnvironmentVariable('MCP_AUTH_TOKEN'),
  drupalBaseUrl: parseBaseUrl(requiredEnvironmentVariable('DRUPAL_BASE_URL')),
  drupalUsername: requiredEnvironmentVariable('DRUPAL_USERNAME'),
  drupalPassword: requiredEnvironmentVariable('DRUPAL_PASSWORD'),
  drupalTimeoutMs: parseTimeoutMs(process.env.DRUPAL_TIMEOUT_MS),
  rateLimitPerMin: parseBoundedInt('MCP_RATE_LIMIT_PER_MIN', process.env.MCP_RATE_LIMIT_PER_MIN, 30, 1, 600),
  rateBurst: parseBoundedInt('MCP_RATE_BURST', process.env.MCP_RATE_BURST, 10, 1, 100),
  heavyConcurrency: parseBoundedInt('MCP_HEAVY_CONCURRENCY', process.env.MCP_HEAVY_CONCURRENCY, 2, 1, 8),
  heavyWaitMs: parseBoundedInt('MCP_HEAVY_WAIT_MS', process.env.MCP_HEAVY_WAIT_MS, 10000, 100, 60000),
  maxResponseBytes: parseBoundedInt('MCP_MAX_RESPONSE_BYTES', process.env.MCP_MAX_RESPONSE_BYTES, 2097152, 65536, 8388608),
});
