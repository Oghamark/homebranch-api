import { NotFoundException } from '@nestjs/common';
import { BookController } from 'src/modules/book/catalog/book.controller';

describe('deleteBookFormat controller', () => {
  const books = { assertAccess: jest.fn() };
  const mutations = { deleteBookFormat: jest.fn() };
  const controller = new BookController(books as never, {} as never, mutations as never);
  const user = { id: 'owner', roles: ['USER'] } as Express.User;
  const previousCloudMode = process.env.CLOUD_MODE;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.CLOUD_MODE = 'true';
  });
  afterAll(() => {
    if (previousCloudMode === undefined) delete process.env.CLOUD_MODE;
    else process.env.CLOUD_MODE = previousCloudMode;
  });

  it('checks tenant access before forwarding the authenticated owner', async () => {
    await controller.deleteBookFormat('book', 'format', user);
    expect(books.assertAccess).toHaveBeenCalledWith('book', 'owner');
    expect(mutations.deleteBookFormat).toHaveBeenCalledWith({
      bookId: 'book',
      formatId: 'format',
      requestingUserId: 'owner',
      requestingUserRole: 'USER',
    });
  });

  it('does not mutate inaccessible books', async () => {
    books.assertAccess.mockRejectedValue(new NotFoundException());
    await expect(controller.deleteBookFormat('book', 'format', user)).rejects.toBeInstanceOf(NotFoundException);
    expect(mutations.deleteBookFormat).not.toHaveBeenCalled();
  });
});
