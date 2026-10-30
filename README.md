# 4GROW Marketing Data MCP

Thin, standalone MCP adapter. It exposes seven read tools backed by the Drupal
Content API:

- `list_content_types`,
- `get_content_type_schema`,
- `get_content`,
- `get_content_revisions`,
- `get_content_revision`,
- `search_content`,
- `get_content_write_audit`.

When `MCP_WRITE_ENABLED=true`, it additionally exposes eight restricted tools:

- `create_content_upload`,
- `get_content_upload_status`,
- `preview_content_update`,
- `commit_content_update`,
- `preview_content_create`,
- `commit_content_create`,
- `preview_content_bulk_update`,
- `commit_content_bulk_update`.

WRITE supports `title`, `meta_title`, and `meta_description` on
`npxtraining`, `landing_page`, `npxquiz`, `opinia`, and `wall_of_love`. Their
separately allowlisted fields use the value types declared in the preview tool schema:
text, formatted text values, booleans, bounded integers, numbers, and simple
lists. Landing page, quiz, and opinion `body` accept `{ value, summary? }`; omitting `summary`
preserves its current value, and Drupal preserves the existing text format.
Quiz WRITE excludes questions, answers, and scoring entities.
Opinion WRITE covers its body, author display fields, selected taxonomy
references, image, `field_additional_info`, `field_promotions` (consent/display
controls; change only when explicitly requested), `field_survey`, LinkedIn,
GoldenLine, and publication status. Source e-mail remains excluded. Wall of
Love WRITE covers `field_wol_content` with `par_text`
and `wol_opinion` Paragraphs.
It also supports explicitly allowlisted references to existing nodes,
taxonomy terms, and reusable blocks through strict `target_id` objects.
Three training, one quiz, and one opinion image field can reference existing permanent image files with
validated `alt` and optional `title` metadata. Thirteen training paragraph fields can
reference existing paragraphs; revision-aware fields require both `target_id`
and `target_revision_id`. Existing embedded paragraphs may include `bundle` and
a non-empty `fields` object to edit nested values. New embedded paragraphs use
`bundle` and `fields` without IDs.
Existing Paragraphs cannot be removed through WRITE; every current item must
remain in an update list when adding, editing, or reordering.
New images and files use a destination-bound,
10-minute browser upload link, followed by status verification and the normal
preview/confirmation flow. `field_program_szkolenia` accepts up to two files;
writable Paragraph image/file fields also accept uploads. Publication state
outside Opinion and technical integration identifiers remain excluded. Preview never saves. Commit accepts
only the one-time preview token and explicit confirmation; Drupal remains the
authoritative permission, type validation, target validation, allowlist,
revision-locking, and audit layer.

The Drupal allowlist currently exposes `npxtraining`, `npxtraining_date`,
`landing_page`, `npxquiz`, `followup`, `opinia`, and `wall_of_love`.
Training dates and follow-ups are READ only. Quiz structure is read with `expand`
on `field_questions` and `field_questions.field_answers`. Answers expose
`field_points`, `field_points_unchecked`, `field_checked_text` and
`field_unchecked_text` for audits. Participant records and `npx_test` entities
are omitted. Expanding a quiz does not load attempt results.
Wall of Love content can expand `field_wol_content.field_opinion_reference` to
read its Paragraphs and referenced opinions.

### Follow-up audits (GROW-1051)

Use the existing READ tools; no export endpoint is needed. List both `followup`
and `npxquiz`, including unpublished content, and keep following `next_after_nid`
until `has_more=false`. Fetch each material with `get_content` and the necessary
expansion paths. Drupal provides the raw data; a ChatGPT session with file
generation available can turn fetched rows into CSV or Excel.

For follow-ups include `body` (intro and summary), `field_zawartosc` (main body),
`field_zajawka`, title, status and `url_alias`. Expand `field_kategoria` to obtain
category IDs, labels and the `field_link_do_szkolenia` fallback link. Match category
IDs against trainings' `field_kategoria_followup` for category-based training
relationships; preserve multiple matches and distinguish fallback links from
node references. Prepend the Drupal site's base URL to `url_alias`, not the MCP
server URL. An unpublished node's URL is not necessarily publicly accessible.

