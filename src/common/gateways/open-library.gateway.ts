import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Book } from 'src/modules/book/book.model';
import { AuthorEntity } from 'src/modules/author/author.entity';

interface BookSearchDoc {
  key: string;
  isbn?: string[];
  number_of_pages_median?: number;
  publisher?: string[];
  language?: string[];
  average_rating?: number;
  ratings_count?: number;
}

interface BookSummarySearchResponse {
  docs: BookSearchDoc[];
}

interface OpenLibraryCoverSearchDoc {
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
}

interface OpenLibraryCoverSearchResponse {
  docs?: OpenLibraryCoverSearchDoc[];
}

export interface BookCoverCandidate {
  coverId: number;
  title: string;
  authors: string[];
  year?: number;
  thumbnailUrl: string;
}

interface OpenLibraryDescriptionObject {
  value: string;
}

interface OpenLibraryWorkResponse {
  description?: string | OpenLibraryDescriptionObject;
  subjects?: string[];
}

interface BookEnrichment {
  isbn: string | null;
  pageCount: number | null;
  publisher: string | null;
  language: string | null;
  genres: string[] | null;
  averageRating: number | null;
  ratingsCount: number | null;
  summary: string | null;
}

interface OpenLibraryAuthorSearchDoc {
  key: string;
  name: string;
}

interface OpenLibraryAuthorSearchResponse {
  docs: OpenLibraryAuthorSearchDoc[];
}

interface OpenLibraryAuthorBioObject {
  value: string;
}

interface OpenLibraryAuthorResponse {
  bio?: string | OpenLibraryAuthorBioObject;
}

interface AuthorSearchResult {
  key: string;
  hasBio: boolean;
}

@Injectable()
export class OpenLibraryGateway {
  private readonly logger = new Logger(OpenLibraryGateway.name);
  private readonly baseUrl = 'https://openlibrary.org';
  private readonly coversUrl = 'https://covers.openlibrary.org';
  private readonly userAgent = 'Homebranch (self-hosted e-book library; ryan.bezold@gmail.com)';
  private readonly timeoutMs = 8000;

  private createAbortSignal(): AbortSignal {
    return AbortSignal.timeout(this.timeoutMs);
  }

  async enrichBook(book: Book): Promise<Book> {
    try {
      const bookDoc = await this.searchBook(book.title, book.author);
      if (!bookDoc) {
        this.logger.log(`No Open Library result for "${book.title}" by "${book.author}"`);
        book.metadataFetchedAt = new Date();
        return book;
      }

      const workDetails = await this.fetchWorkDetails(bookDoc.key);
      if (!workDetails) {
        this.logger.log(`Could not fetch work details for "${book.title}" (key: ${bookDoc.key})`);
        book.metadataFetchedAt = new Date();
        return book;
      }

      if (!book.isbn) book.isbn = bookDoc.isbn?.at(0);
      if (!book.pageCount) book.pageCount = bookDoc.number_of_pages_median;
      if (!book.publisher) book.publisher = bookDoc.publisher?.at(0);
      if (!book.language) book.language = bookDoc.language?.at(0);
      if (!book.genres?.length) book.genres = workDetails.genres?.slice(0, 5) ?? [];
      if (!book.averageRating) book.averageRating = bookDoc.average_rating;
      if (!book.ratingsCount) book.ratingsCount = bookDoc.ratings_count;
      if (!book.summary) book.summary = workDetails.summary ?? undefined;
      book.metadataFetchedAt = new Date();

      this.logger.log(`Enriched "${book.title}" from Open Library`);
      return book;
    } catch (error) {
      const cause = error instanceof TypeError && error.cause instanceof Error ? ` (${error.cause.message})` : '';
      this.logger.warn(
        `Failed to fetch book summary for "${book.title}" by "${book.author}" from Open Library: ${error instanceof Error ? error.message : String(error)}${cause}`,
      );
      return book;
    }
  }

  private async searchBook(title: string, author: string): Promise<BookSearchDoc | null> {
    const url = `${this.baseUrl}/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&limit=1&fields=key,isbn,number_of_pages_median,publisher,language,average_rating,ratings_count`;
    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent },
      signal: this.createAbortSignal(),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as BookSummarySearchResponse;

    if (!data.docs || data.docs.length === 0) {
      return null;
    }

