import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedPositionEntity } from 'src/modules/saved-position/saved-position.entity';
import { acceptWebProgress, lockSyncUser, nextSyncRevision } from '../koreader/koreader-ordering';
import { EpubLocationService } from '../book/publication/epub-location.service';
import { PortableLocation } from '../book/publication/epub-location';

@Injectable()
export class SavedPositionService {
  constructor(
    @InjectRepository(SavedPositionEntity)
    private readonly savedPositionsRepository: Repository<SavedPositionEntity>,
    private readonly locations: EpubLocationService,
  ) {}

  async findAllByUser(userId: string): Promise<SavedPositionEntity[]> {
    const rows = await this.savedPositionsRepository.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });
    const compatible: SavedPositionEntity[] = [];
    for (const row of rows) compatible.push(await this.compatible(row));
    return compatible;
  }

  private async compatible(row: SavedPositionEntity): Promise<SavedPositionEntity> {
    if (!row.location) return row;
    return {
      ...row,
      location: await this.locations.compatible(
        this.savedPositionsRepository.manager,
        row.userId,
        row.bookId,
        row.location,
      ),
    };
  }

  async findByBookAndUser(bookId: string, userId: string): Promise<SavedPositionEntity> {
    const savedPosition = await this.savedPositionsRepository.findOne({
      where: { bookId, userId },
    });

    if (!savedPosition) {
      throw new NotFoundException('Saved position not found');
    }

    return this.compatible(savedPosition);
  }

  async save(params: {
    bookId: string;
    userId: string;
    position: string;
    deviceName: string;
    percentage?: number | null;
    location?: PortableLocation;
  }): Promise<SavedPositionEntity> {
    return this.savedPositionsRepository.manager.transaction(async (manager) => {
      await lockSyncUser(manager, params.userId);
      const repository = manager.getRepository(SavedPositionEntity);
      const location =
        params.location === undefined
          ? undefined
          : await this.locations.validate(manager, params.userId, params.bookId, params.location);
      const [epub] = await manager.query(`SELECT id FROM book_format_entity WHERE book_id=$1 AND format='EPUB'`, [
        params.bookId,
      ]);
      const revision = epub ? await acceptWebProgress(manager, { ...params, location }) : null;
      await repository.save({
        bookId: params.bookId,
        userId: params.userId,
        position: params.position,
        deviceName: params.deviceName,
        percentage: params.percentage ?? null,
        location: location ?? null,
        revision,
      });
      return (await repository.findOne({ where: { bookId: params.bookId, userId: params.userId } }))!;
    });
  }

  async delete(bookId: string, userId: string): Promise<void> {
    await this.savedPositionsRepository.manager.transaction(async (manager) => {
      await lockSyncUser(manager, userId);
      const result = await manager.getRepository(SavedPositionEntity).delete({ bookId, userId });
      if (result.affected === 0) throw new NotFoundException('Saved position not found');
      const revision = await nextSyncRevision(manager, userId);
      await manager.query(
        `UPDATE koreader_book_progress SET percentage=NULL,native_progress=NULL,location=NULL,revision=$3,updated_at=clock_timestamp()
         WHERE user_id=$1 AND book_id=$2 AND source='web'`,
        [userId, bookId, revision],
      );
    });
  }
}
