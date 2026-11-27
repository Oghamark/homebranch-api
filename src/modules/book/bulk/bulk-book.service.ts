import { ForbiddenException, HttpException, Injectable, Logger } from '@nestjs/common';
import { isAdminUser, tenantScope, TenantUser } from 'src/common/utils/cloud';
import { AccountDirectoryGateway } from 'src/modules/auth/account-directory.gateway';
import { BookShelfService } from 'src/modules/book-shelf/book-shelf.service';
import { BookService } from 'src/modules/book/catalog/book.service';
import { BookPersistenceService } from 'src/modules/book/persistence/book.persistence';

export interface BulkBookResult {
  success: boolean;
  succeeded: string[];
  failed: Array<{ bookId: string; message: string }>;
}

@Injectable()
export class BulkBookService {
  private readonly logger = new Logger(BulkBookService.name);

  constructor(
    private readonly books: BookService,
    private readonly persistence: BookPersistenceService,
    private readonly shelves: BookShelfService,
    private readonly directory: AccountDirectoryGateway,
  ) {}

  delete(bookIds: string[], user: TenantUser): Promise<BulkBookResult> {
    return this.process('delete', bookIds, user, async (id) => {
      await this.books.deleteBook(id, user.id, isAdminUser(user));
    });
  }

  favorite(bookIds: string[], user: TenantUser, favorite: boolean): Promise<BulkBookResult> {
    return this.process(favorite ? 'favorite' : 'unfavorite', bookIds, user, async (id) => {
      await this.persistence.setBookFavorite(user.id, id, favorite);
    });
  }

  shelf(bookIds: string[], shelfId: string, user: TenantUser, add: boolean): Promise<BulkBookResult> {
    const shelfScope = isAdminUser(user) ? undefined : user.id;
    return this.process(add ? 'add-to-shelf' : 'remove-from-shelf', bookIds, user, async (id) => {
      await this.shelves.getBookShelfById(shelfId, shelfScope);
      if (add) {
        await this.shelves.addBookToBookShelf(shelfId, id, tenantScope(user));
      } else {
        await this.shelves.removeBookFromBookShelf(shelfId, id, tenantScope(user));
      }
    });
  }

  assignOwner(
    bookIds: string[],
    ownerId: string | null,
    user: TenantUser,
    credential?: string,
  ): Promise<BulkBookResult> {
    if (!isAdminUser(user)) throw new ForbiddenException('Insufficient permissions');
    let account: Promise<unknown> | undefined;
    return this.process('assign-owner', bookIds, user, async (id) => {
      if (ownerId !== null) {
        account ??= this.directory.requireAccount(ownerId, credential ?? '');
        await account;
      }
      await this.books.assignBookOwner(id, ownerId, true);
    });
  }

  private async process(
    action: string,
    bookIds: string[],
    user: TenantUser,
    operation: (id: string) => Promise<void>,
  ): Promise<BulkBookResult> {
    const result: BulkBookResult = { success: true, succeeded: [], failed: [] };
    for (const bookId of bookIds) {
      try {
        await this.books.assertAccess(bookId, tenantScope(user));
        await this.books.getBookById(bookId, undefined, tenantScope(user));
        await operation(bookId);
        result.succeeded.push(bookId);
      } catch (error: unknown) {
        result.success = false;
        const expected = error instanceof HttpException && error.getStatus() < 500;
        if (!expected) this.logger.error(`Bulk ${action} failed for book ${bookId}, user ${user.id}`);
        result.failed.push({ bookId, message: expected ? error.message : 'Unable to process book' });
      }
    }
    return result;
  }
}
