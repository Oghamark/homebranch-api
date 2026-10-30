# Portable EPUB location contract

This additive extension keeps existing serialized web positions and native
KOReader pointers. It never treats a reflowed page number as a portable position.

## Publication map, version 1

`locationMap` is returned with the web publication manifest. Paired devices can
fetch the same map at `GET /koreader/books/:bookId/location-map?formatId=...`
after verified document resolution. Resolution advertises
`capabilities.portableLocation = 1` when this extension is supported.

```ts
interface LocationMap {
  version: 1;
  capabilities?: { passageAnchor: 1 };
  formatId: string;
  contentHash: string;
  fingerprint: string;
  resources: {
    href: string; // Canonical EPUB-internal, decoded path.
    start: number;
    end: number;
    anchor?: { version: 1; exact: string; prefix?: string; suffix?: string };
  }[];
  chapters: {
    id: string; // Resource href plus original fragment, never a title/index.
    title: string;
    href: string;
    fragment?: string;
    kind: 'chapter' | 'resource';
    start: number;
    end: number;
    anchor?: { version: 1; exact: string; prefix?: string; suffix?: string };
  }[];
}
```

Offsets measure UTF-16 code units in whitespace-normalized body text, excluding
script/style/hidden content, concatenated in spine order with one space between
resources. These offsets define ordering and text weights, not universal pages.
Clients must not equate rendered progression with these text offsets when
deciding which chapter contains the current reading point.

Chapter ranges are half-open, except that the publication's final endpoint is
included in its last nonempty range. Nested TOC entries subdivide their parent's
active range; aliases at the same boundary must not create zero-length chapters.
Missing or unusable TOCs use explicitly labeled resource ranges.

Anchors contain bounded literal text starting at a verified section/resource
boundary, plus context where available. Engines must resolve them conservatively:
ambiguous or missing anchors are not permission to guess a chapter. The map
fingerprint covers resource order/content and TOC targets/ranges, including TOC
changes that leave spine text unchanged.

## Position, version 1

Both saved-position writes and native progress writes accept an optional
`location` object. Bridge progress and saved-position reads return it when
present and still compatible with the verified format/map.

```ts
interface PortableLocation {
  version: 1;
  formatId: string;
  contentHash: string;
  mapFingerprint: string;
  href: string;
  resourceProgression: number;
  chapterId?: string;
  chapterProgression?: number;
  basis: 'text' | 'rendered';
  native?: { engine: 'crengine'; domVersion: number };
  passage?: { version: 1; exact: string; prefix?: string; suffix?: string };
}
```

All progression values are finite fractions in `[0, 1]`. Chapter ID and chapter
progression must occur together. `href` must belong to the map and intersect the
named chapter range. A chapter's identity can be exact while placement within it
remains approximate. An unsupported or unverified section uses resource-only
coordinates or the pre-existing whole-book percentage fallback.

The optional native metadata identifies the actual DOM version used to create
the separate native pointer. A new portable location's native pointer is usable
for precise restoration only with matching publication/map and DOM version.
The existing raw web locator and native pointer remain available for
compatible precise restoration. Cross-engine jumps prefer a verified literal
passage before chapter progression, resource progression, and whole-book
approximation. A verified passage means the same text, not identical pagination
or screen coordinates.
Destination-local chapter pages may be displayed as approximate, but are never
stored as universal coordinates.

Passages are optional and edition/resource-bound. `exact` is at most 256 UTF-16
units and must contain at least eight units after trimming; optional nonempty
contexts are at most 64 units each. Control characters and unknown fields are
rejected. Clients capture whitespace-normalized excerpts without cutting
surrogate pairs. Matching is literal, confined to the resource/chapter
intersection, and requires a unique occurrence or uniquely matching context.
Ambiguous, missing, or over-limit passages retain an explicitly labeled
approximate fallback. A passage must never establish an otherwise unverified
chapter identity.

The plugin extracts excerpts inside its cooperative sync worker, not during page
turns. It retains one outgoing excerpt, one incoming match, and one normalized
scope. Passage verification is limited to 65,536 text units, 256 KiB of exported
HTML, and 2,048 opening tags. Native candidate searches are publication-wide
because crengine exposes no scoped search argument; their results are capped at
257 and filtered to the verified scope. Very common prefixes can therefore
require fallback even when a scope contains a unique passage. The duplicate
proof and context exports stay inside that scope; passage matching does not
export the whole publication or build a publication-wide character index.
The existing chapter-boundary mapper has separate publication-level limits.
Native calls cannot be interrupted mid-call, so desktop timing is not a
performance guarantee for an e-reader.

