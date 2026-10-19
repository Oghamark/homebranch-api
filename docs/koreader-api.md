# KOReader API

Use the API origin plus `/koreader` as the custom sync root. OPDS remains separate at `/opds/v1/catalog`; this integration does not transfer books or modify OPDS authentication. Only EPUB library bridging and private annotations are supported. Existing saved-position routes and response shapes remain unchanged.

## Deployment and credentials

- Require HTTPS end to end for public requests. Production startup rejects an absent or non-HTTPS `APP_URL`. This configuration check does not provide TLS termination. Configure the reverse proxy and redirect or reject HTTP separately. Forward the custom authentication headers and preserve any API prefix.
- Do not log request bodies or `x-auth-user`, `x-auth-key`, authorization headers, cookies, or pairing responses. Redact them in reverse-proxy/APM configuration too. Integration success responses use `Cache-Control: no-store`.
- Pairing issues random, replayable, sync-only device keys, not account passwords or password MD5s. Server storage contains SHA-256 verifiers, never recoverable device keys. Comparison is constant time. The reader may persist its device key in ordinary KOReader settings under the explicit user-approved exception; that is not encrypted storage.
- A device expires after 365 days. Revoke it through settings, `DELETE /devices/:id`, or native `DELETE /users/me`. Revocation and each device read/write serialize on the device row; a write already holding that row can finish before revocation, but a stale preauthenticated request cannot write after revocation commits.
- Device credentials do not authorize general Homebranch API routes. Scope is limited to the explicitly listed integration endpoints and permitted EPUB identity lookup. Annotation ownership is always the current user, including administrators and shared self-hosted libraries.
- Cloud entitlements use the existing fail-closed entitlement service and its existing cache lifetime. Device bindings deliberately do not inherit an administrator's library-wide role. Non-cloud account suspension/deletion and password-reset/session-revocation events are not available to this module through the current Authentication contract. Those events therefore do **not** automatically invalidate device bindings. Revoke bindings explicitly. No Authentication changes or fake password-reset invalidation are introduced here.
- Back up the new tables alongside the rest of PostgreSQL. Their contents include private quotes, notes, native positions, operation acknowledgements, and verifiers.

All paths below are relative to `/koreader`. Browser authentication means the existing JWT cookie or bearer token. Native authentication means both `x-auth-user` and `x-auth-key`.

## Pairing and devices

| Method | Path                | Authentication                    | Response                                                          |
| ------ | ------------------- | --------------------------------- | ----------------------------------------------------------------- |
| POST   | `/pairings`         | Public                            | `{deviceCode,userCode,verificationPath,expiresIn:600,interval:5}` |
| POST   | `/pairings/claim`   | Public, polling secret            | `{state:"pending"}` or `{state:"approved",username,key,deviceId}` |
| POST   | `/pairings/approve` | Browser                           | `{state:"approved"}`                                              |
| GET    | `/devices`          | Browser                           | Array of `{id,name,createdAt,lastSeenAt,expiresAt}`               |
| DELETE | `/devices/:id`      | Browser, or that same device only | 204                                                               |

Creation body: `{deviceName}`. Approval body: `{userCode}`. Claim body: `{deviceCode}`. The verification path is `/settings?section=koreader&code=...` on the web origin. Names are bounded to 128 characters. Human codes contain 40 random bits and last ten minutes. Polling secrets contain 256 random bits; a human code cannot claim credentials. Approval and claim are single-use. A lost successful claim response cannot be recovered because the server does not store the usable key; restart pairing and revoke the abandoned binding from settings.

Durable per-minute rate limits: five creations per caller IP, sixty claims per caller IP, twenty approvals per authenticated user. Each pairing can poll at most every five seconds. Exceeded limits return 429, expired/replayed polling secrets return 401, and unavailable approval codes return 404. At most fifty unexpired active devices can be paired per user. Use a correctly configured trusted proxy for `request.ip`; do not blindly trust arbitrary forwarded IP headers. Old pairing/rate rows are pruned on pairing creation.

