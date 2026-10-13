# yt-transcript

Bulut session'larının YouTube transcript'i alabilmesi için Pi'de çalışan küçük servis. YouTube datacenter IP'lerini engelliyor, ev IP'sini engellemiyor.

## Coolify'da kurulum (Pi)

1. Yeni Resource → Public/Private Repository → `Akadirr1/claude-config`, branch `main`
2. Build Pack: **Dockerfile**, Base Directory: `/services/yt-transcript`, Port: `8000`
3. Environment: `YT_TOKEN` = en az 16 karakterlik rastgele bir değer (`openssl rand -hex 24`)
4. Domain: `https://yt.akadir.tech` (wf.akadir.tech'te olduğu gibi Cloudflare tüneli)
5. Deploy → `curl https://yt.akadir.tech/healthz` → `{"ok": true}`

## Claude Code cloud ortamına ekle

Ortam ayarlarındaki environment variables kısmına:

```
YT_TRANSCRIPT_URL=https://yt.akadir.tech
YT_TRANSCRIPT_TOKEN=<YT_TOKEN ile aynı değer>
```

## Uçlar

| Uç | Ne yapar |
|---|---|
| `GET /healthz` | Sağlık kontrolü (token istemez) |
| `GET /transcript?v=<id/link>&lang=tr,en&format=txt` | Transcript; `format` yoksa JSON |
| `GET /channel?h=@avenoxai&n=15` | Kanalın son videoları (RSS, en fazla 15) |

Hepsi `Authorization: Bearer <YT_TOKEN>` ister.
