import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { config } from '../config';
import { logger } from '../logger';

export type OutgoingEmail = {
  to: string;
  replyTo: string;
  subject: string;
  text: string;
};

// Region + credentials come from the Lambda execution role, like the SQS
// client. Constructed lazily so unconfigured envs (local dev, tests) never
// instantiate the SDK.
let client: SESv2Client | undefined;

/**
 * Send one plain-text transactional email via SES (#336). When `MAIL_FROM` is
 * unset the message is logged and dropped — local dev and tests need no AWS.
 * Errors are NOT swallowed: callers decide whether a failed send matters.
 */
export async function sendEmail(mail: OutgoingEmail): Promise<void> {
  if (!config.MAIL_FROM) {
    logger.info('MAIL_FROM unset — email not sent', { to: mail.to, subject: mail.subject });
    return;
  }
  client ??= new SESv2Client({});
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: `SEOPotion <${config.MAIL_FROM}>`,
      Destination: { ToAddresses: [mail.to] },
      ReplyToAddresses: [mail.replyTo],
      Content: {
        Simple: {
          Subject: { Data: mail.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: mail.text, Charset: 'UTF-8' } },
        },
      },
    }),
  );
}
