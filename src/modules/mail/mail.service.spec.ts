import { MailService } from 'src/modules/mail/mail.service';
import { decryptSecret, encryptSecret } from 'src/common/utils/secret-crypto';

describe('MailService secret storage', () => {
  beforeAll(() => {
    process.env.SETTINGS_ENCRYPTION_KEY = 'test-key';
  });

  it('stores the SMTP password encrypted and reads it back decrypted', async () => {
    let stored = '';
    const settings = {
      upsert: jest.fn((_key: string, value: string) => {
        stored = value;
        return Promise.resolve();
      }),
      getOptionalValue: jest.fn(() => Promise.resolve(stored)),
    };
    const service = new MailService(settings as never);
    await service.saveSmtpConfig({ host: 'h', port: 587, secure: false, password: 'hunter2', from: 'a@b.c' });
    expect(stored).not.toContain('hunter2');
    expect((await service.getSmtpConfig())?.password).toBe('hunter2');
  });

  it('round-trips and rejects tampered ciphertext', () => {
    const encrypted = encryptSecret('value');
    expect(decryptSecret(encrypted)).toBe('value');
    expect(() => decryptSecret(encrypted.slice(0, -2) + 'AA')).toThrow();
  });
});
