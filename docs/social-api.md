# Instance-local social and notifications API

Every route uses the existing JWT/Cloud entitlement guard. The actor is always the verified account, never a body field. Cloud read-only/blocked subscription behavior is unchanged. Requests, settings, friendships, invitations, mutes, and notifications persist in the instance database; Authentication remains the identity authority. No emails, private library data, reading positions, discussion bodies, or spoiler-bearing discussion titles appear in these responses.

## Discovery, friendships, and personal controls

| Method | Route | Body / response |
| --- | --- | --- |
| GET | `/social/people?q=...` | `[{id,name}]`, at most 20. Trimmed query length 2–254; display-name substring or exact email only. No email returned. Self and either-direction blocks are excluded. |
| GET | `/social/friends` | `[{userId,name}]`, visible only to the authenticated account. |
| GET | `/social/friend-requests` | `{incoming:[{id,userId,name,createdAt}],outgoing:[{id,userId,name,createdAt}]}`. Pending generations only. |
| POST | `/social/friend-requests` | `{userId}` → `{id,status:"pending",userId,name}`. Target verified against Authentication. |
| POST | `/social/friend-requests/:id/accept` | Recipient only → `{id,status:"accepted"}`. A reversed send never accepts a request. |
| POST | `/social/friend-requests/:id/decline` | Recipient only → `{id,status:"declined"}`. |
| POST | `/social/friend-requests/:id/cancel` | Sender only → `{id,status:"cancelled"}`. |
| DELETE | `/social/friends/:userId` | Remove accepted friendship → `{success:true}`. |
| GET / PATCH | `/social/settings` | `{allowFriendRequests:boolean,clubInvites:"anyone"\|"friends"\|"nobody"}`. PATCH accepts either/both fields. Defaults: `true`, `"anyone"`. |
| GET | `/social/blocks` | `[{userId,name}]`, caller's directional blocks only. |
| POST | `/social/blocks` | `{userId}` → `{success:true}`. Target verified against Authentication. |
| DELETE | `/social/blocks/:userId` | `{success:true}`. Unblocking restores nothing automatically. |

Names retained locally are validated display names, never account email or administrator profiles. Discovery and sends use only the configured `AUTH_SERVICE_URL`, forwarding only the verified access credential. Authentication outages are errors, not empty lists or permission to continue.

Blocking denies requests/invitations in both directions, cancels pending requests/invitations, and removes friendship. It does **not** change either account's shared club membership, roles, roster, discussions, or moderation powers. Disabling friend requests cancels incoming pending requests. Tightening club invitation policy cancels affected invitations. Removing friendship cancels outstanding invitations that depend on the recipient's friends-only policy; existing memberships remain unchanged.

## Club invitations and activity preference

| Method | Route | Body / response |
| --- | --- | --- |
| GET | `/social/club-invitations` | `[{id,clubId,clubName,bookTitle,bookAuthor,inviterUserId,inviterName,expiresAt,status:"pending"}]`. Minimal recipient-only private preview. |
| POST | `/social/club-invitations/:id/accept` | `{id,status:"accepted",clubId}`. Creates ordinary membership only, with progress sharing off and no reading-copy association. |
| POST | `/social/club-invitations/:id/decline` | `{id,status:"declined",clubId}`. |
| GET | `/book-clubs/:clubId/invitations` | Active owner/moderator only → `[{id,userId,name,expiresAt,status:"pending"}]`. Not part of member roster. |
| POST | `/book-clubs/:clubId/invitations` | Active owner/moderator only; `{userId}` → `{id,userId,name,expiresAt,status:"pending"}`. No roles accepted. |
| POST | `/book-clubs/:clubId/invitations/:id/cancel` | Active owner/moderator only → `{id,status:"cancelled",clubId}`. |
| GET / PUT | `/book-clubs/:clubId/activity-preference` | Current member only; PUT `{muted:boolean}` → `{muted:boolean}`. Default false. |

Invitations expire after exactly 30 days, enforced at read/action time without a worker. One pending invitation is allowed per club/invitee. Self-invitations and invitations to existing members are rejected. Viewing/sending never confers membership or access to club detail, roster, discussions, or schedule. Public self-joining remains supported and resolves a valid pending invitation under the same transaction.

Acceptance rechecks generation, expiry, active club, inviter authority, blocks, recipient policy, and current membership. Archive, club deletion, inviter demotion/removal, ownership transfer demoting the inviter, blocking, and tighter settings invalidate affected pending invitations. Existing member role/removal/ownership routes and the member-readable roster remain unchanged. `POST /book-clubs/:clubId/members` is retired with **410 Gone**, not redirected to an immediate-add implementation.

## Durable inbox

