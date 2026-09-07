import { timingSafeEqual } from 'node:crypto';

export function bearerMatches(authorizationHeader, expectedToken) {
  if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ')) {
    return false;
  }

  const provided = Buffer.from(authorizationHeader.slice('Bearer '.length));
  const expected = Buffer.from(expectedToken);
  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}

export function requireBearerToken(expectedToken) {
  return (request, response, next) => {
    if (!bearerMatches(request.headers.authorization, expectedToken)) {
      response.set('WWW-Authenticate', 'Bearer realm="4GROW MCP"');
      response.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized.' },
        id: null,
      });
      return;
    }

    next();
  };
}
