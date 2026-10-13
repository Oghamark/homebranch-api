import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { EntitlementService } from './entitlement.service';

@Injectable()
export class StorageQuotaService {
  constructor(
    @InjectRepository(BookFormatEntity) private readonly formats: Repository<BookFormatEntity>,
    private readonly entitlements: EntitlementService,
  ) {}

  async getUsedBytes(userId: string): Promise<number> {
    const row = await this.formats
      .createQueryBuilder('format')
      .innerJoin('format.book', 'book')
      .where('book.uploadedByUserId = :userId', { userId })
      .andWhere('book.deletedAt IS NULL')
      .select('COALESCE(SUM(format.fileSize), 0)', 'total')
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  async getUsage(userId: string): Promise<{
    usedBytes: number;
    quotaBytes: number;
    usedBooks: number;
    maxBooks: number | null;
  }> {
    const limits = await this.entitlements.getLimits(userId);
    return {
      usedBytes: await this.getUsedBytes(userId),
      quotaBytes: limits.quotaBytes,
      usedBooks: await this.getUsedBooks(userId),
      maxBooks: limits.maxBooks,
    };
  }

  async assertCanStore(userId: string, incomingBytes: number): Promise<void> {
    const used = await this.getUsedBytes(userId);
    const { quotaBytes } = await this.entitlements.getLimits(userId);
    if (used + incomingBytes > quotaBytes) {
      throw new PayloadTooLargeException('Storage quota exceeded. Remove books or upgrade your plan to upload more.');
    }
  }

  async getUsedBooks(userId: string): Promise<number> {
    const row = await this.formats
      .createQueryBuilder('format')
      .innerJoin('format.book', 'book')
      .where('book.uploadedByUserId = :userId', { userId })
      .andWhere('book.deletedAt IS NULL')
      .select('COUNT(DISTINCT book.id)', 'total')
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  async assertCanAddBook(userId: string): Promise<void> {
    const { maxBooks } = await this.entitlements.getLimits(userId);
    if (maxBooks === null) return;
    if ((await this.getUsedBooks(userId)) >= maxBooks) {
      throw new PayloadTooLargeException('Your demo plan is limited to 5 books. Upgrade your plan to add more.');
    }
  }
}
