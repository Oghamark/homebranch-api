import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { basename, join } from 'path';
import * as AdmZip from 'adm-zip';
import { Book } from 'src/modules/book/book.model';
import { EpubArchiveCacheService } from './epub-archive-cache.service';
import { buildLocationMap, EpubPackage, EpubTocEntry, LocationMap, parseEpubPackage } from './epub-location';

@Injectable()
export class EpubManifestService {
  private readonly locationMaps = new WeakMap<AdmZip, LocationMap>();
  private readonly logger = new Logger(EpubManifestService.name);

  constructor(private readonly epubArchiveCache: EpubArchiveCacheService) {}

  private publication(zip: AdmZip): EpubPackage {
    const publication = parseEpubPackage(zip);
    if (publication.tocFailure)
      this.logger.warn(`EPUB TOC unavailable; using resource ranges: ${publication.tocFailure}`);
    return publication;
  }

  private locationMap(zip: AdmZip, formatId: string, publication?: EpubPackage): LocationMap {
    const cached = this.locationMaps.get(zip);
    if (cached) return { ...cached, formatId };
    const map = buildLocationMap(zip, publication ?? this.publication(zip), formatId);
    this.locationMaps.set(zip, map);
    return map;
  }

  async getLocationMap(fileName: string, formatId: string): Promise<LocationMap> {
    const zip = await this.epubArchiveCache.getArchive(join('books', basename(fileName)));
    return this.locationMap(zip, formatId);
  }

  async generateManifest(book: Book, baseUrl: string, formatId?: string): Promise<object> {
    const zip = await this.epubArchiveCache.getArchive(join('books', basename(book.fileName)));
    const publication = this.publication(zip);
    let locationMap: LocationMap | undefined;
    if (formatId) {
      try {
        locationMap = this.locationMap(zip, formatId, publication);
      } catch (error) {
        if (!(error instanceof BadRequestException)) throw error;
        this.logger.warn(`Portable EPUB location map unavailable: ${error.message}`);
      }
    }
    const contentBase = `${baseUrl}/books/${book.id}/content`;
    const makeUrl = (href: string) => {
      const index = href.indexOf('#');
      const path = index < 0 ? href : href.slice(0, index);
      const fragment = index < 0 ? '' : href.slice(index + 1);
      return `${contentBase}/${path.split('/').map(encodeURIComponent).join('/')}${fragment ? `#${encodeURIComponent(fragment)}` : ''}`;
    };
    const link = (href: string) => {
      const item = publication.items.find((item) => item.href === href)!;
      return {
        href: makeUrl(href),
        type:
          item.mediaType === 'application/xhtml+xml' && href.toLowerCase().endsWith('.html')
            ? 'text/html'
            : item.mediaType,
        ...(item.properties.split(/\s+/u).includes('nav') ? { rel: ['contents'] } : {}),
      };
    };
    const toc = (entries: EpubTocEntry[]): EpubTocEntry[] =>
      entries.map((entry) => ({
        href: makeUrl(entry.href),
        title: entry.title,
        ...(entry.children ? { children: toc(entry.children) } : {}),
      }));
    return {
      '@context': 'https://readium.org/webpub-manifest/context.jsonld',
      metadata: {
        '@type': 'http://schema.org/Book',
        title: book.title,
        author: { name: book.author },
        language: publication.language,
        readingProgression: publication.readingProgression,
        ...(book.publishedYear && { published: String(book.publishedYear) }),
        ...(book.publisher && { publisher: { name: book.publisher } }),
      },
      links: [
        {
          rel: 'self',
          href: `${baseUrl}/books/${book.id}/manifest`,
          type: 'application/webpub+json',
        },
      ],
      readingOrder: publication.spine.map(link),
      resources: publication.items
        .filter((item) => !publication.spine.includes(item.href))
        .map((item) => link(item.href)),
      toc: toc(publication.toc),
      ...(locationMap ? { locationMap } : {}),
    };
  }
}