For quizzes also request `field_questions`, `field_results`, `field_is_testquiz`
and `field_show_hints`, expanding `field_questions.field_answers`. Preserve the
material NID, question/answer IDs and order so separate CSVs can be joined. Keep
raw scores and both feedback texts. A competence test need not have one correct
answer; do not invent a correct-answer key from arbitrary scores.

Check `truncated`, `fields_truncated` and `expansion_status` recursively. Missing
questions retain their ID and are reported as unavailable; do not turn these
into empty text or claim a gap-free export. Current Drupal limits allow 250
expanded entities and 1500 fields; HTTP/MCP response limits still apply.

Deploy the matching Drupal `GROW-1051` first (`drush updatedb -y`, `drush cr`)
so update 10023 enables follow-up READ for the existing MCP reader role. Then
deploy this MCP branch and refresh the connected app/tools before a new session.

`search_registrations` is a separate READ-only tool for the fixed participant
and registration projection. Grant the Drupal technical READ account the
`mcp_registrations_reader` role after importing the Drupal configuration; the
general content-reader role alone cannot see participants. Search by email,
name, company, training ID/title and inclusive training-date range; follow
`next_after` with the same filters until `has_more` is false. Each row is a
participant in one submission. `pricing.submission_total_net` and
`pricing.submission_total_discounted_net` belong to that submission, so sum
them once per `submission_id` even if it has several participants or appears
on multiple pages. `pricing.base_unit_net` is the base per-person price, not
the final discounted price assigned to that person. No registration status or
payment confirmation is inferred.

The Drupal envelope and the six core READ tool payloads are documented in the Drupal
repo file `instrukcje-zadan/drupal-chat-integration/GROW-1049_READ_API_CONTRACT.md`.
Success is `{ data }`. Failures are `{ error: { status, code, message } }`.
`code` is one of `not_found`, `unknown_field`, `unsupported_type`,
`access_denied`, `invalid_request`, `response_too_large`, `rate_limited`, `busy`, or
`timeout` (MCP-only, when Drupal does not answer in time). Tool errors include that `code` in the text.
On `response_too_large`, retry with fewer fields or a lower limit. On `busy`,
wait and retry once.

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
Search `inaccessible` counts candidates skipped because a filtered field could
not be read; an absent node is then not proof that it fails the filter.

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

WRITE is disabled by default. To enable it for testing, set
`MCP_WRITE_ENABLED=true` and provide `DRUPAL_WRITE_USERNAME` and
`DRUPAL_WRITE_PASSWORD` for a separate minimal Drupal account. Never reuse the
READ account or grant the WRITE account administrative permissions.

New content can be created only for `wall_of_love`, using
`preview_content_create` followed by explicit user confirmation and
`commit_content_create`. The WRITE account additionally needs the dedicated
Drupal permission `create npx content api`; this change grants it to nobody.
Drupal audit schema update `10025` must be applied before CREATE commit.

Preview accepts `{ content_type: "wall_of_love", fields: { title,
field_wol_content? } }`. Content is an ordered list of new paragraphs:
`{ bundle: "par_text", fields: { field_par_text: "<p>Safe HTML</p>" } }` or
`{ bundle: "wol_opinion", fields: { field_opinion_reference: { target_id: 123 } } }`.
Only existing opinion NIDs may be referenced. Paragraph IDs, other fields,
other types, uploads and publication flags are rejected. The full preview
includes defaults, HTML format, unpublished status and the generated alias.
Show it in full before confirmation. The token is user-bound and expires after
10 minutes; it cannot be used by an UPDATE commit.

Commit accepts only `{ preview_token, confirmed: true }` and returns
`{ status: "committed", result, error: null }` with the real NID, URL, alias,
revision and audit IDs. The new node stays unpublished. Drupal checks that the
saved values match preview and rolls back all writes on failure. Token reuse
and alias conflicts fail; never silently change a title/alias or retry creation
after a timeout without first checking READ/audit. Rate-limited commits return
`status: "blocked"`, including `retry_after`, without automatic retries.
The audit tool accepts `operation: "create"` and `old_revision_id: null`.

