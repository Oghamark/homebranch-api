import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { mockSavedPosition } from 'test/mocks/savedPositionMocks';
import { SavedPositionService } from 'src/modules/saved-position/saved-position.service';
import { EpubLocationService } from 'src/modules/book/publication/epub-location.service';
import { SavedPositionEntity } from 'src/modules/saved-position/saved-position.entity';
import Mocked = jest.Mocked;

describe('SavedPositionService.findByBookAndUser', () => {
  let service: SavedPositionService;
  let repository: Mocked<Repository<SavedPositionEntity>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SavedPositionService,
        { provide: EpubLocationService, useValue: { compatible: jest.fn() } },
        {
          provide: getRepositoryToken(SavedPositionEntity),
          useValue: {
            findOne: jest.fn(),
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

  test('Successfully retrieves a saved position by book and user', async () => {
    repository.findOne.mockResolvedValueOnce(mockSavedPosition);

    const result = await service.findByBookAndUser(mockSavedPosition.bookId, mockSavedPosition.userId);

    expect(repository.findOne).toHaveBeenCalledTimes(1);
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { bookId: mockSavedPosition.bookId, userId: mockSavedPosition.userId },
    });
    expect(result).toEqual(mockSavedPosition);
  });

  test('Throws when saved position not found', async () => {
    repository.findOne.mockResolvedValueOnce(null);

    await expect(service.findByBookAndUser('non-existent-book', 'non-existent-user')).rejects.toThrow(
      'Saved position not found',
    );
  });
});
