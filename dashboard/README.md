# wf · akış

Cloud session'lardaki bütün agentic işi canlı gösteren ve kalıcı olarak defterleyen panel:
Şef (orkestratör), doğurduğu alt agent'lar, workflow devirleri; her agent'ın token kullanımı ve maliyeti.
Veriyi `mods/wf-monitor` mod'u gönderir (sözleşme v3).

## Deploy (Coolify)

- Build: bu klasördeki `Dockerfile` (base directory `/dashboard`), port 3000, healthcheck `/healthz`.
- **Kalıcı depolama:** Storages → container path `/app/data` olan bir volume. Bağlanmazsa panel çalışır ama
  her deploy'da geçmiş sıfırlanır.
- Sunucu Cloudflare (tercihen Tunnel) arkasında olmalı: giriş hız sınırı `CF-Connecting-IP`'ye güvenir.

| Env | Zorunlu | Açıklama |
|---|---|---|
| `WF_MONITOR_TOKEN` | evet | ≥16 (öneri ≥32) karakter. `/api/push` Bearer'ı; `WF_VIEW_TOKEN` yoksa giriş token'ı da. |
| `WF_VIEW_TOKEN` | hayır | Panele giriş için ayrı token. Tanımlıysa cloud ortamındaki push token'ı panele giremez. |
| `WF_DATA_DIR` | hayır | Defter klasörü (Docker'da `/app/data`). |
| `WF_PRICING_FILE` | hayır | Model fiyatlarını ezen JSON: `{"claude-opus-5-5": {"in": 4, "out": 20, "cw": 5, "cr": 0.2}}` (milyon token başına USD). |

Cloud ortamında (setup script'i `install.sh` çalıştıran) `WF_MONITOR_URL=https://<alan>/api/push` ve
`WF_MONITOR_TOKEN` tanımlı olmalı; mod onlarla push eder.

## Görünümler

- **Canlı:** Şef kartı (hedef, durum, araç karışımı, graf-önce oranı), takımyıldız (Şef ve doğurduğu
  agent/run'lar), seçili workflow'un phase × tur grafiği (zaman yolculuğu, kritik yol, paralellik, benzer
  run'ların ortalama maliyeti), oturum geneli zaman çubukları, olay akışı (doğum, devir, bitiş, hata, uyarı).
- **Maliyet:** aralık ve repo filtresi; günlük maliyet (sınıflara göre), sınıf/model/repo kırılımı,
  graphify etkisi (grafı kullanan vs dosya tarayan agent'ların ortalama giriş tokeni ve maliyeti),
  en pahalı agent'lar, workflow başına maliyet, 12 haftalık ritim, CSV defter.
- **Geçmiş:** bütün session'lar; sıralama, arama, sınıf karışımı şeridi.
- Komut paleti (`Ctrl/⌘+K` ya da `/`), bildirimler (🔔; iOS'ta ana ekrana ekleyince), açık/koyu tema.

Agent sınıfları (`public/classes.js`) Claude'un serbestçe verdiği label, phase, agent tipi ve prompt'un
başından puanlanır; Claude'un agent seçimi kısıtlanmaz. Maliyetler API liste fiyatıyla karşılıktır
(`public/pricing.js`); abonelikte gerçek fatura farklıdır.

## Geliştirme

```
WF_MONITOR_TOKEN=deneme-token-0123456789abcdef node dashboard/server.mjs
WF_MONITOR_TOKEN=deneme-token-0123456789abcdef node dashboard/dev/simulate.mjs --history 21
node --test dashboard/test/*.test.mjs
```

Cookie her zaman `Secure`: düz `http://localhost` ile Chrome/Firefox çalışır, Safari çalışmaz.
