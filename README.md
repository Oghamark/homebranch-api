<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/Logo%202-Color%20For%20Dark.svg">
  <img src="images/Logo%202-Color%20For%20Light.svg" alt="HomeBranch" width="710" height="auto">
</picture>

Homebranch is a self-hosted web application for managing and reading your E-Book collection.
It provides a user-friendly interface to organize, search, and read your ebooks across devices.

> The project workspace, integrated development stack, and contribution process are maintained in the [Homebranch project repository](https://github.com/Oghamark/homebranch).

> [!NOTE]
>  The project is split into 3 repositories allowing you to choose the components you want to use:
> - [Homebranch Web](https://github.com/Oghamark/homebranch-web): The frontend web application built with React and TypeScript
> - [Homebranch](https://github.com/Oghamark/homebranch): The backend API built with NestJS and TypeScript
> - [Authentication](https://github.com/Oghamark/Authentication): A standalone authentication service built with NestJS and TypeScript, which can be used with Homebranch or as a general-purpose auth service for other applications

---

## Preview

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/library_view.png">
  <img src="images/library_view_light.png" alt="Library View">
</picture>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/book_details_view.png">
  <img src="images/book_details_view_light.png" alt="Book Details View">
</picture>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/authors_view.png">
  <img src="images/authors_view_light.png" alt="Authors View">
</picture>

---

## Features

- Book management with file upload (EPUB, PDF, MP3 audiobooks with one or more tracks, and M4B). MP3 ID3 tags provide album title, artist, track titles, year, genre, comments, and embedded cover art when present. Uploaded files are saved as `Author - Title.ext`; publication manifest (`GET /books/:id/manifest`) and content proxy (`GET /books/:id/content/:filename`) endpoints power the EPUB web reader, while the same logical book can track multiple linked formats
- Automatic metadata enrichment from Open Library (genres, publisher, language, ratings, summary, ISBN, page count)
- Optional Google Books enrichment for series info and any fields Open Library didn't populate
- Linked format management — merge matching uploads into one book, keep multiple formats attached to the same title, and split or remove individual formats when needed
- Send to Kindle — users save their Kindle email, and EPUB books are emailed via admin-configured SMTP (`GET/PUT /mail/config`, `PUT /kindle/email`, `POST /books/:id/send-to-kindle`). Add the SMTP sender address to the Amazon Approved Personal Document E-mail List. The SMTP password is stored encrypted (AES-256-GCM) using `SETTINGS_ENCRYPTION_KEY`, falling back to `JWT_ACCESS_SECRET`; keep the key stable or the password must be re-entered
- Bookshelves (collections) with many-to-many book relationships
- Favorites and Currently Reading lists
- Cross-device reading position sync
- User management with roles and permissions
- Pagination and search across the library
- OPDS catalog (v1.2 Atom and v2.0 JSON) for e-reader integration — authenticate with email and password via the companion Auth service
- Automated library scanning — detects new, modified, and removed EPUB, PDF, MP3, and M4B files in the uploads directory
- Bidirectional metadata sync for EPUB files: three-way merge between the EPUB file, database, and last-synced snapshot (file wins on conflict); updated database metadata is written back to the EPUB file
- Soft delete when a file is removed; automatically restored when the file is re-added (matched by filename or content hash)
- Book deduplication — admins can scan the library for duplicate book files and resolve each pair
- Background job queues powered by BullMQ and Redis for reliable async processing
- Real-time Server-Sent Events (SSE) at `GET /library/events` — notifies connected clients of library changes so they can refetch without polling
- Job history API (`GET /jobs`, `GET /jobs/:id`) with manual scan trigger (`POST /library/scan`) and per-book sync (`POST /library/books/:id/sync`)

---

## Installation

See our [documentation](https://homebranch.app/docs/getting-started/) for installation and configuration instructions.

---

## OPDS

Homebranch exposes an OPDS catalog for e-readers (KOReader, Thorium, etc.).

| Feed | URL |
|---|---|
| OPDS 1.2 catalog root | `/opds/v1/catalog` |
| OPDS 2.0 catalog root | `/opds/v2/catalog` |
| Authentication document | `/opds/v1/auth` *(public)* |

Authentication uses HTTP Basic Auth (email + password). Credentials are forwarded to the companion Auth service — requires `AUTH_SERVICE_URL` to be configured. Without it, the catalog is accessible but login attempts return `401`.

> **Windows / Docker note:** If Thorium is installed from the Microsoft Store, it runs in an AppContainer sandbox that blocks access to `localhost`. Use your machine's LAN IP address (e.g. `http://192.168.1.x:3000/opds/v1/catalog`) instead.

## Contributing

Contributions are welcome! See the [Homebranch contribution guidelines](https://github.com/Oghamark/homebranch/blob/dev/CONTRIBUTING.md) for the project contribution process and integrated development setup.

---

## Credits

- "HomeBranch" Logo and Iconography  © 2026 [Acro Visuals, L.L.C.](https://acrovisuals.com) is licensed under CC BY-SA 4.0. To view a copy of this license, visit https://creativecommons.org/licenses/by-sa/4.0/