## Native progress protocol

| Method | Path                        | Behavior                                                           |
| ------ | --------------------------- | ------------------------------------------------------------------ |
| GET    | `/healthcheck`              | Public `{state:"OK"}`                                              |
| GET    | `/users/auth`               | Native `{authorized:"OK"}`                                         |
| PUT    | `/syncs/progress`           | Native progress update                                             |
| GET    | `/syncs/progress/:document` | Native progress or `{}`                                            |
| POST   | `/users/create`             | Disabled, 402 `{code:2005,message:...}` with pairing guidance      |
| DELETE | `/users/me`                 | Native; revokes only the current binding, returns `{deleted:true}` |
| PUT    | `/users/password`           | Native; unsupported, 403 protocol error; revoke and pair again     |

PUT body:

```json
{
  "document": "0123456789abcdef0123456789abcdef",
  "progress": "/body/DocFragment[1]/body/p[1]/text().0",
  "percentage": 0.42,
  "device": "KOReader",
  "device_id": "reader-identity",
  "mutationId": "optional-plugin-operation-id"
}
```

The stock client's `device_id` and the extension's `mutationId` are optional. Native `metadata` is ignored rather than used to guess identity. The document must be the 32-hex binary partial-MD5 identifier, not filename mode. Percentage is a finite numeric fraction in `[0,1]`; progress is an opaque string up to 8192 characters. Device fields are bounded to 128 characters. Positions are stored raw, never parsed as Readium locators or fabricated from web percentages.

PUT returns `{document,timestamp}`, where timestamp is server Unix **seconds**. GET returns the actual last native `{document,progress,percentage,device,device_id?,timestamp}`, or exactly `{}` when absent. A newer web save does not rewrite this native pointer or its timestamp. The plugin must check the extension progress endpoint first to detect newer web percentage progress. Clients using native sync alone see native progress only. All devices of a single Homebranch user share that user's native records.

Plugin retries using the same mutation ID and identical normalized payload return the original acknowledgement without advancing ordering or restoring an old position. Stock clients omit this ID, so their independent requests each count as new accepted events. Invalid native fields return protocol-shaped 403 errors; authentication failures return 401/code 2001. Native account deletion never deletes a Homebranch account.

## Verified document resolution

Device-only `POST /documents/resolve` takes `{document,contentHash?,formatId?}` and returns `{bookId,formatId,title}`. Resolution never name-matches. No accessible match returns 404; multiple accessible matching EPUB formats return 409.

`contentHash`, when supplied, is the existing metadata-insensitive EPUB spine SHA-256, not a hash of the ZIP bytes. The API independently calculates it from bounded server file content, using `ContentHashService`; a database hash or client assertion alone cannot link a file. A verified match can register the reader's original partial-MD5 alias even when the server rewrote metadata before the first pairing. A supplied nonmatching content hash does not silently fall back to a partial-MD5 match. This full-content verification is limited to EPUBs within the size bounds below; larger files can resolve by their current exact partial-MD5 without a content-hash hint.

The same verification applies to already-linked aliases. Cache entries are bound to storage fingerprints, including R2 ETag so a same-size replacement within one timestamp tick is detected. If changed canonical content has the same sparse partial-MD5, an old `contentHash` returns 404 rather than reusing that stale link. The caller should recompute canonical identity and resolve on each document-open session, and retain queued work on unresolved or conflicting identities.

If multiple formats have the same verified content, the reader can explicitly choose `formatId`. That selection requires a matching `contentHash` and current library visibility, and is persisted privately for this user's document. It does not select an arbitrary candidate, expose a list of inaccessible formats, or weaken content verification. An unselected ambiguous request remains 409. Selected aliases are protected by a partial unique index and the per-user transaction lock.

The independent KOReader partial-MD5 samples up to 1024 bytes at offsets `0,1024,4096,16384,...,1073741824`, stopping at EOF. The first offset reproduces LuaJIT's modulo-32 left-shift behavior. It is not Homebranch's existing SHA-256 content hash.

