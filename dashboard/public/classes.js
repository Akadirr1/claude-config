// Agent sınıfları: Claude agent'ları işe göre serbestçe adlandırır ve tipini seçer; burada yalnız
// geniş sınıflara oturtulur. Sunucu (maliyet/analiz) ve panel (renk/şekil) aynı tabloyu kullanır.
// Puanlama: agent tipi en güçlü sinyal, sonra label ve phase, en zayıfı prompt'un başı (hint).

export const CLASSES = [
  {
    key: 'orchestrator', name: 'Şef', letter: 'Ş', shape: 'star',
    hint: 'Ana döngü: işi planlar, agent doğurur, sonuçları birleştirir',
    types: [], words: [],
  },
  {
    key: 'ba', name: 'Analiz', letter: 'A', shape: 'diamond',
    hint: 'Gereksinim, kapsam, kabul kriteri, plan',
    types: [/^plan$/i, /analy[sz]t/i, /architect/i],
    words: [/\bba\b/, /analiz/, /analy[sz]/, /spec\b/, /\bplan/, /requirement/, /gereksinim/, /kriter/, /scope/, /kapsam/, /architect/, /mimari/, /strateji/, /strategy/, /brief/],
  },
  {
    key: 'explore', name: 'Keşif', letter: 'K', shape: 'hex',
    hint: 'Kod tabanını tarama, bağlam toplama, araştırma',
    types: [/^explore$/i, /research/i, /scout/i],
    words: [/explor/, /keşif/, /ara[şs]t[ıi]r/, /research/, /investig/, /scan/, /tara/, /survey/, /\bmap\b/, /haritala/, /context/, /bağlam/, /discover/, /find/, /bul\b/, /locate/, /inventory/, /envanter/, /scout/, /understand/, /anla/],
  },
  {
    key: 'dev', name: 'Geliştirme', letter: 'D', shape: 'circle',
    hint: 'Kod yazma, düzeltme, refactor, migrasyon',
    types: [/develop/i, /engineer/i, /coder/i, /implement/i],
    words: [/\bdev\b/, /develop/, /geliştir/, /implement/, /uygula/, /\bbuild/, /\bfix/, /düzelt/, /refactor/, /migrat/, /\bcode\b/, /kodla/, /patch/, /feature/, /özellik/, /transform/, /dönüştür/, /port\b/],
  },
  {
    key: 'review', name: 'Review', letter: 'R', shape: 'square',
    hint: 'Kod ve güvenlik incelemesi, denetim',
    types: [/review/i, /audit/i, /critic/i],
    words: [/review/, /incele/, /audit/, /denetle/, /critic/, /eleştir/, /security/, /güvenlik/, /refut/, /skeptic/, /judge/, /yargıç/, /verdict/, /lint/],
  },
  {
    key: 'qa', name: 'QA', letter: 'Q', shape: 'triangle',
    hint: 'Test, doğrulama, kanıt toplama',
    types: [/\bqa\b/i, /test/i, /verif/i],
    words: [/\bqa\b/, /\btest/, /doğrula/, /verif/, /validat/, /kontrol/, /\bcheck/, /e2e/, /smoke/, /regress/, /kanıt/, /evidence/, /reproduc/],
  },
  {
    key: 'design', name: 'Tasarım', letter: 'T', shape: 'pentagon',
    hint: 'Arayüz, görsel, diyagram',
    types: [/design/i, /\bui\b/i, /\bux\b/i],
    words: [/design/, /tasar/, /\bui\b/, /\bux\b/, /mockup/, /diagram/, /diyagram/, /archify/, /palet/, /palette/, /layout/, /görsel/, /visual/, /\bcss\b/, /theme/, /tema/],
  },
  {
    key: 'docs', name: 'Doküman', letter: 'M', shape: 'doc',
    hint: 'Doküman, rapor, özet',
    types: [/doc/i, /writer/i],
    words: [/\bdocs?\b/, /\bnotes?\b/, /\bnot(lar|u)?\b/, /doküman/, /readme/, /changelog/, /rapor/, /report/, /özet/, /summar/, /write-?up/, /yazı/, /guide/, /rehber/, /sentez/, /synthes/],
  },
  {
    key: 'ops', name: 'Operasyon', letter: 'O', shape: 'gear',
    hint: 'Kurulum, deploy, CI, altyapı',
    types: [/ops/i, /deploy/i, /infra/i],
    words: [/deploy/, /\bci\b/, /pipeline/, /install/, /kurulum/, /\bsetup/, /infra/, /altyapı/, /docker/, /release/, /yayın/, /\benv\b/, /config/, /ayar/, /k8s/, /kubernetes/, /coolify/],
  },
  {
    key: 'other', name: 'Diğer', letter: '·', shape: 'dot',
    hint: 'Hiçbir sınıfa oturmayan iş',
    types: [], words: [],
  },
]

export const CLASS = Object.fromEntries(CLASSES.map(c => [c.key, c]))

// Bu repodaki agent tanımları (agents/*.md) ve Claude Code'un yerleşik tipleri
const KNOWN_TYPES = {
  'reviewer-xhigh': 'review', 'reviewer-high': 'review', 'reviewer-medium': 'review', 'fable-reviewer': 'review',
  Explore: 'explore', Plan: 'ba', 'claude-code-guide': 'docs', 'statusline-setup': 'ops',
}

const text = v => (typeof v === 'string' ? v.toLowerCase() : '')

// agent: { label, phase, agentType, hint, main }
export function classify(agent) {
  if (!agent || agent.main) return 'orchestrator'
  const type = typeof agent.agentType === 'string' ? agent.agentType : ''
  if (Object.hasOwn(KNOWN_TYPES, type)) return KNOWN_TYPES[type]
  const sources = [
    [text(agent.label), 3],
    [text(agent.phase), 3],
    [text(agent.hint).slice(0, 400), 1],
  ]
  let best = 'other'
  let top = 0
  for (const c of CLASSES) {
    let score = c.types.some(re => re.test(type)) ? 6 : 0
    for (const [s, w] of sources) if (s) for (const re of c.words) if (re.test(s)) score += w
    if (score > top) {
      top = score
      best = c.key
    }
  }
  return best
}
