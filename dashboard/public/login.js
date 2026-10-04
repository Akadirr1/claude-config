// Giriş ekranı: kayıtlı temayı uygula, ?e= hata mesajını göster.
try {
  if (localStorage.getItem('wf-theme') === 'light') document.documentElement.dataset.theme = 'light'
} catch {}

const MESSAGES = { bad: 'Token yanlış.', rate: 'Çok fazla deneme, biraz bekle.' }
const msg = MESSAGES[new URLSearchParams(location.search).get('e')]
if (msg) {
  const err = document.getElementById('err')
  err.textContent = msg
  err.hidden = false
}
