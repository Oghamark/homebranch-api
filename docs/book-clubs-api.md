# Book Clubs API (instance-local core)

All routes require the existing JWT authentication guard. The authenticated account ID comes from the verified token; request bodies cannot set the club owner or actor identity. Club roles are local to one club and never grant instance administrator, library administration, or global book-sharing permissions.

## Domain model

- `BookClubEntity` stores name, optional description, `private`/`instance_visible` visibility, active/archived lifecycle, and owner account ID.
- `BookClubWorkEntity` stores only a logical selected-work title and author. It does not point to a library book, file, hash, format, or edition.
- `BookClubMemberEntity` stores the per-club account association and `owner`, `moderator`, or `member` role. `personal_book_id` is a nullable, local-catalog pointer reserved for future personal-copy association; this API does not read, write, or return it.
- Clubs, membership rows, and the optional local book pointer exist only in the current instance database. No synchronization, federation, cross-instance invitations, or data transfer is implemented.

## Routes

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/book-clubs` | Create a club; caller becomes owner and initial member. Requires `name`, `visibility`, and `selectedWork: { title, author }`; optional `description`. |
| `GET` | `/book-clubs` | List active instance-visible clubs and private clubs for which caller is a member. |
| `GET` | `/book-clubs/:clubId` | Read club and logical selected work. Private clubs require membership. |
| `PATCH` | `/book-clubs/:clubId` | Owner-only settings or logical selected-work edit. |
| `POST` | `/book-clubs/:clubId/join` | Join an active instance-visible club as a member. Private clubs require owner-managed membership. |
| `POST` | `/book-clubs/:clubId/members` | Owner or moderator adds an instance-local account ID; only owner can assign moderator. Optional role defaults to member. |
| `PATCH` | `/book-clubs/:clubId/members/:userId` | Owner grants or revokes moderator role (`member`/`moderator`). Ownership changes use the transfer route. |
| `DELETE` | `/book-clubs/:clubId/members/:userId` | Owner removes members/moderators; moderator removes members only; a member can leave. Owner must transfer ownership first. |
| `POST` | `/book-clubs/:clubId/transfer-ownership` | Owner transfers ownership to an existing member using `{ "newOwnerUserId": "..." }`; prior owner becomes a member. |
| `POST` | `/book-clubs/:clubId/archive` | Owner archives the club. Archived clubs are omitted from lists and cannot be joined or modified. |
| `DELETE` | `/book-clubs/:clubId` | Owner permanently deletes the club; member and selected-work rows are removed by the club foreign-key cascades. |

Club and member route parameters (`clubId`, `userId`) and the add-member/ownership-transfer target IDs must be syntactically valid UUIDs; malformed values return `400`.

Private-club reads and mutations by non-members return the same `404 Book club not found` response so club existence, membership, and selected-work metadata are not disclosed. For target-member mutations, actor visibility/authorization is checked before looking up the target account's membership. Permission failures for visible clubs return `403`; invalid DTOs or malformed UUIDs return `400`; duplicate membership returns `409`; unauthenticated calls return `401`.

Add-member validates UUID syntax only. This backend has no local user entity or user-directory contract, so it does not verify that the supplied ID identifies an existing account or belongs to this instance; it creates a local membership row for the supplied UUID. Ownership transfer likewise accepts a UUID only when it identifies an existing member of that club. Neither route performs a remote user lookup, sends an invitation, or contacts another instance.

## Deliberate exclusions

This core does not implement invitation tokens/notifications, shared book-file access, cross-member copy resolution, schedules, reading progress, progress sharing, discussion, or Cloud-vs-self-hosted copy authorization. The nullable personal-copy pointer is not exposed or writable through these endpoints. Deleting a club permanently deletes only its club, membership, and selected-work records using the existing foreign-key cascades; it does not delete members' personal catalog books. In particular, no club role authorizes access to another member's books. Add a separately reviewed contract and authorization tests before any copy-access feature.

## Migration and operations

`CreateBookClubCore1790000000003` creates the three tables, role/visibility/state constraints, membership uniqueness, one-owner-per-club uniqueness, and cascading club cleanup. The personal-catalog pointer is set null when its local book row is deleted. TypeORM is configured to run migrations at application startup, following existing repository behavior. The down migration drops all Book Club tables and their data; do not use it against production data without the applicable Owner approval and backup/rollback plan.
