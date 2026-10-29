import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { tenantScope } from 'src/common/utils/cloud';
import { EpubManifestService } from './epub-manifest.service';
import { LocationMap, parsePortableLocation, PortableLocation, validatePortableLocation } from './epub-location';

@Injectable()
export class EpubLocationService {
  constructor(private readonly manifests: EpubManifestService) {}

  async map(manager: EntityManager, userId: string, bookId: string, formatId: string): Promise<LocationMap> {
    const [format] = await manager.query<{ file_name: string }[]>(
      `SELECT f.file_name FROM book_format_entity f JOIN book_entity b ON b.id=f.book_id
       WHERE f.id=$1 AND f.book_id=$2 AND f.format='EPUB' AND b.deleted_at IS NULL
       AND ($3::varchar IS NULL OR b.uploaded_by_user_id=$3) FOR SHARE OF b,f`,
      [formatId, bookId, tenantScope({ id: userId }) ?? null],
    );
    if (!format) throw new NotFoundException('Accessible EPUB format not found');
    return this.manifests.getLocationMap(format.file_name, formatId);
  }

  async validate(manager: EntityManager, userId: string, bookId: string, value: unknown): Promise<PortableLocation> {
    const location = parsePortableLocation(value);
    const map = await this.map(manager, userId, bookId, location.formatId);
    validatePortableLocation(location, map);
    return location;
  }

  async compatible(
    manager: EntityManager,
    userId: string,
    bookId: string,
    value: unknown,
  ): Promise<PortableLocation | null> {
    if (value === null || value === undefined) return null;
    try {
      return await this.validate(manager, userId, bookId, value);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) return null;
      throw error;
    }
  }
}