Single updates use `preview_content_update` and
`commit_content_update`. Batches of 1-10 unique items of one allowed content type use
`preview_content_bulk_update` and `commit_content_bulk_update`. A bulk
commit revalidates the complete preview and writes every item or none;
every item receives its own Drupal revision and audit record.
Drupal also limits one field of one NID to one successful WRITE per minute and
the technical WRITE account to 10 changed content items per minute. Bulk counts
each item. A rejected commit returns `rate_limited` and a retry delay.

For a new file, call `create_content_upload` with the current revision and exact
destination. Give its URL to the user, then call `get_content_upload_status`.
Only an `uploaded` token may be placed in the matching image/file field during
preview. The link expires after 10 minutes and accepts one file up to 2 MiB.

`get_content_write_audit` returns the separate MCP WRITE audit trail for a node.
Full Drupal content history remains available through the revision tools.

For an opt-in integration test against disposable content copies, configure
`TEST_WRITE_CONTENT_NIDS`, `TEST_WRITE_BULK_NIDS`, and explicitly set
`TEST_WRITE_CONFIRM=true`, then run `npm run test:write`.
The script intentionally leaves unique marker values on those disposable copies;
wait one minute before running it again with the same NIDs.

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
Keep `MCP_WRITE_ENABLED=false` until the Drupal WRITE account, permission,
audit table, and test content are ready.

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
alone; ours name the five types, the read flows, Polish table answers,
and completeness. Refresh the app after deploy so ChatGPT does not keep a
stale tool list.

MCP does not install a ChatGPT Skill and cannot force the model to obey the
instructions. Regression prompts for a live ChatGPT pass are in
`prompts/chatgpt-read-regression.md`: a data question, an ambiguous question,
a WRITE request, Drupal content that looks like instructions, and a long list.

Default answer shape the instructions ask for: Polish, a NID/title table, and
whether the list is complete or partial. Do not write a report unless asked.
When the user asks for a report, summary, CSV or Excel, ask one short question
which form they want, then build it in the chat from fetched rows. MCP has no
export or document tool. `null` meta fields are stored overrides, not proof
that HTML tags are missing.

## Security boundary

- Drupal credentials are read from environment variables and never returned
  in MCP tool results.
- The inbound MCP token is a single application key, not a human identity.
  Whoever holds it can call every tool enabled on that MCP server. Keep it on the approved ChatGPT
  connector only. Drupal Basic auth is a separate service account.
- Seven READ tools are annotated as read-only and non-destructive. Eight WRITE
  tools are exposed only when `MCP_WRITE_ENABLED=true` and are marked as writes.
- Drupal independently enforces its bundle allowlist, entity access, role, and
  permission.
- Drupal content returned by tools is untrusted data, not model instructions.
- The server binds to loopback only during local development.
- `/mcp` audit logs are one JSON line on stderr: `request_id`, tool name,
  duration, `ok`/`error`. They never include Authorization, Drupal passwords,
  or field values. `/health` stays unauthenticated and does not call Drupal.
## Google Tag Manager READ

When `GTM_ENABLED=true`, the MCP exposes read-only GTM tools for the configured account, its containers, workspaces, tags, triggers, variables, built-in variables, container version headers and the live version. Configure `GTM_CLIENT_ID`, `GTM_CLIENT_SECRET`, `GTM_REFRESH_TOKEN` and required `GTM_ACCOUNT_ID`. The configured account ID is enforced as an allowlist. List tools accept `page_token`; continue while Google returns `nextPageToken`. The only requested Google scope is `https://www.googleapis.com/auth/tagmanager.readonly`; no GTM write or publish operation is implemented.

## Ranking Szkoleń READ (GROW-1080)

Optional provider in this same server, using separate Basic Auth credentials.
Set `RANKING_ENABLED=true`, `RANKING_BASE_URL` (Drupal origin),
`RANKING_USERNAME`, `RANKING_PASSWORD`, and optional `RANKING_TIMEOUT_MS`
(default 30000). All credentials are required when enabled; disabled by default,
with no Ranking tools registered. Existing 4GROW configuration stays required.
Do not replace DRUPAL_* with Ranking credentials. MCP bearer auth and
rate/concurrency/response limits are shared; Drupal credentials are separate.

