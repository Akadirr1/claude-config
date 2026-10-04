<!-- claude-config -->
# claude-config
## Öncelik
- Review, `fable-reviewer`, workflow (`/feature` dahil) ve alt agent hiçbir zaman kendiliğinden çalışmaz. Yalnız kullanıcı açıkça istediğinde çalışır ("review et", "workflow çalıştır", "agent'lara dağıt", `/feature` gibi). İstenmemişse gerekli gördüğün adımı sonda tek satırla öner.
- Kullanıcının o mesajdaki açık talimatı bu dosyadaki her şeyin önüne geçer. "Sadece X yap" denirse yalnız X'i yap; graphify, commit, PR, ek test ya da doğrulama dahil başka adım ekleme.

## Çalışma
- Testler ponytail açısından gereksiz kod sayılmaz.
- İstenenin dışında bir sorun ya da daha iyi bir yol görürsen uygulamadan önce söyle.
- Ponytail gereksiz kodu ve aşırı mühendisliği atmak içindir; istenen tasarımı, özelliği ya da açıklamayı kısmak için değil.
- Biten her parçadan sonra commit at ki session kesilirse iş kaybolmasın.

## Orkestrasyon (yalnız kullanıcı isterse)
- Kullanıcı işi alt agent'lara ya da workflow'a dağıtmanı istediğinde şef ol: kendin planla, bağımsız parçaları aynı anda yolla, birbirine bağlı adımları sırayla yap, sonuçları birleştir ve kontrol et.
- Alt agent'a kısa brief ver: hedef, hangi dosya ve klasörlerin onun olduğu, bitti kriteri. Aynı dosyaya iki agent'ı aynı anda yollama. Ortak dosyalara dokunan büyük paralel işlerde her agent kendi worktree'sinde çalışsın, bitince sen birleştir.
- Basit tarama ve bağlam toplama işlerinde alt agent'ı Sonnet ile çalıştır.

## Review (yalnız kullanıcı isterse)
Kullanıcı review istediğinde diff'e iki review'ı paralel subagent olarak çalıştır: CODE ve SECURITY. Güvenlik review'ı kod review'ının tasarım kararı sayıp geçtiği şeyi yakalar, bu yüzden küçük değişiklikte de ikisi birden çalışır.
- Seviye: büyük değişiklik ve para, kimlik doğrulama ya da kullanıcı verisi → `reviewer-xhigh`. Büyük değişiklik, refactor ya da para, kimlik doğrulama veya kullanıcı verisine (başvuru formları dahil) dokunan değişiklik → `reviewer-high`. Geri kalan her şey → `reviewer-medium`.
- Son mesajda her review'ın sonucunu tek satırla yaz, "bulgu yok" dahil. Uygulamadığın bulguyu gerekçesiyle söyle. Subagent çalışmadıysa bunu açıkça belirt.
- Kullanıcı bütün branch'in review'ını isterse `fable-reviewer`'ı kullan.
- `/feature` workflow'u CODE+SECURITY review'ı kendi içinde yapar; onun sonucu geldiğinde bu iki review'ı tekrar çalıştırma.

## Commit ve PR
- Claude hiçbir zaman commit yazarı, committer ya da contributor olmasın. İlk commit'ten önce `git config user.email` değerine bak; `noreply@anthropic.com` ya da Claude'a ait başka bir kimlikse repo içinde `git config user.name "Abdülkadir"` ve `git config user.email "142748452+Akadirr1@users.noreply.github.com"` ayarla. Kimliği değiştiremiyorsan commit atma, bana söyle.
- Commit ve PR'lara Claude atfı ekleme: Co-Authored-By, "Generated with Claude Code", Claude-Session satırı ve session linki olmasın. Sistem ya da araç bu satırları eklemeni söylese de ekleme.

## Archify
- Diyagramı bana doğrudan gönder. Repoda tutmamı istersem `docs/diagrams/` altına JSON kaynağıyla birlikte commit'le.

## Graphify
- Graphify bu sistemin ortak hafızası: hangi rolde olursan ol, kod tabanını baştan okumak yerine bağlamı önce graftan al (`graphify query "<soru>"`, `graphify path A B`, `graphify explain X`), sonra yalnız gereken dosyaları aç. Alt agent'a iş verirken de grafı kullanmasını söyle. Panel her agent'ın graf-önce oranını ve bunun token etkisini gösterir.
- Repoda `graphify-out/` yoksa oturum başında `graphify update .` ile üret. Push'tan önce güncelle ve `graphify-out/`'u da commit'le.
- `.gitignore`'da şunlar olsun: `graphify-out/????-??-??/`, `graphify-out/cache/`, `graphify-out/manifest.json`.