Resolution scans only accessible EPUB formats in keyset pages of at most 32 per request, using bounded local/R2 range streams and a full-verification byte budget. Libraries larger than one page or verification budget return 503 while a per-user durable scan cursor advances; retry the same request until complete. An explicit format selection verifies just that accessible format. The client must retain pending work on 404/409/503 and must not apply positions or annotations to an unverified format. A complete unselected scan checks collisions before returning a match.

Aliases are scoped to user and format, with storage size/mtime/path, R2 ETag, and ingestion-hash fingerprints. The selected format and previously linked aliases can additionally use a conservative metadata-independent fingerprint, capped at 32 MiB compressed, 64 MiB declared expanded data, and 4096 ZIP entries. This hashes all resource paths/bytes and non-metadata OPF structure. Only equivalent content retains old aliases through metadata repacking. Replacements, spine changes, unreadable files, or files beyond this verification bound invalidate old aliases when bytes change. Large unchanged EPUBs still support sampled identity, but not metadata-rewrite retention. Storage must honor byte ranges; incomplete or ignored ranges fail visibly. Identity checks do not constitute a cryptographic guarantee against intentionally crafted partial-MD5 collisions.

Native raw progress can exist before resolution. When it is linked later, its original revision is projected only if newer than existing book progress, so linking cannot overtake a more recently accepted web save.

## Progress bridge

Browser or device `GET /books/:bookId/progress` returns JSON `null` or:

```json
{
  "percentage": 0.42,
  "source": "koreader",
  "accuracy": "approximate",
  "nativeProgress": "/body/DocFragment[1]/body/p[1]/text().0",
  "device": "KOReader",
  "revision": "28",
  "updatedAt": "2026-10-16T20:00:00.000Z"
}
```

`nativeProgress` is supplied only when the latest accepted source is KOReader. A web source returns `accuracy:"exact"` to a browser for its own existing saved locator, not a promise of exact cross-engine navigation. Device callers receive `accuracy:"approximate"` for a web percentage transfer. A KOReader source is approximate for the web reader. No CFI/XPointer-to-Readium exact mapping is claimed.

Existing web saves participate in the same transactional per-user ordering and leave the saved-position API response unchanged. A save without a percentage still supersedes older native bridge progress and yields `null`, rather than falsely representing an old native pointer as current. Legacy web rows are exposed with revision `"0"`. Backward reading changes are valid latest updates; percentages are never maximized. Server revisions, not wall clocks or client timestamps, determine accepted ordering.

## Private annotations and incremental sync

Browser or device:

- `GET /books/:bookId/annotations?after=cursor` returns `{items,cursor,hasMore}`. Omit `after` or use `"0"` for a full retained-state sync. Follow pages while `hasMore` is true; pages contain at most 100 items.
- `PUT /books/:bookId/annotations/:id` accepts a full replacement `{mutationId,quote,note,color,anchor,deleted?}` and returns the accepted Annotation.

Annotation:

```json
{
  "id": "reader-stable-id",
  "bookId": "book-uuid",
  "quote": "Exact highlighted quotation",
  "note": "Private note",
  "color": "yellow",
  "anchor": {
    "version": 1,
    "href": "EPUB/chapter.xhtml",
    "exact": "Exact highlighted quotation",
    "prefix": "optional preceding text",
    "suffix": "optional following text",
    "native": {
      "pos0": "/body/DocFragment[1]/body/p[1]/text().0",
      "pos1": "/body/DocFragment[1]/body/p[1]/text().27",
      "domVersion": 20230509
    }
  },
  "deleted": false,
  "revision": "29",
  "updatedAt": "2026-10-16T20:00:01.000Z"
}
```

Only `version` and nonempty `exact` are required in an anchor. `href`, context, and native selectors are independent optional evidence, not proof of a matching range. Persisting an unresolved selector is valid and does not assert successful rendering. Clients must use conservative exact matching, reject ambiguity, and retain unresolved items visibly. Native anchors are not exact Readium locators. Treat quotes, notes, colors, and paths as untrusted data.