`GET /notifications?page=1&limit=20`:

```json
{
  "items": [
    {
      "id": "notification UUID",
      "kind": "club_discussion",
      "actorName": "Reader",
      "clubId": "club UUID",
      "clubName": "Current club name",
      "threadId": "thread UUID",
      "requestId": null,
      "createdAt": "ISO timestamp",
      "readAt": null
    }
  ],
  "total": 1,
  "unreadCount": 1,
  "page": 1,
  "limit": 20
}
```

Pages are positive integers up to 100000; limit is 1–100. Defaults are page 1 / limit 20. Results are newest-first with ID tie-breaking. Optional target fields are null when not applicable. Actor display names are resolved in bounded authenticated batches **outside database locks**, followed by a fresh local access check before returning metadata.

| Method | Route | Response |
| --- | --- | --- |
| GET | `/notifications/unread-count` | `{count:number}` using the same access filter as the inbox. |
| POST | `/notifications/:id/read` | `{success:true}`; recipient and current access required. |
| POST | `/notifications/read-all` | `{success:true}`; marks only the caller's currently accessible notifications. |
| DELETE | `/notifications/:id` | `{success:true}`; dismisses an accessible notification without deciding its request. |

Kinds: `friend_request`, `friend_accepted`, `club_invitation`, `club_invitation_accepted`, `club_discussion`, `club_reply`, `club_reading_plan`.

Incoming/accepted request notifications are atomic with their request transitions. Declines/cancellations produce no notifications. Discussions notify current unmuted members. Replies notify the thread author and prior visible participants who remain unmuted current members. Actor exclusion and recipient/event uniqueness apply to all events. Reading-plan notifications compare persisted dates and milestone names/kinds/order/identity for material changes; no-op saves are suppressed, including equivalent legacy replacement PUT payloads. Resetting an existing schedule during selected-work replacement also produces a reading-plan change.

No notifications are produced for ordinary post edits/moderation, personal progress, edition labels, reading-copy changes, or sharing preferences. Per-club mute affects activity only, never incoming/accepted requests. Notifications contain references and generic event kinds, never content snippets or private reading metadata.

The list, unread badge, and read/dismiss actions apply one authorization predicate: stale request generations/statuses are hidden; club activity/acceptance requires current membership; deleted clubs and hidden/deleted threads/replies are inaccessible. Invitation notifications require the current pending, unexpired invitation and expose only its minimal preview. New metadata is read from the current club, not a stored private-content snapshot. Inaccessible notifications are retained but never rendered/countable/actionable. Dismissal hides inbox history, not the dedicated pending-request lists.

## Concurrency, errors, and rollout

- Migration `CreateSocial1790000000010` adds snake-case social tables and indexes without modifying existing memberships. Runtime registration and CLI `*.entity`/migration discovery include the models.
- Writers acquire PostgreSQL transaction advisory lock `1790000010` **before** club row locks, followed by relationship/request updates. Club services use the same lock. This intentionally serializes local social/club writes to make block/accept, policy/accept, archive/accept, reverse sends, and public join/accept deterministic; it is a throughput trade-off, not an in-process mutex.
- Canonical unordered friendship pairs persist cooldown evidence; each new request has a fresh generation UUID. Invitation generations also have distinct UUIDs and a partial unique pending index. Notifications use recipient/event idempotency keys.
- After decline/cancellation, resend cooldown is 24 hours, including reversed friendship sends. Friendship removal/blocking records the same resend evidence. Expired invitations can be sent again without waiting an extra day.
- Outgoing friend/club invitations share a durable limit of 30 attempts per account/hour. Search permits 30 attempts/account/minute. Rate responses are `429` with `{message,retryAfter}` in seconds; successful database writes cannot erase rate evidence by rolling back.
- Invalid input is `400`; unauthorized sessions `401`; generic unavailable policy/organizer failures `403`; missing/foreign request or notification `404`; existing/terminal generations `409`; retired direct additions `410`; cooldown/rate limit `429`; directory/configuration outage `503`. Terminal actions return explicit conflicts and never reopen requests.
- Configure the supported Authentication URL before rollout. Deploy Authentication directory support, then API migration/routes, then the web client. Existing open-club join and accepted memberships need no conversion.

### Verification

Run `npx tsc --noEmit --incremental false` and `npm test -- --runInBand test/modules/social test/modules/book-clubs`.

For the real PostgreSQL suite, provide a non-production `SOCIAL_TEST_DATABASE_URL` with schema-creation permission and run `npm test -- --runInBand test/modules/social/social.integration.spec.ts`. The suite creates a unique isolated schema, runs the actual social migration, exercises services and concurrent transitions, and removes the schema afterward. It does not alter application tables.
