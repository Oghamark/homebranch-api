import { BadRequestException, Inject, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { basename } from 'path';
import { Repository } from 'typeorm';
import { BookService } from 'src/modules/book/catalog/book.service';
import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';
import { getBookFormatMediaType } from 'src/modules/book/format/book-format';
import { MailService } from 'src/modules/mail/mail.service';
import { IStorageService, STORAGE_SERVICE_TOKEN } from 'src/modules/storage/storage.interface';
import { UserPreferenceEntity } from 'src/modules/kindle/user-preference.entity';

// Amazon rejects Send to Kindle emails with attachments over 50 MB
export const KINDLE_MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

@Injectable()
export class KindleService {
  constructor(
    @InjectRepository(UserPreferenceEntity)
    private readonly preferences: Repository<UserPreferenceEntity>,
    private readonly bookService: BookService,
    private readonly mailService: MailService,
    @Inject(STORAGE_SERVICE_TOKEN) private readonly storage: IStorageService,
  ) {}

  async getKindleEmail(userId: string): Promise<string | null> {
    const preference = await this.preferences.findOneBy({ userId });
    return preference?.kindleEmail ?? null;
  }

  async setKindleEmail(userId: string, kindleEmail: string | null): Promise<string | null> {
    const value = kindleEmail?.trim() || null;
    await this.preferences.save({ userId, kindleEmail: value });
    return value;
  }

  async sendBook(userId: string, bookId: string, ownerScope?: string): Promise<void> {
    const kindleEmail = await this.getKindleEmail(userId);
    if (!kindleEmail) {
      throw new BadRequestException('Set your Kindle email address before sending books');
    }
    if (!(await this.mailService.isConfigured())) {
      throw new BadRequestException('Email is not configured. Ask an administrator to set it up.');
    }

    await this.bookService.assertAccess(bookId, ownerScope);
    const { book, format, fileName } = await this.bookService.getDownload(bookId, BookFormatType.EPUB, ownerScope);

    let buffer: Buffer;
    try {
      ({ buffer } = await this.storage.getFileBuffer(`books/${basename(fileName)}`));
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException('Book file not found on server');
      }
      throw error;
    }
    if (buffer.length > KINDLE_MAX_ATTACHMENT_BYTES) {
      throw new PayloadTooLargeException('This book is larger than the 50 MB Send to Kindle limit');
    }

    const safeTitle = book.title.replace(/[^\w\s-]/g, '').trim() || 'book';
    await this.mailService.send({
      to: kindleEmail,
      subject: book.title,
      text: `Sent from Homebranch: ${book.title}`,
      attachments: [{ filename: `${safeTitle}.epub`, content: buffer, contentType: getBookFormatMediaType(format) }],
    });
  }
}
