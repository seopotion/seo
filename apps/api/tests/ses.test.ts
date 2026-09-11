import { beforeEach, describe, expect, test, vi } from 'vitest';

const { send, SendEmailCommand } = vi.hoisted(() => ({
  send: vi.fn(async () => ({})),
  // A regular `function`, not an arrow, so `new SendEmailCommand()` works —
  // this Vitest version requires constructor mocks to use `function`/`class`.
  SendEmailCommand: vi.fn(function SendEmailCommand(input: unknown) {
    return { input };
  }),
}));
vi.mock('@aws-sdk/client-sesv2', () => ({
  // A regular `function`, not an arrow, so `new SESv2Client()` works — this
  // Vitest version requires constructor mocks to use `function`/`class`.
  SESv2Client: vi.fn(function SESv2Client() {
    return { send };
  }),
  SendEmailCommand,
}));

const { config } = vi.hoisted(() => ({ config: { MAIL_FROM: '' } }));
vi.mock('../src/config', () => ({ config }));

import { sendEmail } from '../src/clients/ses';

const mail = {
  to: 'new@example.com',
  replyTo: 'owner@example.com',
  subject: 'Hi',
  text: 'Body',
};

beforeEach(() => {
  vi.clearAllMocks();
  config.MAIL_FROM = '';
});

describe('sendEmail', () => {
  test('is a no-op when MAIL_FROM is unset', async () => {
    await sendEmail(mail);
    expect(send).not.toHaveBeenCalled();
    expect(SendEmailCommand).not.toHaveBeenCalled();
  });

  test('sends a simple text email with From display name and Reply-To', async () => {
    config.MAIL_FROM = 'no-reply@seopotion.co';
    await sendEmail(mail);
    expect(SendEmailCommand).toHaveBeenCalledWith({
      FromEmailAddress: 'SEOPotion <no-reply@seopotion.co>',
      Destination: { ToAddresses: ['new@example.com'] },
      ReplyToAddresses: ['owner@example.com'],
      Content: {
        Simple: {
          Subject: { Data: 'Hi', Charset: 'UTF-8' },
          Body: { Text: { Data: 'Body', Charset: 'UTF-8' } },
        },
      },
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('propagates SDK errors to the caller', async () => {
    config.MAIL_FROM = 'no-reply@seopotion.co';
    send.mockRejectedValueOnce(new Error('MessageRejected'));
    await expect(sendEmail(mail)).rejects.toThrow('MessageRejected');
  });
});
