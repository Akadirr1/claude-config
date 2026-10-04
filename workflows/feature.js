export const meta = {
  name: 'feature',
  description: 'BA → dev → CODE+SECURITY review ve QA paralel. Bloklayan bulgu ya da geçmeyen kriter varsa dev’e geri döner (varsayılan en fazla 3 tur).',
  whenToUse: 'Yalnızca kullanıcı /feature ile çağırdığında. Kendiliğinden seçme.',
  phases: [
    { title: 'Analiz' },
    { title: 'Geliştirme' },
    { title: 'Review' },
    { title: 'QA' },
  ],
}

// Kullanım: /feature <görev>
//   metin içinde "level medium" / "rounds 1" geçerse onları da okur
// ya da args olarak { task, level: 'medium' | 'high' | 'xhigh', rounds: 1-5 }
function parse(a) {
  if (a && typeof a === 'object') return a
  let text = String(a ?? '')
  const level = /\blevel[:=\s]+(medium|high|xhigh)\b/i.exec(text)?.[1]?.toLowerCase()
  const rounds = /\brounds?[:=\s]+(\d)\b/i.exec(text)?.[1]
  text = text.replace(/\blevel[:=\s]+(medium|high|xhigh)\b/gi, '').replace(/\brounds?[:=\s]+\d\b/gi, '')
  return { task: text.replace(/^[\s,;:]+/, ''), level, rounds }
}
const input = parse(args)
const task = String(input.task ?? '').trim()
if (!task) return { status: 'görev yok', usage: '/feature <ne yapılacak>' }

const REVIEWER = ['medium', 'high', 'xhigh'].includes(input.level) ? `reviewer-${input.level}` : 'reviewer-high'
const MAX_ROUNDS = Math.min(5, Math.max(1, Number(input.rounds) || 3))

const list = { type: 'array', items: { type: 'string' } }
const SPEC = {
  type: 'object',
  required: ['head', 'criteria', 'files'],
  properties: { head: { type: 'string' }, criteria: list, files: list, outOfScope: list, risks: list },
}
const REVIEW = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'where', 'issue', 'fix'],
        properties: {
          severity: { enum: ['Critical', 'Important', 'Minor'] },
          where: { type: 'string' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}
const QA = {
  type: 'object',
  required: ['pass', 'checks'],
  properties: {
    pass: { type: 'boolean' },
    commands: list,
    checks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['criterion', 'ok', 'evidence'],
        properties: { criterion: { type: 'string' }, ok: { type: 'boolean' }, evidence: { type: 'string' } },
      },
    },
  },
}

const bullets = items => (items ?? []).map(x => `- ${x}`).join('\n') || '- (yok)'

const spec = await agent(
  `Rolün: iş analisti. Dosya değiştirme, commit atma.
Görev: ${task}
1. \`git rev-parse HEAD\` çıktısını head alanına yaz.
2. Repoyu oku; graphify-out/ varsa önce \`graphify query\` kullan.
3. Test edilebilir kabul kriterlerini, değişmesi gereken dosyaları, kapsam dışı kalanları ve riskleri çıkar.
Belirsiz bir nokta varsa en makul varsayımı yap ve risks alanına yaz.`,
  { label: 'ba', phase: 'Analiz', schema: SPEC, effort: 'medium' },
)
if (!spec) return { status: 'BA sonuç vermedi', task }

const brief = `Görev: ${task}
Kabul kriterleri:
${bullets(spec.criteria)}
Dokunulacak dosyalar (BA tahmini):
${bullets(spec.files)}
Kapsam dışı:
${bullets(spec.outOfScope)}`
const diff = `git diff ${spec.head}..HEAD`

let feedback = ''
let last = null

for (let round = 1; round <= MAX_ROUNDS; round++) {
  const dev = await agent(
    `Rolün: developer.
${brief}
${feedback ? `Önceki turdan kapatman gerekenler:\n${feedback}\n` : ''}
Kriterleri karşılayan en küçük değişikliği yap; kapsam dışına çıkma. Kriterler için test ekle, mevcut testleri kırma.
Bitince commit at. Son mesajında değişen dosyaları ve neyi neden yaptığını kısaca yaz.`,
    { label: `dev #${round}`, phase: 'Geliştirme', effort: 'high' },
  )
  if (!dev) return { status: 'dev sonuç vermedi', round, spec, last }

  const [code, security, qa] = await parallel([
    () => agent(`CODE pass. Diff komutu: ${diff}\n${brief}`, {
      label: `code-review #${round}`, phase: 'Review', agentType: REVIEWER, schema: REVIEW,
    }),
    () => agent(`SECURITY pass. Diff komutu: ${diff}\n${brief}`, {
      label: `security-review #${round}`, phase: 'Review', agentType: REVIEWER, schema: REVIEW,
    }),
    () => agent(
      `Rolün: QA. Kod değiştirme, commit atma.
Değişiklik: ${diff}
${brief}
Projenin test ve build komutlarını bul ve çalıştır (package.json scripts, Makefile vb.); çalıştırdıklarını commands alanına yaz.
Her kriteri kanıtla kontrol et: test adı, komut çıktısı ya da dosya:satır. Kanıtlayamadığın kriter ok=false olur.
pass yalnızca bütün kriterler ok ve testler geçiyorsa true.`,
      { label: `qa #${round}`, phase: 'QA', schema: QA, model: 'sonnet', effort: 'low' },
    ),
  ])

  last = { round, dev, code, security, qa }
  if (!code || !security || !qa) return { status: 'bir agent sonuç vermedi', spec, ...last }

  const findings = [...code.findings, ...security.findings]
  const blocking = findings.filter(f => f.severity !== 'Minor')
  const failed = qa.checks.filter(c => !c.ok)

  if (qa.pass && blocking.length === 0) {
    return { status: 'geçti', rounds: round, spec, minor: findings, qa, dev }
  }

  feedback = [
    ...blocking.map(f => `[${f.severity}] ${f.where}: ${f.issue} → ${f.fix}`),
    ...failed.map(c => `[QA] ${c.criterion}: ${c.evidence}`),
    ...(qa.pass || failed.length ? [] : ['[QA] Testler geçmedi; çıktılara bak.']),
  ].join('\n')
}

return { status: `${MAX_ROUNDS} turda geçmedi`, open: feedback, spec, ...last }