IDs and mutation IDs use 1 to 128 ASCII letters, digits, underscore, or hyphen. Quote/note/exact are bounded to 32768 characters, context to 2048, href to 2048, color to 64, and each native position to 8192. Deleted items still require their full persisted selector and text. Cross-book reuse of an annotation ID is rejected.

Every accepted mutation locks a per-user revision row until commit, then increments that transaction's revision. There is no sequence/commit-order race. Revisions/cursors are decimal strings, not JavaScript numbers. Operation IDs are deduplicated across that user's integration mutations; reusing one for a different operation returns 409. A retry returns the original acknowledgement, even if the annotation was subsequently changed or deleted. It does not reorder or resurrect that old content.

Incremental pages include deletion tombstones. There is currently no tombstone or operation-acknowledgement cleanup; both are retained indefinitely, so offline clients can safely resume or perform a full retained-state sync. Full replacement with a new operation ID after a deletion is an explicit later accepted edit and can restore the item. Library access is rechecked on reads/writes and retries. Administrators cannot read another user's annotations.

## Migration and tests

`1790000000011-CreateKoreader` creates device, pairing, revision, alias, native-progress, book-progress, annotation, mutation, and rate state without altering existing saved-position rows. `1790000000012-KoreaderVerifiedContent` adds independently verified spine hashes, unique explicit document selections, and format ownership for annotations. Existing annotations are backfilled to the current EPUB format where available. Removing a format retains its private annotations with nullable format ownership; their old selectors remain untrusted and can be unresolved. Both migrations are explicitly registered in the runtime TypeORM module. CLI migration/entity discovery uses the existing compiled `dist/migrations/**/*.js` and `dist/**/*.entity{.ts,.js}` globs. Schema synchronization remains disabled.

Focused validation:

```sh
npm test -- --runInBand test/modules/koreader test/modules/saved-position
npm run build
```

For real PostgreSQL migration, concurrency, persistence, deduplication, pagination, isolation and alias tests, set `KOREADER_TEST_DATABASE_URL` to a disposable PostgreSQL database. Tests create and remove an isolated random schema, apply the real migration, and never use schema synchronization. Do not point a test URL at an untrusted server or publish its credentials.

### Local live interoperability harness

`test/modules/koreader/koreader.live-harness.ts` starts the real integration controllers, JWT/device guards, storage identity checks, saved-position service, and PostgreSQL services against one synthetic EPUB. It does not import the production application or read the development library. It creates a random isolated schema and drops only that schema on SIGINT/SIGTERM.

Set `KOREADER_TEST_DATABASE_URL`, `KOREADER_FIXTURE_PATH`, and a fresh 32+ character `KOREADER_TEST_JWT_SECRET` through the process environment. For HTTPS, also set `KOREADER_TEST_TLS_KEY` and `KOREADER_TEST_TLS_CERT` to local test key/certificate files; an encrypted key can use `KOREADER_TEST_TLS_PASSPHRASE`. Configure the native client to trust the test CA, and verify its hostname. Do not disable TLS verification. Optionally set `KOREADER_TEST_PORT`; the default chooses an ephemeral localhost port.

```sh
TS_NODE_FILES=true node -r ts-node/register -r tsconfig-paths/register \
  test/modules/koreader/koreader.live-harness.ts
```

The process prints only the localhost URL, synthetic user/book/format IDs, document/spine hashes, and schema name. It never prints credentials. A test driver can sign a short-lived HS256 JWT with `sub` equal to the printed synthetic user ID, using the test secret already in its environment, then perform real pairing approval and native/annotation operations. Test credentials and TLS material are not production secrets and must not be committed. This harness is test tooling, not a public authentication bypass or new production endpoint.

