import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { mockSavedPosition } from 'test/mocks/savedPositionMocks';
import { SavedPositionService } from 'src/modules/saved-position/saved-position.service';
import { EpubLocationService } from 'src/modules/book/publication/epub-location.service';
import { SavedPositionEntity } from 'src/modules/saved-position/saved-position.entity';
import Mocked = jest.Mocked;

describe('SavedPositionService.delete', () => {
  let service: SavedPositionService;
  let repository: Mocked<Repository<SavedPositionEntity>>;

  beforeEach(async () => {
    const manager = {
      transaction: jest.fn((work: (value: unknown) => Promise<unknown>) => work(manager)),
      getRepository: () => repository,
      query: jest.fn((sql: string) =>
        Promise.resolve(sql.includes('SET revision=revision+1') ? [[{ revision: '1' }], 1] : [{ revision: '1' }]),
      ),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SavedPositionService,
        { provide: EpubLocationService, useValue: {} },
        {
          provide: getRepositoryToken(SavedPositionEntity),
          useValue: {
            manager,
            delete: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SavedPositionService>(SavedPositionService);
    repository = module.get(getRepositoryToken(SavedPositionEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('Successfully deletes a saved position', async () => {
    repository.delete.mockResolvedValueOnce({ affected: 1 } as never);

    await service.delete(mockSavedPosition.bookId, mockSavedPosition.userId);

    expect(repository.delete).toHaveBeenCalledTimes(1);
    expect(repository.delete).toHaveBeenCalledWith({
      bookId: mockSavedPosition.bookId,
      userId: mockSavedPosition.userId,
    });
  });

  test('Throws when delete operation affects no rows', async () => {
    repository.delete.mockResolvedValueOnce({ affected: 0 } as never);

    await expect(service.delete(mockSavedPosition.bookId, mockSavedPosition.userId)).rejects.toThrow(
      'Saved position not found',
    );
  });
});