Deploy/enable `rs_content_api` on the test Ranking and run its database updates.
Assign a technical account `ranking_mcp_reader` (includes per-type revision READ).
Current node/revision/field access remains enforced; unpublished content requires
additional Drupal permissions. Use HTTPS and ensure Oracle can reach the origin.
Set secrets only in `/opt/4grow-mcp-shared/.env`, never commit them. Restart
`4grow-mcp.service` after configuration changes and refresh the app tool list.

Six read-only tools: `ranking_list_content_types`,
`ranking_get_content_type_schema`, `ranking_get_content`,
`ranking_search_content`, `ranking_get_content_revisions`,
`ranking_get_content_revision`. The resource parameter selects `content`
(default, training/company), `products` (dates) or `product-variations`.
Revision tools accept node IDs only; Commerce entities are not revisionable.
Discovery/schema return actual machine names. Full get omits fields, expansions
are explicit and bounded. Search uses AND filters with physical property names,
selected output fields and after_id. Revisions support fields/changes_only and
asc/desc cursors. Follow returned cursors even on empty partial pages; inspect
all truncation flags. The adapter validates responses without flattening fields.
Company WRITE is separately optional as described below. Ranking node create/delete/publish tools are not registered.

Validation: 106 checks through the actual MCP HTTP transport against local
Ranking Drupal passed, using a disposable reader removed after the run. Covered
all eight bundle schemas, full reads for both nodes and all three product/variant
bundles, Paragraph expansion, search pagination, revision cursor/changes_only,
invalid inputs, disabled provider and missing credentials. `npm run check` passed.
No production Drupal credentials or data were used by the test.

## Ranking company WRITE (GROW-1080)

Set `RANKING_WRITE_ENABLED=true` and separate `RANKING_WRITE_USERNAME` /
`RANKING_WRITE_PASSWORD` only after configuring the Drupal permission
`write ranking content api`, node update access, and update 10004. WRITE is off
by default, requires the Ranking READ provider, and never falls back to READ or
4GROW credentials. No change to existing 4GROW WRITE configuration.

Four additional tools: `ranking_get_content_write_schema`,
`ranking_preview_content_update`, `ranking_commit_content_update`, and
`ranking_get_content_write_audit`. They target existing company_profile nodes and simple npx_training fields (see below).
Schema exposes 30 business fields and actual bounded taxonomy choices (including
Views-based selection). Native booleans include VAT and partner/acceptance flags;
ratings/counters are writable. Address, text/summary, links, references and three
Paragraph types are supported. No root create/delete/publish, author/language,
file/image/Media operations. New allowed Paragraphs may be added to an existing
company; every existing item must be preserved, with exact IDs/revisions for edits.

Read current revision, discover WRITE schema, preview desired fields, display the
entire exact BEFORE/AFTER, wait for explicit confirmation, then commit once.
Token is user-bound, one-time and expires after 10 minutes. Verify persisted
revision and audit. Conflicts require a fresh READ/preview/confirmation; do not
retry commits automatically. API enforces account/node/Paragraph locks, snapshots,
transactional revision/audit/token consumption, and 10 commits/account/minute.
A pending mass batch from existing hooks aborts/rolls back the save, including
inconsistent duplicate-company VAT cases; no mass training/price update is started.

Local acceptance: 74 company API checks and 19 actual MCP transport checks
passed using disposable profiles/accounts, plus 228 earlier READ regression
checks. Existing site trainer deletion has a reload-after-delete bug; fixture
cleanup used an in-memory test-only replacement for that delete callback. No
application hook was changed or skipped during actual WRITE operations.

## Training WRITE — checkpoint 1

Existing four Ranking WRITE tools now support simple npx_training fields.
Use `ranking_get_content_write_schema` with `content_type: "npx_training"` to
discover 36 fields, their types/allowed list values and real reference choices.
Omitting content_type preserves the company schema default. Preview/commit/audit
keep their existing names/paths and the same explicit-confirmation protocol.
Training access additionally requires `write ranking training api` and normal
node/field view/update permissions. Company-only permission does not grant it.
WRITE credentials and RANKING_WRITE_ENABLED stay separate and disabled by default.

