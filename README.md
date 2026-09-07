# 4GROW Marketing Data MCP

Thin, standalone MCP adapter. It exposes six read-only tools backed by the
Drupal Content API:

- `list_content_types`,
- `get_content_type_schema`,
- `get_content`,
- `get_content_revisions`,
- `get_content_revision`,
- `search_content`.

## Local start

1. Copy `.env.example` to the ignored `.env` and provide local credentials,
   including a long random `MCP_AUTH_TOKEN`.
2. Make sure Drupal works at `http://127.0.0.1:8888`.
3. Run `npm start`.
4. Check `http://127.0.0.1:3000/health`.

The MCP endpoint uses stateless Streamable HTTP at
`http://127.0.0.1:3000/mcp`. Every `/mcp` request must send:

`Authorization: Bearer <MCP_AUTH_TOKEN>`

`/health` stays unauthenticated and does not call Drupal.

In MCP Inspector, use Streamable HTTP, the `/mcp` URL, and the same Bearer
header.

## Local smoke test

With the server running in another terminal, run `npm run test:list`.
The dynamic schema can be checked with `npm run test:schema`.
Selected fields of a local training node can be checked with
`npm run test:content`. Override its default node ID with `TEST_CONTENT_NID`.

## Timeouts

`DRUPAL_TIMEOUT_MS` caps every outgoing Drupal call. It accepts 1000-120000 and
defaults to 30000. On a timeout the tool returns a normal MCP error result
saying how long it waited, instead of an unexplained failure.

Keep the chain ordered from the outside in, otherwise the wrong layer gives up
first and the client only sees a dropped connection:

```text
MCP client  >  reverse proxy (mcp.4grow.pl)  >  this server  >  Drupal
                proxy_read_timeout                DRUPAL_TIMEOUT_MS
```

`DRUPAL_TIMEOUT_MS` must stay below the proxy read timeout, which is 60 s by
default in Plesk/Nginx. PHP-FPM `max_execution_time` on the Drupal side is the
real ceiling, so raising this value above it only delays the same failure.

`search_content` is the expensive tool, because it scans and loads nodes one by
one. Raise the timeout only if searches genuinely need it, and prefer narrowing
`conditions` and `limit` first.

## Deployment

The server host runs released commits from this repository, never copied files.
The layout separates code, secrets, and the version currently in use:

```text
/opt/4grow-mcp-releases/<date>-<sha>   one git clone per release
/opt/4grow-mcp-shared/.env             secrets, outlive every release
/opt/4grow-mcp                         symlink to the live release
```

`systemd` runs `4grow-mcp.service` with `WorkingDirectory=/opt/4grow-mcp`, so
moving the symlink changes the version and moving it back is a full rollback.
`ExecStart` calls `node` directly rather than through `npm`, so `SIGTERM` from
`systemctl` reaches the process and the HTTP server closes gracefully.

Deploy with `scripts/deploy.sh [branch]` on the host. It clones the branch,
installs production dependencies, boots the release on port 3001 to prove it
starts, and only then repoints the symlink and restarts the service. The live
version keeps serving traffic during every step except the restart itself. If
the release fails its smoke test, the deploy stops and nothing is switched. If
it fails `/health` after the restart, the symlink returns to the previous
release automatically.

`.env` is never part of a release. Each release symlinks it from the shared
directory, so credentials and `DRUPAL_TIMEOUT_MS` survive deploys untouched.

## Tunnel / ChatGPT

Do not expose `/mcp` until `MCP_AUTH_TOKEN` is set. A tunnel hostname must also
be listed in `MCP_ALLOWED_HOSTS` (comma-separated), because the server still
binds to loopback and validates the `Host` header.

Official OpenAI split:

- Inspector, Codex, and ChatGPT developer-mode **Token** auth: this Bearer
  header is enough.
- A published ChatGPT **plugin** needs OAuth 2.1 (protected-resource metadata,
  authorization server, CIMD/DCR). That is not implemented here yet.

## Security boundary

- Drupal credentials are read from environment variables and never returned
  in MCP tool results.
- The inbound MCP token is separate from the Drupal password. It only proves
  the caller may use this adapter.
- The tool is annotated as read-only and non-destructive.
- Drupal independently enforces its bundle allowlist, entity access, role, and
  permission.
- Drupal content returned by tools is untrusted data, not model instructions.
- The server binds to loopback only during local development.
