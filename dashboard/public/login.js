// Giriş ekranı: kayıtlı temayı uygula, ?e= hata mesajını göster.
const THEMES = ['dark', 'light', 'kehribar', 'orman', 'gul', 'kontrast']
try {
  const t = localStorage.getItem('wf-theme')
  if (THEMES.includes(t)) document.documentElement.dataset.theme = t
} catch {}

const MESSAGES = { bad: 'Token yanlış.', rate: 'Çok fazla deneme, biraz bekle.' }
const code = new URLSearchParams(location.search).get('e')
const msg = Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : null
if (msg) {
  const err = document.getElementById('err')
  err.textContent = msg
  err.hidden = false
}