    return data.docs[0];
  }

  private async fetchWorkDetails(workKey: string): Promise<Pick<BookEnrichment, 'genres' | 'summary'> | null> {
    const url = `${this.baseUrl}${workKey}.json`;
    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent },
      signal: this.createAbortSignal(),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as OpenLibraryWorkResponse;

    const summary = data.description
      ? typeof data.description === 'string'
        ? data.description
        : data.description.value
      : null;

    const genres = data.subjects
      ? data.subjects
          .filter((subject) => !subject.includes(',') && !subject.includes('(') && !subject.includes(')'))
          .slice(0, 5)
      : null;

    return { genres, summary };
  }

  async fetchSummary(book: Book): Promise<string | null> {
    try {
      const bookDoc = await this.searchBook(book.title, book.author);
      if (!bookDoc) {
        return null;
      }

      const workDetails = await this.fetchWorkDetails(bookDoc.key);
      return workDetails?.summary ?? null;
    } catch (error) {
      const cause = error instanceof TypeError && error.cause instanceof Error ? ` (${error.cause.message})` : '';
      this.logger.warn(
        `Failed to fetch summary for "${book.title}" from Open Library: ${error instanceof Error ? error.message : String(error)}${cause}`,
      );
      return null;
    }
  }

  async searchBookCovers(title: string, author: string, query?: string): Promise<BookCoverCandidate[]> {
    const search = new URLSearchParams({
      limit: '20',
      fields: 'title,author_name,first_publish_year,cover_i',
    });
    if (query?.trim()) {
      search.set('q', query.trim());
    } else {
      search.set('title', title);
      search.set('author', author);
    }

    const response = await fetch(`${this.baseUrl}/search.json?${search.toString()}`, {
      headers: { 'User-Agent': this.userAgent },
      signal: this.createAbortSignal(),
    });
    if (!response.ok) {
      throw new BadGatewayException('Open Library cover search is unavailable');
    }

    const data = (await response.json()) as OpenLibraryCoverSearchResponse;
    return (data.docs ?? [])
      .filter(
        (doc): doc is OpenLibraryCoverSearchDoc & { cover_i: number } =>
          Number.isSafeInteger(doc.cover_i) && (doc.cover_i ?? 0) > 0,
      )
      .map((doc) => ({
        coverId: doc.cover_i,
        title: doc.title ?? 'Untitled',
        authors: doc.author_name ?? [],
        year: doc.first_publish_year,
        thumbnailUrl: `${this.coversUrl}/b/id/${doc.cover_i}-M.jpg?default=false`,
      }));
  }

  async fetchBookCover(coverId: number): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!Number.isSafeInteger(coverId) || coverId <= 0) {
      throw new BadRequestException('Invalid cover selection');
    }

    let url = `${this.coversUrl}/b/id/${coverId}-L.jpg?default=false`;
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetch(url, {
        headers: { 'User-Agent': this.userAgent, Accept: 'image/jpeg,image/png,image/webp' },
        redirect: 'manual',
        signal: this.createAbortSignal(),
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirects === 3) {
          throw new BadGatewayException('Open Library returned an invalid cover redirect');
        }
        const redirectUrl = new URL(location, url);
        const hostname = redirectUrl.hostname.toLowerCase();
        const isTrustedHost =
          hostname === 'covers.openlibrary.org' || hostname === 'archive.org' || hostname.endsWith('.archive.org');
        if (redirectUrl.protocol !== 'https:' || !isTrustedHost) {
          throw new BadGatewayException('Open Library returned an untrusted cover redirect');
        }
        url = redirectUrl.toString();
        continue;
      }

      if (!response.ok) {
        throw new BadGatewayException('The selected cover image could not be downloaded');
      }

      const mimeType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (!mimeType || !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        throw new BadGatewayException('The selected cover is not a supported image');
      }
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > 8 * 1024 * 1024) {
        throw new BadGatewayException('The selected cover image is too large');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new BadGatewayException('The selected cover image is empty');
      }
      const chunks: Uint8Array[] = [];
      let totalSize = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalSize += value.byteLength;
        if (totalSize > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new BadGatewayException('The selected cover image is too large');
        }
        chunks.push(value);
      }

      if (!totalSize) {
        throw new BadGatewayException('The selected cover image is empty or too large');
      }
      const buffer = Buffer.concat(chunks, totalSize);
      return { buffer, mimeType };
    }

    throw new BadGatewayException('The selected cover image could not be downloaded');
  }

  async enrichAuthor(author: AuthorEntity): Promise<AuthorEntity> {
    try {
      const searchResult = await this.searchAuthorByName(author.name);
      if (!searchResult) {
        return author;
      }

      const olid = searchResult.key.replace('/authors/', '');
      const biography = searchResult.hasBio ? await this.fetchAuthorBiography(olid) : null;
      const photoUrl = await this.fetchAuthorPhotoUrl(olid);

      author.biography = biography;
      author.profilePictureUrl = photoUrl;

      return author;
    } catch (error) {
      const cause = error instanceof TypeError && error.cause instanceof Error ? ` (${error.cause.message})` : '';
      this.logger.warn(
        `Failed to enrich author "${author.name}" from Open Library: ${error instanceof Error ? error.message : String(error)}${cause}`,
      );
      return author;
    }
  }

  private async searchAuthorByName(name: string): Promise<AuthorSearchResult | null> {
    const url = `${this.baseUrl}/search/authors.json?q=${encodeURIComponent(name)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent },
      signal: this.createAbortSignal(),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as OpenLibraryAuthorSearchResponse;

    if (!data.docs || data.docs.length === 0) {
      return null;
    }

    const exactMatch = data.docs.find((doc) => doc.name.toLowerCase() === name.toLowerCase());
    const match = exactMatch ?? data.docs[0];

    const authorResponse = await fetch(`${this.baseUrl}/authors/${match.key}.json`, {
      headers: { 'User-Agent': this.userAgent },
      signal: this.createAbortSignal(),
    });

    if (!authorResponse.ok) {
      return { key: match.key, hasBio: false };
    }

    const authorData = (await authorResponse.json()) as OpenLibraryAuthorResponse;
    return { key: match.key, hasBio: !!authorData.bio };
  }

  private async fetchAuthorBiography(olid: string): Promise<string | null> {
    const url = `${this.baseUrl}/authors/${olid}.json`;
    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent },
      signal: this.createAbortSignal(),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as OpenLibraryAuthorResponse;

    if (!data.bio) {
      return null;
    }

    if (typeof data.bio === 'string') {
      return data.bio;
    }

    return data.bio.value ?? null;
  }

  private async fetchAuthorPhotoUrl(olid: string): Promise<string | null> {
    const url = `${this.coversUrl}/a/olid/${olid}-L.jpg?default=false`;
    const response = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': this.userAgent },
      signal: this.createAbortSignal(),
    });

    if (!response.ok) {
      return null;
    }

    return `${this.coversUrl}/a/olid/${olid}-L.jpg`;
  }
}
