# Book Clubs API (instance-local core)

All routes require the existing JWT authentication guard. The authenticated account ID comes from the verified token; request bodies cannot set the club owner or actor identity. Club roles are local to one club and never grant instance administrator, library administration, or global book-sharing permissions.

## Domain model

- `BookClubEntity` stores name, optional description, `private`/`instance_visible` visibility, active/archived lifecycle, and owner account ID.
- `BookClubWorkEntity` stores only a logical selected-work title and author. It does not point to a library book, file, hash, format, or edition.
- `BookClubMemberEntity` stores the per-club account association and `owner`, `moderator`, or `member` role. Its nullable `personal_book_id` remains a reserved legacy placeholder; this feature does not read, write, or return it.
- `BookClubReadingCopyEntity` stores at most one copy choice per club-member and logical work. `source` is `shared`, `personal`, or `none`; an optional local book ID identifies the chosen copy. The association is instance-local and independent of the club work's title/author and any file hash, format, or edition.
- Clubs, memberships, reading-copy associations, and book pointers exist only in the current instance database. No synchronization, federation, cross-instance invitations, or data transfer is implemented.

## Routes

| Method   | Path                                             | Behavior                                                                                                                                              |
| -------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/book-clubs`                                    | Create a club; caller becomes owner and initial member. Requires `name`, `visibility`, and `selectedWork: { title, author }`; optional `description`. |
| `GET`    | `/book-clubs`                                    | List active instance-visible clubs and private clubs for which caller is a member.                                                                    |
| `GET`    | `/book-clubs/:clubId`                            | Read club and logical selected work. Private clubs require membership.                                                                                |
| `GET`    | `/book-clubs/:clubId/works/:workId/reading-copy` | Read the caller's choice for that club work, including `source`, availability, and a minimal book summary when currently authorized.                  |
| `PUT`    | `/book-clubs/:clubId/works/:workId/reading-copy` | Set/switch the caller's choice with a source of `shared` or `personal` and a UUID `bookId`.                                                           |
| `DELETE` | `/book-clubs/:clubId/works/:workId/reading-copy` | Clear the caller's choice; retains an explicit `none` association for the member/work pair.                                                           |
| `PATCH`  | `/book-clubs/:clubId`                            | Owner-only settings or logical selected-work edit.                                                                                                    |
| `POST`   | `/book-clubs/:clubId/join`                       | Join an active instance-visible club as a member. Private clubs require owner-managed membership.                                                     |
| `POST`   | `/book-clubs/:clubId/members`                    | Owner or moderator adds an instance-local account ID; only owner can assign moderator. Optional role defaults to member.                              |
| `PATCH`  | `/book-clubs/:clubId/members/:userId`            | Owner grants or revokes moderator role (`member`/`moderator`). Ownership changes use the transfer route.                                              |
| `DELETE` | `/book-clubs/:clubId/members/:userId`            | Owner removes members/moderators; moderator removes members only; a member can leave. Owner must transfer ownership first.                            |
| `POST`   | `/book-clubs/:clubId/transfer-ownership`         | Owner transfers ownership to an existing member using `{ "newOwnerUserId": "..." }`; prior owner becomes a member.                                    |
| `POST`   | `/book-clubs/:clubId/archive`                    | Owner archives the club. Archived clubs are omitted from lists and cannot be joined or modified.                                                      |
| `DELETE` | `/book-clubs/:clubId`                            | Owner permanently deletes the club; member and selected-work rows are removed by the club foreign-key cascades.                                       |

Club and member route parameters (`clubId`, `userId`), reading-copy work parameters (`workId`), and add-member/ownership-transfer/reading-copy body IDs must be syntactically valid UUIDs; malformed values return `400`.

Reading-copy requests require membership even for `instance_visible` clubs. A non-member cannot read, set, or clear a private club copy (`404` for private clubs); a non-member of a visible club receives `403`. Choices are per club-member/work. Setting another source replaces that member's existing choice for the same work; clearing records `source: none` and does not delete the member's book or club work. Reads re-check current library access every time. If an association's book is no longer accessible, the API returns `available: false` and `book: null` without deleting the association. The response exposes only the book `id`, `title`, and `author` when authorized; annotations, reading positions, progress, and history are never included.

Self-hosted instances use the existing local book-access behavior for both `shared` and `personal` choices; the source records the member's choice and does not create a new global sharing policy. In Cloud (`CLOUD_MODE=true`), `shared` choices are rejected and personal choices are looked up with the authenticated actor's owner scope, including for instance administrators. Direct non-owned IDs fail with the existing `404 Book not found`; they are not returned or discoverable through reading-copy state. Existing unauthorized Cloud associations are presented as `source: none`, unavailable, with no book data.

Private-club reads and mutations by non-members return the same `404 Book club not found` response so club existence, membership, and selected-work metadata are not disclosed. For target-member mutations, actor visibility/authorization is checked before looking up the target account's membership. Permission failures for visible clubs return `403`; invalid DTOs or malformed UUIDs return `400`; duplicate membership returns `409`; unauthenticated calls return `401`.

Add-member validates UUID syntax only. This backend has no local user entity or user-directory contract, so it does not verify that the supplied ID identifies an existing account or belongs to this instance; it creates a local membership row for the supplied UUID. Ownership transfer likewise accepts a UUID only when it identifies an existing member of that club. Neither route performs a remote user lookup, sends an invitation, or contacts another instance.

## Deliberate exclusions

This core does not implement invitation tokens/notifications, cross-instance sharing, schedules, reading progress, progress sharing, or discussion. The reading-copy endpoints identify the member's currently authorized local book; reading/downloading content still uses the existing book APIs and their authorization behavior. No club role grants access to another member's books. Reading state does not include or aggregate annotations, positions, progress, or history. Deleting a club removes its memberships, logical work, and reading-copy associations through foreign-key cascades; it does not delete members' library books.

## Migration and operations

`CreateBookClubCore1790000000003` creates the instance-local club, membership, and logical-work tables. `CreateBookClubReadingCopy1790000000004` adds one source-aware association per membership/work, with foreign keys that retain the association while nulling a deleted book reference. TypeORM runs both migrations at application startup, following existing repository behavior. The new migration's down method drops only the reading-copy association table and its data; do not revert it against production data without the applicable Owner approval and backup/rollback plan.
