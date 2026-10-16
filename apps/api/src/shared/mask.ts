/** "ahmed.salah@example.com" -> "ah***@example.com": enough to recognise, not enough to copy. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}