Writes update raw/native progress and its portable projection under the same
server revision. Legacy writes clear stale portable data. Retried operations
retain their original payload and operation ID; adding this extension must not
invalidate legacy acknowledgements. Historical percentages alone cannot be
backfilled into exact chapter identities.

## API rollout and compatibility

- Deploy passage-capable API validation first. Document resolution advertises
  `capabilities.passageAnchor = 1`, and location maps advertise the same optional
  capability. Clients omit passage fields when the map does not advertise
  support. Capabilities do not alter map fingerprints. Existing nullable JSONB
  locations carry the additive passage without a new migration. Passage fields
  participate in mutation hashes when supplied; operations without them retain
  their historical serialization and retry acknowledgements.
- `GET /users/:userId/saved-positions/book-ids` discovers reading books from the
  authenticated user's actual browser positions and accepted linked shared
  progress, including zero percent. IDs are deduplicated and filtered for deleted
  books and cloud tenant access. The URL user ID never selects another user's
  data. This does not create or return synthetic browser locators; existing
  saved-position reads retain their original contract. Deploy the API before
  the web client that consumes this discovery endpoint.
- Resetting a reading position through the existing per-book `DELETE` also
  accepts plugin-only progress. It clears the browser row and shared
  percentage/native/portable projection under a new server revision, regardless
  of which reader last wrote it. Raw native history and immutable mutation
  acknowledgements remain intact. Replaying an accepted operation or relinking
  its old native history cannot resurrect the entry; new reading progress can.
- Deploy migration `1790000000013-EpubPortableLocation` before updated clients.
  It adds nullable JSONB locations to saved positions and shared progress, and a
  nullable saved-position revision. Historical rows are left unchanged.
- Saved positions expose `revision: string | null`; new EPUB saves receive the
  same revision as their shared progress projection. Bridge progress retains its
  existing `revision` field and optional `location`. Ordinary PDF/audio saves
  continue to work without a portable location.
- Native `PUT /koreader/syncs/progress` accepts optional `location` alongside the
  existing fields. Its acknowledgement and raw `GET` response remain unchanged:
  portable information is returned only through the extension progress API.
- The device-only map endpoint requires a UUID `formatId` belonging to the
  requested accessible EPUB book, previously verified by document resolution.
  It grants no content/download permission. Supplied stale identities, invalid
  fractions, unmatched chapter/resource pairs, and malformed optional data fail
  visibly instead of degrading into a successful approximate write.
- Incompatible persisted locations are omitted/null on reads, without changing
  their historical raw positions, percentages, revisions, or timestamps.
  Percentage-only writes explicitly clear a prior location in the same revision.
  When an incompatible stored portable location accompanied a native pointer,
  the bridge also suppresses `nativeProgress`; it must not masquerade as a
  genuinely legacy pointer and bypass publication/DOM checks. Historical rows
  whose location is actually null keep their legacy bridge behavior. Raw native
  GET replies remain unchanged in both cases.
- Native mutation hashes retain their exact historical input when `location`
  is absent. New optional location/provenance fields participate only when
  supplied. An accepted operation can still be retried after a newer write or
  map replacement without advancing the shared revision.

The archive cache checks storage size, modification time, and ETag, and verifies
that these remain stable while loading. Archive work is limited to 4,096 entries
and 64 MiB uncompressed; XML/text resources have separate size and depth limits.
Map caches belong to the verified archive instance, so storage replacement
invalidates the map too.

Text extraction excludes script/style/head/template/noscript, `hidden`,
`aria-hidden="true"`, and inline `display:none`/`visibility:hidden` subtrees.
Block elements contribute whitespace; inline text stays contiguous. External
CSS/layout and engine-specific text extraction can differ: a missing or ambiguous
boundary quote requires a labeled resource/whole-book fallback, never a guessed
chapter. An unresolved TOC fragment also prevents an earlier chapter from
silently extending across its resource. That resource and subsequent unmapped
text use explicitly named resource ranges until another verified section.
