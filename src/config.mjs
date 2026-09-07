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

export const config = Object.freeze({
  port: parsePort(process.env.MCP_PORT),
  allowedHosts: parseAllowedHosts(process.env.MCP_ALLOWED_HOSTS),
  mcpAuthToken: requiredEnvironmentVariable('MCP_AUTH_TOKEN'),
  drupalBaseUrl: parseBaseUrl(requiredEnvironmentVariable('DRUPAL_BASE_URL')),
  drupalUsername: requiredEnvironmentVariable('DRUPAL_USERNAME'),
  drupalPassword: requiredEnvironmentVariable('DRUPAL_PASSWORD'),
});