The schema includes hidden/legacy business fields, stored prices/flags and direct
text program. Description and nested program Paragraphs are supported below; visible heading
and other Paragraphs follow in later checkpoints; no dates/products/variants,
publish, author, create/delete or upload. Do not use npxtraining/4GROW field names.
Existing company/room/discount IDs must come from READ/search/expand; those choices
are not enumerated and are marked incomplete. Taxonomy choices use the actual
selection handler and may also be truncated.

Restricted training saves affect only explicitly supplied fields on that node.
They do not cascade VAT to the company/siblings, delete empty Paragraphs, or
implicitly recalculate net/gross/hourly values. Show all intended related fields
in one preview and wait for confirmation. The backend npx_training integration
guard must be deployed together with the API module. Old and unchanged nested
Paragraph/image content is preserved while Drupal advances revision pointers.

Acceptance: 121 training API + 19 actual MCP checks; regressions 74 company API +
19 company MCP + 228 READ passed. Fixtures removed. No Oracle WRITE activation
or production deployment in this checkpoint.

## Training WRITE — checkpoint 2: description/program Paragraphs

The same four Ranking WRITE tools now expose 38 training fields. Discover
`field_section_05` (one text_indexed description) and `field_section_07` (program
list with nested field_element/program_element lists) through the WRITE schema.
Descriptors include field_types, children and preserved_fields, so use actual
names/labels instead of guessing. field_number_first means duration; list order
is controlled by the list, not this field. Visible heading and other sections
are later checkpoints. Plain-text and structured programs remain independent,
with no owner-role restriction on WRITE.

Use exact existing IDs/revisions and preserve every item at both levels. Edit
with bundle/fields, append new allowed objects with bundle/fields, and reorder
within the same parent. No removal, reparenting, Media editing or uploads;
program_element.field_video is preserved verbatim. Full nested BEFORE/AFTER
includes all content, unchanged siblings and preserved data. Display it exactly,
wait for explicit confirmation, then commit once and fetch the saved tree/audit.
Preview revision IDs describe the current basis; new objects have null IDs;
actual new revision IDs are read after commit. Limits: two levels, 50 items per
field, 250 per operation. Top-level updates now allow at most 38 schema fields.

Tests passed: 59 API + 17 actual MCP calls/checks, including nested additions,
ordering, nonempty Media reference preservation, in-place conflict, real competing
row-lock conflict and forced audit failure/atomic rollback. Backend uses fresh
READ COMMITTED reads within the controlled transaction to avoid stale snapshots
after lock waits; connection defaults are not changed. Regressions passed:
121 training simple API + 19 MCP; 74 company API + 19 MCP. No Oracle deployment
or WRITE activation in this checkpoint.


## Training WRITE — remaining Paragraphs

Current WRITE schema exposes 45 training fields: 36 simple fields and nine
Paragraph fields. The same four Ranking WRITE tools additionally support:

- `field_section_01/title_subtile`: required visible heading (`field_text_1`)
  and subtitle (`field_text_2`), independent of the internal node title.
- `field_section_02/text_indexed`: learning outcomes.
- `field_section_04/icon_text`: audience text; existing Media icons are preserved.
- `field_section_06/text_indexed`: requirements.
- `field_section_08/trainer`: references to existing `trener` nodes.
- `field_section_09/benefit`: existing `szkolenia_benefity` taxonomy terms.
- `field_section_10/booking_rules`: confirmation, cancellation and rescheduling.

Inspect WRITE schema for exact cardinalities and content fields. Keep all existing
Paragraphs in each field; edit/add/reorder with full BEFORE/AFTER and explicit
confirmation. Existing audience icons and program videos are read-only preserved
data; new audience blocks may contain text without an icon. The training image
(`field_section_11`) is outside WRITE. References use the actual Drupal selection
handler, including Views owner/context filters, with no creation of target nodes
or terms. No new tools/endpoints or deployment settings; Oracle WRITE remains
disabled until the separate test deployment step.
