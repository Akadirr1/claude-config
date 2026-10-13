---
name: yt-transcript
description: YouTube videosunun transcript'ini (altyazı metnini) çeker ya da takip edilen kanalların son videolarını listeler. Kullanıcı bir YouTube linki verdiğinde, "şu videoyu özetle / transcript'ini al" dediğinde ya da takip ettiği kanalların (ör. Avenox) yeni videolarını sorduğunda kullan.
---

# YouTube transcript

Bulut IP'leri YouTube tarafından engelli (yt-dlp ve youtube-transcript-api burada "bot musun" ya da IpBlocked hatası verir). Bu yüzden doğrudan YouTube'a gitme, evdeki Pi'de çalışan servisi kullan.

```bash
B="$YT_TRANSCRIPT_URL"; H="Authorization: Bearer $YT_TRANSCRIPT_TOKEN"
curl -s -H "$H" "$B/transcript?v=<video id ya da link>&format=txt"   # düz metin
curl -s -H "$H" "$B/transcript?v=<id>"                                # JSON: lang, generated, text
curl -s -H "$H" "$B/channel?h=@avenoxai&n=15"                         # son videolar (en fazla 15)
```

- `lang` varsayılanı `tr,en`. Elle yazılmış altyazı varsa o, yoksa otomatik altyazı gelir; JSON'daki `generated` bunu söyler.
- Transcript'i dosyaya yaz ve oradan oku, konuşmaya olduğu gibi yapıştırma; 15 dakikalık video ~25 bin karakter eder.
- Birden fazla video varsa her birini ayrı bir alt agent (Sonnet) özetlesin, sen birleştir.

## Takip edilen kanallar

- Avenox — `@avenoxai` — güncel AI kullanımı, Claude/model karşılaştırmaları, optimizasyon

## Servis yoksa

- `YT_TRANSCRIPT_URL` tanımlı değilse ya da servis 5xx dönüyorsa bunu kullanıcıya söyle.
- Session kullanıcının bilgisayarına bağlıysa aynı işi orada `youtube-transcript-api` ile yapabilirsin; ev IP'si engelli değil.
