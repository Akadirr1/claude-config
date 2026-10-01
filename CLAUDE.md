<!-- claude-config -->
# claude-config
## Çalışma akışı
- Plan uygularken `executing-plans` kullan, `subagent-driven-development` kullanma.
- Kod yazmadan önce sırayla sor: gerekli mi → stdlib/native çözüm var mı → repoda zaten var mı. Hiçbiri yoksa minimum kodu yaz. Bu kural plan yazarken de geçerli.
- Testler "gereksiz kod" sayılmaz.

## Kendi kodunu teslimden önce review et
- Kod değiştiren her turda, son mesajından önce diff üzerinde iki review çalıştır: kod review'ı ve güvenlik review'ı. Değişiklik bariz doğru görünse de ikisi de her zaman çalışır; güvenlik review'ı, kod review'ının "tasarım kararı" deyip geçtiği şeyi yakalar.
- İkisini aynı mesajda iki ayrı subagent olarak başlat ki paralel çalışsınlar. Her birine diff komutunu, gereken bağlamı ve hangi review olduğunu (CODE / SECURITY) ver.
- Agent'ı değişikliğe göre seç, kendi güvenine göre değil:
  - `reviewer-xhigh`: büyük değişiklik ve aynı zamanda para, kimlik doğrulama veya kullanıcı verisine dokunuyor.
  - `reviewer-high`: büyük değişiklik, refactor ya da para, kimlik doğrulama veya kullanıcı verisine (başvuru formları, KVKK kapsamındaki veriler dahil) dokunan her değişiklik.
  - `reviewer-medium`: sıradan çok dosyalı değişiklik. Tek satırlık değişiklik veya rename de bu seviyede iki review'dan geçer.
- Gerçek bulguları düzelt, ilgili doğrulamayı (test, lint, build) yeniden çalıştır.
- Son mesajda her review için tek satır yaz, "bulgu yok" dahil, ki çalıştıkları belli olsun. Uygulamamaya karar verdiğin bulguyu gerekçesiyle açıkça söyle, sessizce atlama.
- Subagent çalıştıramıyorsan iki review'ı kendin yap ve bunu açıkça yaz. Bağımsız review çalışmadıysa çalıştı deme.
- Plan bitince bunlara ek olarak bütün branch'i bir kez `fable-reviewer`'a review ettir. Critical maddeleri düzelt, sonra bitir.

## Commit ve PR
- Commit mesajlarına ve PR açıklamalarına Claude atfı ekleme: "Co-Authored-By: Claude", "Generated with Claude Code", "Claude-Session:" satırı ve session linki olmasın.
- Commit yazarı kullanıcının git kimliğidir. Claude'u co-author ya da contributor olarak ekleme.

## Archify
- Archify ile diyagram ürettiğinde HTML dosyasını bana doğrudan gönder; repoya ekleme.
- Diyagramı repoda tutmamı istersem `docs/diagrams/` altına HTML'i JSON kaynağıyla birlikte commit'le (sonraki session JSON'dan devam edebilsin).

## Graphify
- Oturum başında repoda `graphify-out/` yoksa `graphify update .` ile üret.
- Kodu değiştiren her commit'ten önce `graphify update .` çalıştır ve `graphify-out/` klasörünü de commit'e ekle.
- `.gitignore`'da `graphify-out/????-??-??/` satırı yoksa ekle (graphify'ın günlük yedek klasörleri, commit'e girmemeli). `graphify-out/cache/` ve `graphify-out/manifest.json` da ignore'da olsun (dosya tarihi tutuyorlar, kod değişmeden diff üretiyorlar).
