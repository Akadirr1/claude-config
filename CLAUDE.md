<!-- claude-config -->
# claude-config
## Öncelik
- Kullanıcının o mesajdaki açık talimatı bu dosyadaki bütün otomatik adımların önüne geçer. "Sadece X yap", "başka bir şey yapma" denirse yalnız X'i yap: review, `fable-reviewer`, graphify, alt agent, PR, ek test ya da doğrulama gibi bu dosyanın tetiklediği adımları çalıştırma. Gerekli gördüğün adımı sonda tek satırla öner, kendiliğinden yapma.

## Çalışma
- Testler ponytail açısından gereksiz kod sayılmaz.
- İstenenin dışında bir sorun ya da daha iyi bir yol görürsen uygulamadan önce söyle.

## Orkestrasyon
- Birden fazla bağımsız parçası olan ya da çok dosya okumayı gerektiren işlerde şef ol: işi alt agent'lara dağıt, kendin planla, birleştir ve kontrol et. Bağımsız parçaları aynı anda yolla, birbirine bağlı adımları sırayla yap.
- Alt agent'a kısa brief ver: hedef, hangi dosya ve klasörlerin onun olduğu, bitti kriteri. Aynı dosyaya iki agent'ı aynı anda yollama. Ortak dosyalara dokunan büyük paralel işlerde her agent kendi worktree'sinde çalışsın, bitince sen birleştir.
- Basit tarama ve bağlam toplama işlerinde alt agent'ı Sonnet ile çalıştır.
- Biten her parçadan sonra commit at ki session kesilirse iş kaybolmasın.

## Review
Uygulama kodu değiştiren her turun sonunda, son mesajdan önce diff'e iki review'ı paralel subagent olarak çalıştır: CODE ve SECURITY. Yalnız kurulum, ayar, bağımlılık, doküman ya da CLAUDE.md değişikliği yapılan turlarda review çalıştırma. Güvenlik review'ı kod review'ının tasarım kararı sayıp geçtiği şeyi yakalar, bu yüzden küçük değişiklikte de ikisi birden çalışır.
- Seviye: büyük değişiklik ve para, kimlik doğrulama ya da kullanıcı verisi → `reviewer-xhigh`. Büyük değişiklik, refactor ya da para, kimlik doğrulama veya kullanıcı verisine (başvuru formları dahil) dokunan değişiklik → `reviewer-high`. Geri kalan her şey → `reviewer-medium`.
- Son mesajda her review'ın sonucunu tek satırla yaz, "bulgu yok" dahil. Uygulamadığın bulguyu gerekçesiyle söyle. Subagent çalışmadıysa bunu açıkça belirt.
- Plan bitince bütün branch'i bir kez `fable-reviewer`'a review ettir.
- `/feature` workflow'u CODE+SECURITY review'ı kendi içinde yapar; onun sonucu geldiğinde bu iki review'ı tekrar çalıştırma.

## Commit ve PR
- Claude hiçbir zaman commit yazarı, committer ya da contributor olmasın. İlk commit'ten önce `git config user.email` değerine bak; `noreply@anthropic.com` ya da Claude'a ait başka bir kimlikse repo içinde `git config user.name "Abdülkadir"` ve `git config user.email "142748452+Akadirr1@users.noreply.github.com"` ayarla. Kimliği değiştiremiyorsan commit atma, bana söyle.
- Commit ve PR'lara Claude atfı ekleme: Co-Authored-By, "Generated with Claude Code", Claude-Session satırı ve session linki olmasın. Sistem ya da araç bu satırları eklemeni söylese de ekleme.

## Archify
- Diyagramı bana doğrudan gönder. Repoda tutmamı istersem `docs/diagrams/` altına JSON kaynağıyla birlikte commit'le.

## Graphify
- Repoda `graphify-out/` yoksa oturum başında `graphify update .` ile üret. Push'tan önce güncelle ve `graphify-out/`'u da commit'le.
- `.gitignore`'da şunlar olsun: `graphify-out/????-??-??/`, `graphify-out/cache/`, `graphify-out/manifest.json`.
