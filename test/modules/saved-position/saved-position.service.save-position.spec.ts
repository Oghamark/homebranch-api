import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { mockSavedPosition } from 'test/mocks/savedPositionMocks';
import { SavedPositionService } from 'src/modules/saved-position/saved-position.service';
import { SavedPositionEntity } from 'src/modules/saved-position/saved-position.entity';
import Mocked = jest.Mocked;

describe('SavedPositionService.save', () => {
  let service: SavedPositionService;
  let repository: Mocked<Repository<SavedPositionEntity>>;
  let query: jest.Mock;

  beforeEach(async () => {
    query = jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('SET revision=revision+1') ? [[{ revision: '1' }], 1] : [{ revision: '1', id: 'epub-format' }],
      ),
    );
    const manager = {
      transaction: jest.fn((work: (value: unknown) => Promise<unknown>) => work(manager)),
      getRepository: () => repository,
      query,
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SavedPositionService,
        {
          provide: getRepositoryToken(SavedPositionEntity),
          useValue: {
            manager,
            save: jest.fn(),
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

  test('Successfully saves a position with percentage', async () => {
    repository.save.mockResolvedValueOnce(mockSavedPosition);
    repository.findOne.mockResolvedValueOnce(mockSavedPosition);

    const result = await service.save({
      bookId: mockSavedPosition.bookId,
      userId: mockSavedPosition.userId,
      position: mockSavedPosition.position,
      deviceName: mockSavedPosition.deviceName,
      percentage: 0.42,
    });

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledWith({
      bookId: mockSavedPosition.bookId,
      userId: mockSavedPosition.userId,
      position: mockSavedPosition.position,
      deviceName: mockSavedPosition.deviceName,
      percentage: 0.42,
    });
    expect(result).toEqual(mockSavedPosition);
    expect(query.mock.calls.some(([sql]) => sql.includes('FOR UPDATE'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes("VALUES($1,$2,$3,'web'"))).toBe(true);
  });

  test('Successfully saves a position without percentage (backwards compatibility)', async () => {
    const savedPositionWithoutPercentage = { ...mockSavedPosition, percentage: null };
    repository.save.mockResolvedValueOnce(savedPositionWithoutPercentage);
    repository.findOne.mockResolvedValueOnce(savedPositionWithoutPercentage);

    const result = await service.save({
      bookId: mockSavedPosition.bookId,
      userId: mockSavedPosition.userId,
      position: mockSavedPosition.position,
      deviceName: mockSavedPosition.deviceName,
    });

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(result.percentage).toBeNull();
  });
});