When started with Node `fork`, the child sends `{type:"ready",url,userId,bookId,formatId,document,contentHash,schema}` over IPC instead of stdout. In IPC mode it can generate its own JWT secret in memory, so `KOREADER_TEST_JWT_SECRET` is unnecessary. Send `{type:"approve",requestId,userCode}` to perform a real JWT-authenticated HTTP approval using a synthetic browser token retained entirely inside the child. It returns only `{type:"approved",requestId,state:"approved"}`, never a JWT or device key. Device creation and credential claim still happen through the ordinary real HTTP endpoints. Send `{type:"shutdown"}` for cleanup. Parent disconnection, SIGINT, SIGTERM, and the bounded lifetime also stop the server and drop its isolated schema. The default lifetime is five minutes, configurable with `KOREADER_TEST_MAX_DURATION_MS`, capped at fifteen minutes.

`koreader.live.spec.ts` executes this IPC flow against real PostgreSQL and confirms the child exits and removes its schema.

### Repeatable API and native acceptance commands

From the API repository, start a dedicated fixture-only database, not the development library:

```sh
export KOREADER_TEST_WORKSPACE_ROOT="$(cd .. && pwd)"
PG_CONTAINER=homebranch-koreader-api-validation
docker run --rm --detach --name "$PG_CONTAINER" \
  -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1::5432 postgres:16
docker exec "$PG_CONTAINER" pg_isready -U postgres
export KOREADER_TEST_DATABASE_URL="postgresql://postgres@$(docker port "$PG_CONTAINER" 5432/tcp)/postgres"
export KOREADER_FIXTURE_PATH="$(mktemp --suffix=.epub)"
python "$KOREADER_TEST_WORKSPACE_ROOT/koreader-plugin/test/package-fixture.py" "$KOREADER_FIXTURE_PATH"
```

If PostgreSQL is still starting, repeat `pg_isready` before continuing. Trust authentication is for this disposable localhost-bound synthetic fixture container only, never production. Each test/harness uses a separate random schema, minimal synthetic base tables, and the real `CreateKoreader1790000000011` then `KoreaderVerifiedContent1790000000012` migration. Schema synchronization is never enabled. The migration test also runs both down migrations and reapplies both up migrations. Normal completion and error cleanup drop only the exact generated schema.

```sh
npm test -- --runInBand --cacheDirectory .koreader-validation-cache \
  test/modules/koreader test/modules/saved-position

npx eslint src/modules/koreader/*.ts src/migrations/179000000001{1,2}-*.ts \
  src/modules/saved-position/saved-position.service.ts \
  test/modules/koreader/*.ts \
  test/modules/saved-position/saved-position.service.save-position.spec.ts \
  test/modules/saved-position/saved-position.service.delete-saved-position.spec.ts --quiet

npm run build -- --path test/modules/koreader/tsconfig.build.json
```

The checked-in validation build configuration emits to `.koreader-validation-dist`, so Nest never unlinks or overwrites a root-owned production `dist`. It uses the existing compiler and dependencies.

To execute the checked-in real native driver, use an isolated extracted KOReader
runtime directory containing `luajit` and `data/`:

```sh
export KOREADER_TEST_RUNTIME_DIR=/absolute/path/to/isolated/koreader
export KOREADER_TEST_NATIVE_DRIVER="$KOREADER_TEST_WORKSPACE_ROOT/koreader-plugin/test/live-api.lua"
TS_NODE_FILES=true node -r ts-node/register -r tsconfig-paths/register \
  test/modules/koreader/koreader.native-acceptance.ts
```

This executable starts the real Nest/PostgreSQL fixture, generates an RSA key only in Node memory, issues a localhost SAN certificate through OpenSSL's anonymous stdin pipe, and starts a local HTTPS proxy. It temporarily appends only the public certificate to the isolated native runtime's CA bundle and restores the original bytes in `finally`. It refuses a CA-bundle target outside that isolated runtime. TLS chain and hostname verification remain enabled. Server JWT/database secrets are not inherited by the Lua child.

