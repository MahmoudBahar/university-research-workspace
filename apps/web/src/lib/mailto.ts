/**
 * Build a `mailto:` URL for the user's own mail client.
 *
 * Nothing here transmits anything: the browser opens the mail client with the
 * fields pre-filled, and the person decides what happens next.
 */
export const MAILTO_SOFT_LIMIT = 1800;

export function buildMailto(input: { to: string; subject: string; body: string }): string {
  const body = input.body.replace(/\r?\n/g, '\r\n');
  const params = new URLSearchParams();
  if (input.subject) params.set('subject', input.subject);
  if (body) params.set('body', body);
  // URLSearchParams encodes spaces as '+', which mail clients read literally.
  const query = params.toString().replace(/\+/g, '%20');
  return `mailto:${encodeURIComponent(input.to)}${query ? `?${query}` : ''}`;
}
