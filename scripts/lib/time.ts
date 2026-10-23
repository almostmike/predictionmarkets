// Pacific-time calendar helpers (daily limits and the date stamp are PT, per the mandate).
export function ptDate(d = new Date(), timeZone = 'America/Los_Angeles'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function daysUntil(iso: string, from = new Date()): number {
  return (Date.parse(iso) - from.getTime()) / 86_400_000;
}

// 23:59 Pacific on the given instant's Pacific date, as an ISO timestamp (order expiry for the daily session).
export function endOfPtDay(d = new Date(), timeZone = 'America/Los_Angeles'): string {
  const offset = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName')!.value; // e.g. GMT-07:00
  return new Date(`${ptDate(d, timeZone)}T23:59:00${offset.replace('GMT', '') || 'Z'}`).toISOString();
}
