// Liste fiyatları, milyon token başına USD (Claude API, 2026-09). Claude Code aboneliğinde gerçek
// fatura farklıdır; panel bunu "API karşılığı" olarak gösterir. WF_PRICING_FILE ile sunucuda ezilebilir.
// cw: 5 dakikalık cache yazma (1.25× giriş), cr: cache okuma (modele göre değişir).
export const PRICES = {
  'claude-fable-5-1': { in: 10, out: 50, cw: 12.5, cr: 0.25 },
  'claude-mythos-5-1': { in: 10, out: 50, cw: 12.5, cr: 0.25 },
  'claude-fable-5': { in: 10, out: 50, cw: 12.5, cr: 1 },
  'claude-mythos-5': { in: 10, out: 50, cw: 12.5, cr: 1 },
  'claude-opus-5-5': { in: 4, out: 20, cw: 5, cr: 0.2 },
  'claude-opus-5': { in: 5, out: 25, cw: 6.25, cr: 0.5 },
  'claude-opus-4-8': { in: 5, out: 25, cw: 6.25, cr: 0.5 },
  'claude-opus-4-7': { in: 5, out: 25, cw: 6.25, cr: 0.5 },
  'claude-opus-4-6': { in: 5, out: 25, cw: 6.25, cr: 0.5 },
  'claude-opus-4-5': { in: 5, out: 25, cw: 6.25, cr: 0.5 },
  'claude-opus-4-1': { in: 15, out: 75, cw: 18.75, cr: 1.5 },
  'claude-opus-4': { in: 15, out: 75, cw: 18.75, cr: 1.5 },
  'claude-sonnet-5-5': { in: 2, out: 10, cw: 2.5, cr: 0.2 },
  'claude-sonnet-5': { in: 2, out: 10, cw: 2.5, cr: 0.2 },
  'claude-sonnet-4-6': { in: 3, out: 15, cw: 3.75, cr: 0.3 },
  'claude-sonnet-4-5': { in: 3, out: 15, cw: 3.75, cr: 0.3 },
  'claude-sonnet-4': { in: 3, out: 15, cw: 3.75, cr: 0.3 },
  'claude-haiku-4-5': { in: 1, out: 5, cw: 1.25, cr: 0.1 },
  'claude-3-5-haiku': { in: 0.8, out: 4, cw: 1, cr: 0.08 },
}

const ALIAS = { fable: 'claude-fable-5-1', opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-4-5' }

// "claude-opus-5-5[1m]", "us.anthropic.claude-sonnet-4-5-20250929-v1:0", "opus" → tablodaki anahtar
export function modelKey(model, table = PRICES) {
  let m = String(model ?? '').toLowerCase().trim()
  if (Object.hasOwn(ALIAS, m)) return ALIAS[m]
  m = m.replace(/\[.*?\]/g, '').replace(/^.*?(claude-)/, '$1').replace(/-v\d+(:\d+)?$/, '').replace(/[@-]\d{8}$/, '')
  if (Object.hasOwn(table, m)) return m
  // en uzun önek eşleşmesi: claude-opus-4-5-20251101 → claude-opus-4-5
  let best = null
  for (const k of Object.keys(table)) if (m.startsWith(k) && (!best || k.length > best.length)) best = k
  return best
}

// u: { in, out, cr, cw } token sayıları → USD
export function costOf(model, u, table = PRICES) {
  const k = modelKey(model, table)
  const p = k ? table[k] : null
  if (!p || !u) return 0
  return ((u.in || 0) * p.in + (u.out || 0) * p.out + (u.cw || 0) * p.cw + (u.cr || 0) * p.cr) / 1e6
}

export const shortModel = model => {
  const k = modelKey(model)
  return (k ?? String(model ?? '?')).replace(/^claude-/, '').replace(/-(\d)-(\d)$/, ' $1.$2').replace(/-(\d)$/, ' $1')
}
