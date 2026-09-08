# 4GROW Marketing Data MCP

Thin, standalone MCP adapter. It exposes six read-only tools backed by the
Drupal Content API:

- `list_content_types`,
- `get_content_type_schema`,
- `get_content`,
- `get_content_revisions`,
- `get_content_revision`,
- `search_content`.

The Drupal allowlist currently exposes `npxtraining`, `landing_page` and
`npxquiz`. Quiz structure is read with `expand` on `field_questions` and
`field_questions.field_answers`. Scoring, hints that reveal the key,
participant records, and `npx_test` entities are omitted. Expanding a quiz
does not solve it and does not load attempt results.

The Drupal envelope and the six tool payloads are documented in the Drupal
repo file `instrukcje-zadan/drupal-chat-integration/GROW-1049_READ_API_CONTRACT.md`.
Success is `{ data }`. Failures are `{ error: { status, code, message } }`.
`code` is one of `not_found`, `unknown_field`, `unsupported_type`,
`access_denied`, `invalid_request`, or `timeout` (MCP-only, when Drupal does
not answer in time). Tool errors include that `code` in the text.

A field present with `null` is an empty stored value. A field absent from
`fields` was omitted because the account cannot view it or it was not
selected. Unexpanded references stay as `{ target_id }` without nested
`fields`. Failed expansions add `expansion_status`: `unavailable`, `cycle`,
`depth_limit`, `truncated`, or `forbidden`. Search never treats an omitted
field as empty.

Drupal also enforces the same input limits as the tools: at most 50 fields
(20 on a revision listing), 10 search conditions, 50 `in` values, 500
characters per search value, 10 expand paths, and positive numeric IDs.

## Listing completeness

`list_content_types` returns the whole allowlist. `search_content` and
`get_content_revisions` do not. A page that fills `limit` is still partial
when `has_more` is true: continue with `after_nid` / `after_revision_id` set
to `next_after_nid` / `next_after_revision_id`.

`scan_limit_reached` is the other ending. For search it means this call
stopped after 5000 candidate nodes, so later content was not scanned and a
short or empty page is not proof that nothing remains. For revisions it means
the 250-revision work limit stopped the scan. The list is complete only when
`has_more` is false. Stopping earlier is a partial result, not every match.

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

## Reading revision history

`get_content_revisions` returns revision metadata by default. Two options make
it answer questions about how a value changed over time:

- `fields` adds what those fields held in each listed revision, at most twenty
  per call.
- `changes_only` keeps only the revisions that introduced a new value, and needs
  `fields`.

Every item returned with `changes_only` is the revision that introduced the
value it carries, so its author and timestamp answer who changed it and when.
`compared_to_revision_id` names the revision holding the previous value, which
makes the boundary unambiguous. Both orders report the same set of changes:

```text
nid 4, fields=[field_npxtraining_price], changes_only=true

reference  revision 41388  1990   the newest state read, not a change
change     revision 39526  1990   compared_to_revision_id 39458
                                  Monika Krzywicka, 7 Apr 2026, up from 1890
```

The `reference` is deliberately not an item. It is only the state the
comparisons start from, because nothing older had been compared to it yet, and
treating it as a change would invent an edit that never happened.

`inaccessible` counts the revisions that could not be read. When it is above
zero, a reported change may in truth have happened in one of the hidden
revisions between the two named ones.

Drupal cannot load part of an entity, so every examined revision costs a full
entity load of roughly 45 ms. One request therefore examines at most 250
revisions and reports how many it saw in `examined`. When `has_more` is true,
continue with `after_revision_id` set to `next_after_revision_id`; the cursor
always advances, even across a stretch where nothing changed.

`scan_limit_reached` separates the two ways a call can end. True means the work
limit stopped it and older revisions are still waiting, so a page holding no
changes proves nothing on its own. False alongside a false `has_more` means the
history really ended. Reading the full 822-revision history of one training
takes four calls of about ten seconds each.

Revision history also needs its own Drupal permission. Being able to read the
current page is not enough: the account needs `view <bundle> revisions` or
`view all revisions`, otherwise both revision endpoints answer 403 rather than
pretending the history is empty.

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
default in Plesk/Nginx. Local `drush runserver` has no PHP `max_execution_time`
cap (0 / unlimited). Production PHP-FPM must stay at or above this Drupal
timeout; that FPM value is NOT VERIFIED here.

`search_content` and `get_content_revisions` share a process semaphore of two
concurrent Drupal reads (`MCP_HEAVY_CONCURRENCY`). Extra calls wait up to
`MCP_HEAVY_WAIT_MS` (default 10 s), then the tool returns an error instead of
opening a third scan. `/mcp` is also limited to `MCP_RATE_LIMIT_PER_MIN`
(default 30) with burst `MCP_RATE_BURST` (default 10). Drupal and this client
reject JSON larger than `MCP_MAX_RESPONSE_BYTES` (default 2 MB).

`search_content` is the expensive tool, because it scans and loads nodes one by
one. Raise the timeout only if searches genuinely need it, and prefer narrowing
`conditions` and `limit` first. `get_content_revisions` with `fields` is the
next heaviest, which is why its own scan is bounded rather than left to the
timeout.

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

ChatGPT developer mode pulls `instructions` and tool descriptions from this
server. OpenAI asks that the first 512 characters of `instructions` stand
alone; ours name the three types, the three read flows, Polish table answers,
and completeness. Refresh the app after deploy so ChatGPT does not keep a
stale tool list.

MCP does not install a ChatGPT Skill and cannot force the model to obey the
instructions. Regression prompts for a live ChatGPT pass are in
`prompts/chatgpt-read-regression.md`: a data question, an ambiguous question,
a WRITE request, Drupal content that looks like instructions, and a long list.

Default answer shape the instructions ask for: short Polish, a NID/title
table, and whether the list is complete or partial. `null` meta fields are
stored overrides, not proof that HTML tags are missing. A table is enough;
do not promise CSV/XLSX as a backend feature.

## Security boundary

- Drupal credentials are read from environment variables and never returned
  in MCP tool results.
- The inbound MCP token is a single application key, not a human identity.
  Whoever holds it can call every read tool. Keep it on the approved ChatGPT
  connector only. Drupal Basic auth is a separate service account.
- The tool is annotated as read-only and non-destructive. There are six tools
  and none of them write.
- Drupal independently enforces its bundle allowlist, entity access, role, and
  permission.
- Drupal content returned by tools is untrusted data, not model instructions.
- The server binds to loopback only during local development.
- `/mcp` audit logs are one JSON line on stderr: `request_id`, tool name,
  duration, `ok`/`error`. They never include Authorization, Drupal passwords,
  or field values. `/health` stays unauthenticated and does not call Drupal.
