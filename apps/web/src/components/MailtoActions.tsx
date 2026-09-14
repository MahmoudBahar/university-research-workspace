import { ExternalLink } from 'lucide-react';
import { MAILTO_SOFT_LIMIT, buildMailto } from '../lib/mailto';
import { CopyButton } from './CopyButton';

/**
 * Hand a message to the user's own mail client. Nothing is transmitted and
 * nothing is recorded here; the person reports the send afterwards.
 */
export function MailtoActions({
  recipient,
  subject,
  body,
  disabled,
  note,
  includeBodyCopy = true,
}: {
  recipient: string;
  subject: string;
  body: string;
  disabled?: boolean;
  note?: string;
  includeBodyCopy?: boolean;
}) {
  const href = buildMailto({ to: recipient, subject, body });
  const tooLong = href.length > MAILTO_SOFT_LIMIT;
  const inert = disabled || !recipient;
  return (
    <div className="stack">
      <div className="button-row">
        {inert ? (
          <span className="button" aria-disabled="true" style={{ opacity: 0.55, cursor: 'not-allowed' }}>
            <ExternalLink aria-hidden="true" />
            Open in mail client
          </span>
        ) : (
          <a className="button" href={href}>
            <ExternalLink aria-hidden="true" />
            Open in mail client
          </a>
        )}
        <CopyButton value={recipient} label="recipient" disabled={inert} />
        <CopyButton value={subject} label="subject" disabled={inert} />
        {includeBodyCopy ? <CopyButton value={body} label="body" disabled={inert} /> : null}
      </div>
      <p className="small muted">
        {note ??
          'Opens your mail client with this content. Nothing is sent or recorded here; report the send with “I sent this” afterwards.'}
        {tooLong ? ' This message is long for a mailto link; some mail clients truncate it, so paste the body if it arrives cut short.' : ''}
      </p>
    </div>
  );
}