The unchanged Lua driver runs through `./luajit` with genuine in-memory KOReader `LuaSettings:wrap({})` bootstrap and SDL's dummy video driver. It uses the real plugin transport, TLS, anchor codec, and crengine. Native control messages drive actual JWT-authenticated browser HTTP mutations. The bounded run verifies pairing, both checksums, portable quote/native ranges, bidirectional annotation creation/edit/deletion, retry acknowledgement ordering, tombstones after replay, native `.27` progress, approximate web `.71` progress without stale pointers, backward `.12` progress, and revoked read/write 401s. It does not claim this headless driver itself exercises the full ReaderUI or browser DOM.

The deterministic fixture must produce partial-MD5 `840a5c4dd0419dd389ea956f985f8b8d` and spine SHA-256 `1060596e6363adce9ac22c3b7781a05134ba7947353e4f3059d9c0e57d0d7204`.

After validation:

```sh
docker stop "$PG_CONTAINER"
rm -rf .koreader-validation-cache .koreader-validation-dist
rm "$KOREADER_FIXTURE_PATH"
```

The native runner closes its API, proxy, Lua child, and schema, restores the CA bundle, and removes a newly created fixture cache. No private key or device credential file is written.

### Explicit regression evidence

The PostgreSQL suite includes:

- Existing alias plus conflicting canonical identity: two stored EPUBs have identical sampled partial-MD5, size, and mtime, but changed chapter bytes/SHA-256 and R2 ETag. The old canonical hash returns 404 instead of trusting the old alias.
- Mutation deduplication: identical retries retain their original revision, changed reuse of an operation ID returns 409, and replaying an earlier creation after deletion does not resurrect it.
- Native/web ordering: retrying an old native operation after a web save does not supersede the web save; backward progress is accepted normally.
- Revocation concurrency: revocation waits for a transaction already holding the device lock; every later write, including a previously authenticated actor, is rejected.
- Commit ordering: another mutation cannot allocate/commit a later revision while the preceding user lock is held; incremental cursors cannot skip that delayed transaction.

### API change inventory

New production files:

- `src/migrations/1790000000011-CreateKoreader.ts`
- `src/migrations/1790000000012-KoreaderVerifiedContent.ts`
- `src/modules/koreader/epub-identity.ts`
- `src/modules/koreader/koreader-auth.service.ts`
- `src/modules/koreader/koreader-document.service.ts`
- `src/modules/koreader/koreader-ordering.ts`
- `src/modules/koreader/koreader-validation.ts`
- `src/modules/koreader/koreader.controller.ts`
- `src/modules/koreader/koreader.entity.ts`
- `src/modules/koreader/koreader.guard.ts`
- `src/modules/koreader/koreader.module.ts`
- `src/modules/koreader/koreader.service.ts`
- `src/modules/koreader/partial-md5.ts`

New tests/tooling:

- `test/modules/koreader/koreader-auth.spec.ts`
- `test/modules/koreader/koreader-validation.spec.ts`
- `test/modules/koreader/koreader.api.spec.ts`
- `test/modules/koreader/koreader.persistence.spec.ts`
- `test/modules/koreader/partial-md5.spec.ts`
- `test/modules/koreader/koreader.live-harness.ts`
- `test/modules/koreader/koreader.live.spec.ts`
- `test/modules/koreader/koreader.native-acceptance.ts`
- `test/modules/koreader/tsconfig.build.json`

Updated integration points:

- `src/app.module.ts`
- `src/modules/typeorm/typeorm.module.ts`
- `src/modules/saved-position/saved-position.service.ts`
- `src/modules/storage/storage.types.ts`
- `src/modules/storage/r2-storage.ts`
- `test/modules/saved-position/saved-position.service.save-position.spec.ts`
- `test/modules/saved-position/saved-position.service.delete-saved-position.spec.ts`
- `jest.config.ts` (anchored aliases prevent dependency-relative `./src/index` imports from being incorrectly mapped)
- `README.md`
- `docs/koreader-api.md` (new)

No Authentication, web, plugin, workspace, or unrelated social/book-club files are part of this API change set.
