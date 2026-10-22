// Pacific-time calendar helpers (daily limits and the date stamp are PT, per the mandate).
export function ptDate(d = new Date(), timeZone = 'America/Los_Angeles'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function daysUntil(iso: string, from = new Date()): number {
  return (Date.parse(iso) - from.getTime()) / 86_400_000;
}
