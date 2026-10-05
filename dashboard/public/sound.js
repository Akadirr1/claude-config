// Sonifikasyon (isteğe bağlı): olaylar kısa, yumuşak seslere dönüşür. Her sınıfın kendi notası var
// (pentatonik, yan yana çalınca uyumlu); doğum tıngırtı, bitiş yükselen iki nota, hata alçalan, PR arpej.
// Ses dosyası yok: Web Audio ile üretilir. Tarayıcı ilk sesi kullanıcı dokunuşundan sonra açar.
import { pref } from './util.js'

const NOTE = { orchestrator: 0, ba: 2, explore: 4, dev: 7, review: 9, qa: 12, design: 14, docs: 16, ops: 19, other: 5 }
let ctx = null
let on = pref.get('sound', '0') === '1'
let recent = []

export const soundOn = () => on
// tercih kayıtlıysa: tarayıcı sesi ancak bir dokunuştan sonra açar, ilk dokunuşta bağlam kurulur
if (on) {
  const wake = () => {
    try {
      ctx ??= new AudioContext()
      ctx.resume?.()
    } catch {}
    removeEventListener('pointerdown', wake)
    removeEventListener('keydown', wake)
  }
  addEventListener('pointerdown', wake)
  addEventListener('keydown', wake)
}
export function setSound(v) {
  on = v
  pref.set('sound', v ? '1' : '0')
  if (v) {
    try {
      ctx ??= new AudioContext()
      ctx.resume?.()
    } catch {
      on = false
    }
    chime([0, 7, 12], 0.09)
  }
  return on
}

function tone(semi, at, dur = 0.5, type = 'sine', gain = 0.08) {
  const t = ctx.currentTime + at
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.value = 220 * 2 ** ((semi + 12) / 12)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(ctx.destination)
  o.start(t)
  o.stop(t + dur + 0.05)
}
const chime = (notes, step = 0.12, type = 'sine') => notes.forEach((n, i) => tone(n, i * step, 0.6, type))

// Olay → ses. Saniyede en fazla 5; kalabalık anlarda gürültü olmasın.
export function play(ev) {
  if (!on || !ctx || ctx.state === 'closed') return
  const now = performance.now()
  recent = recent.filter(t => now - t < 1000)
  if (recent.length >= 5) return
  recent.push(now)
  const n = NOTE[ev.cls] ?? 5
  try {
    if (ev.pr) chime([0, 4, 7, 12, 16], 0.08)
    else if (ev.type === 'art') chime([n, n + 12], 0.06, 'triangle')
    else if (ev.type === 'error') chime([n, n - 5, n - 10], 0.14, 'triangle')
    else if (ev.type === 'warn') tone(n - 12, 0, 0.8, 'triangle', 0.06)
    else if (ev.runEnd) chime(ev.runEnd === 'done' ? [0, 4, 7, 12] : [7, 3, 0], 0.11)
    else if (ev.type === 'end') chime([n, n + 7], 0.09)
    else tone(n + 12, 0, 0.35, 'sine', 0.05)
  } catch {}
}
