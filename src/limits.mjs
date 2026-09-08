export function createTokenBucket({ capacity, refillPerMs }) {
  let tokens = capacity;
  let lastRefill = Date.now();

  function refill() {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + (now - lastRefill) * refillPerMs);
    lastRefill = now;
  }

  return {
    take() {
      refill();
      if (tokens < 1) {
        return false;
      }
      tokens -= 1;
      return true;
    },
  };
}

export function createSemaphore(max) {
  let current = 0;
  const waiting = [];

  function release() {
    const next = waiting.shift();
    if (next) {
      next.resolve();
      return;
    }
    current -= 1;
    if (current < 0) {
      current = 0;
    }
  }

  return {
    acquire(timeoutMs) {
      if (current < max) {
        current += 1;
        return Promise.resolve(release);
      }

      return new Promise((resolve, reject) => {
        const entry = {};
        const timer = setTimeout(() => {
          const index = waiting.indexOf(entry);
          if (index >= 0) {
            waiting.splice(index, 1);
          }
          reject(new Error('busy'));
        }, timeoutMs);
        entry.resolve = () => {
          clearTimeout(timer);
          resolve(release);
        };
        waiting.push(entry);
      });
    },
  };
}

export function mcpToolName(body) {
  if (body && body.method === 'tools/call' && typeof body.params?.name === 'string') {
    return body.params.name;
  }
  if (body && typeof body.method === 'string') {
    return body.method;
  }
  return 'unknown';
}

export function logMcpEvent({ requestId, tool, durationMs, result, code = null }) {
  const entry = {
    ts: new Date().toISOString(),
    request_id: requestId,
    tool,
    duration_ms: durationMs,
    result,
  };
  if (code) {
    entry.code = code;
  }
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}
