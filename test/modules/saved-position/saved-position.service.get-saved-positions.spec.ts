import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { mockSavedPosition } from 'test/mocks/savedPositionMocks';
import { SavedPositionEntity } from 'src/modules/saved-position/saved-position.entity';
import { SavedPositionService } from 'src/modules/saved-position/saved-position.service';
import { EpubLocationService } from 'src/modules/book/publication/epub-location.service';
import Mocked = jest.Mocked;

describe('SavedPositionService.findAllByUser', () => {
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
            find: jest.fn(),
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

  test('Successfully retrieves all saved positions for a user', async () => {
    const mockSavedPositions: SavedPositionEntity[] = [
      mockSavedPosition,
      {
        bookId: 'book-789',
        userId: mockSavedPosition.userId,
        position: 'epubcfi(/6/4!/4/2/1:0)',
        deviceName: 'Mobile Device',
        createdAt: new Date('2024-02-01'),
        updatedAt: new Date('2024-02-01'),
        percentage: null,
      },
    ];
    repository.find.mockResolvedValueOnce(mockSavedPositions);

    const result = await service.findAllByUser(mockSavedPosition.userId);

    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(repository.find).toHaveBeenCalledWith({
      where: { userId: mockSavedPosition.userId },
      order: { updatedAt: 'DESC' },
    });
    expect(result).toEqual(mockSavedPositions);
  });

  test('Returns empty array when user has no saved positions', async () => {
    repository.find.mockResolvedValueOnce([]);

    const result = await service.findAllByUser('user-with-no-positions');

    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(repository.find).toHaveBeenCalledWith({
      where: { userId: 'user-with-no-positions' },
      order: { updatedAt: 'DESC' },
    });
    expect(result).toEqual([]);
  });
});
