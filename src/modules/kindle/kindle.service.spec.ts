import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { KINDLE_MAX_ATTACHMENT_BYTES, KindleService } from 'src/modules/kindle/kindle.service';

describe('KindleService', () => {
  const preferences = { findOneBy: jest.fn(), save: jest.fn() };
  const bookService = { assertAccess: jest.fn(), getDownload: jest.fn() };
  const mailService = { isConfigured: jest.fn(), send: jest.fn() };
  const storage = { getFileBuffer: jest.fn() };

  const service = new KindleService(preferences as never, bookService as never, mailService as never, storage as never);

  beforeEach(() => {
    jest.resetAllMocks();
    preferences.findOneBy.mockResolvedValue({ userId: 'u1', kindleEmail: 'me@kindle.com' });
    mailService.isConfigured.mockResolvedValue(true);
    bookService.getDownload.mockResolvedValue({ book: { title: 'My: Book' }, format: 'EPUB', fileName: 'a.epub' });
    storage.getFileBuffer.mockResolvedValue({ key: 'books/a.epub', buffer: Buffer.from('data') });
  });

  it('rejects when no Kindle email is saved', async () => {
    preferences.findOneBy.mockResolvedValue(null);
    await expect(service.sendBook('u1', 'b1')).rejects.toBeInstanceOf(BadRequestException);
    expect(mailService.send).not.toHaveBeenCalled();
  });

  it('rejects when email is not configured', async () => {
    mailService.isConfigured.mockResolvedValue(false);
    await expect(service.sendBook('u1', 'b1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects oversized files', async () => {
    storage.getFileBuffer.mockResolvedValue({ key: 'k', buffer: Buffer.alloc(KINDLE_MAX_ATTACHMENT_BYTES + 1) });
    await expect(service.sendBook('u1', 'b1')).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('emails the EPUB to the saved address', async () => {
    await service.sendBook('u1', 'b1');
    expect(bookService.getDownload).toHaveBeenCalledWith('b1', 'EPUB', undefined);
    expect(mailService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'me@kindle.com',
        attachments: [expect.objectContaining({ filename: 'My Book.epub' })],
      }),
    );
  });

  it('clears the Kindle email when blank', async () => {
    await service.setKindleEmail('u1', '  ');
    expect(preferences.save).toHaveBeenCalledWith({ userId: 'u1', kindleEmail: null });
  });
});
