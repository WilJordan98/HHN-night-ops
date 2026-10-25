// HHN Night Ops engine: live-feed parsing + recommendation. Pure functions, no DOM.
export const HOUSE_IDS = [17576,17577,17578,17579,17580,17581,17582,17583,17584,17585]; // Queue-Times ride IDs, park 65, "Halloween" land
export const PARK_URL = 'https://queue-times.com/parks/65/queue_times.json';

// Queue-Times JSON: { lands:[{name,rides:[{id,name,is_open,wait_time,last_updated}]}], rides:[...] }
export function parseQueueTimes(j) {
  const rides = [...(j.rides || []), ...(j.lands || []).flatMap(l => l.rides || [])];
  return rides.filter(r => HOUSE_IDS.includes(r.id)).map(r => ({
    id: r.id, name: r.name, open: !!r.is_open, wait: r.wait_time, updated: r.last_updated,
  }));
}

export const ageMin = (iso, now = Date.now()) => iso ? (now - Date.parse(iso)) / 60000 : Infinity;
export const isStale = (iso, now, staleMin = 10) => ageMin(iso, now) > staleMin;

// Expected queue minutes. Express is NOT treated as zero and NOT as the posted standby wait.
export function expectedQueue(h, o) {
  if (o.express) return { q: o.expressEst, basis: 'express estimate' };
  if (h.wait == null) return { q: o.fallbackWait ?? 30, basis: 'assumed (no data)' };
  const stale = isStale(h.updated, o.now, o.staleMin);
  return { q: Math.round(h.wait * (stale ? 1.25 : 1)), basis: stale ? 'stale standby +25%' : 'standby' };
}

export const STRATEGIES = {
  max: 'Maximize houses', rated: 'Highest-rated first', walk: 'Minimize walking',
  must: 'Must-sees first', balanced: 'Balanced',
};

export function rank(houses, o) {
  const dur = o.duration ?? 15, left = o.minsLeft ?? Infinity;
  const open = houses.filter(h => !h.done && h.open);
  const rows = open.map(h => {
    const { q, basis } = expectedQueue(h, o);
    const cost = h.walk + q + dur;
    const r = h.rating ?? 7;
    let score = cost;
    if (o.strategy === 'rated') score = cost / (0.5 + r / 10);
    if (o.strategy === 'walk') score = h.walk * 3 + q + dur;
    if (o.strategy === 'must') score = cost - (h.must ? 40 : 0);
    if (o.strategy === 'balanced') score = cost / (0.75 + r / 40) - (h.must ? 10 : 0);
    return { ...h, q, basis, cost, score, fits: cost <= left, stale: isStale(h.updated, o.now, o.staleMin) };
  }).sort((a, b) => (b.fits - a.fits) || a.score - b.score);
  rows.forEach(r => {
    const after = rows.filter(x => x.id !== r.id && x.cost <= left - r.cost).length;
    const bits = [r.walk <= 5 ? 'close by' : `~${r.walk} min walk (your estimate)`,
      `${r.q} min expected queue (${r.basis})`];
    if (r.must) bits.push('on your must-see list');
    bits.push(after ? `leaves time for ${after} more` : 'little time left after');
    r.reason = bits.join(' · ');
  });
  return rows;
}
