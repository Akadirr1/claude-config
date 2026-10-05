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
| `WF_PUBLIC_URL` | hayır | Panelin dış adresi (`https://wf.ornek.com`). Otomasyon bildirimleri panele bağlantı taşır. |

Cloud ortamında (setup script'i `install.sh` çalıştıran) `WF_MONITOR_URL=https://<alan>/api/push` ve
`WF_MONITOR_TOKEN` tanımlı olmalı; mod onlarla push eder.

## Görünümler

- **Canlı:** Şef kartı (hedef, durum, araç karışımı, graf-önce oranı), takımyıldız (Şef ve doğurduğu
  agent/run'lar), seçili workflow'un phase × tur grafiği (zaman yolculuğu, kritik yol, paralellik, benzer
  run'ların ortalama maliyeti), oturum geneli zaman çubukları, olay akışı (doğum, devir, bitiş, hata, uyarı).
- **Token** (birim düğmesi `tok`/`$`; varsayılan token): **yeni token = giriş + cache yazma + çıkış**. Cache okuma
  (her model isteğinde bağlamın tekrar okunması; fiyatı girişin onda biri) "tekrar okunan" olarak ayrı gösterilir ve
  toplama katılmaz; katılsa iş ~10 kat büyük görünür. Aralık ve repo filtresi; günlük token (sınıflara göre), sınıf/model/repo kırılımı ve cache isabeti, **graphify karnesi**
  (sınıf bazında grafı kullanan vs dosya tarayan agent'ların ortanca bağlam tokeni), **bağlamı kim şişirdi** (iki
  model isteği arasındaki bağlam artışı aradaki araç çağrılarına yazılır; araç adına göre toplam ve en büyük
  sıçramalar), **cache israfı** (cache'e yazıp geri okumayan agent'lar), en çok token yakan agent'lar, workflow başına
  token, 12 haftalık ritim, CSV defter (zirve bağlam ve phase sütunlarıyla).
- **Canlı → agent detayı:** token kırılımı, cache isabeti, cache israfı uyarısı ve **bağlam eğrisi** (her model
  isteğinde bağlam büyüklüğü, cache okuma payı, en büyük sıçramalar ve öncesindeki araç çağrıları).
- **Canlı → karşılaştır:** seçili workflow run'ını aynı adlı başka bir run'la phase/agent bazında token farkıyla yan yana.
- **Canlı → Token önerileri:** session'ın verisinden somut tespitler: Şef'in (ana session) payı, yüksek taban bağlamlı
  agent tipleri (`worker` önerisi), çok tur atan agent'lar, grafı kullanmayan agent'lar, cache israfı, en büyük sıçrama.
- **Token → Deneyler:** ilk mesajına `[deney:ad]` yazılan session'lar etiketlenir ve etiket başına ortancalarla
  karşılaştırılır. `[deney:grafsiz]` o session'da graphify'ı kapatır (mod graf çağrılarını reddeder), `[deney:grafli]`
  ile aynı görev çalıştırılıp graphify'ın token etkisi ölçülür. `[deney:belleksiz]` agentmemory MCP araçlarını kapatır
  (`[deney:bellekli]` ile karşılaştırılır); etiketler `grafsiz-belleksiz` gibi birleşebilir. Graf varken mod her alt agent'ın görevine kısa bir
  graphify ipucu ekler.
- **Canlı → Eserler:** session'ın açtığı PR'lar, commit'ler ve değişen dosyalar; her birinin yanında onu üreten agent.
- **Geçmiş:** bütün session'lar; sıralama, arama, sınıf karışımı şeridi.
- **Evren:** bütün defter tek gökyüzünde. Her session bir yıldız (merkez en eski, dış kollar en yeni;
  büyüklük maliyet, renk en çok harcayan sınıf), aynı repo'nun session'ları takımyıldız çizgisiyle bağlı.
- **Otomasyon:** "şu olunca → şunu yap" kuralları sunucuda çalışır, panel kapalıyken de. Tetikleyiciler: workflow
  bitti/başarısız, agent hata verdi, PR açıldı, session/günlük maliyet eşiği, bütçenin %50/80/100'ü, agent N dk
  sessiz, workflow N dk'yı geçti. Kanallar: JSON webhook, Slack, Discord, ntfy (telefona push; `https://ntfy.sh/<gizli-konu>`).
  Günlük/aylık bütçe, ay sonu tahmini, her sabah dünün özeti, teslim günlüğü. Yalnız `https` ve dış adreslere gönderir.
  **Kural yazmak için ayrı `WF_VIEW_TOKEN` gerekir** (yoksa salt okunur): tek token'la cloud ortamındaki push token'ı da
  panele girip kendi webhook'unu ekleyebilirdi. Webhook adresleri panele maskeli gelir.
- Komut paleti (`Ctrl/⌘+K` ya da `/`): görünümler, session/agent arama, 6 tema (Obsidyen, Parşömen, Kehribar CRT,
  Orman, Gül, Yüksek kontrast), **TV modu** (başlık gizlenir; canlı session'lar, Evren ve Maliyet 30 sn'de bir döner),
  **ses** (olaylar sınıfına göre notaya dönüşür). Bildirimler (🔔; iOS'ta ana ekrana ekleyince).

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
