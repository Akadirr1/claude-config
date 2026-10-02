<!-- claude-config -->
# claude-config
## Çalışma
- Testler ponytail açısından gereksiz kod sayılmaz.
- İstenenin dışında bir sorun ya da daha iyi bir yol görürsen uygulamadan önce söyle.

## Review
Kod değiştiren her turun sonunda, son mesajdan önce diff'e iki review'ı paralel subagent olarak çalıştır: CODE ve SECURITY. Güvenlik review'ı kod review'ının tasarım kararı sayıp geçtiği şeyi yakalar, bu yüzden küçük değişiklikte de ikisi birden çalışır.
- Seviye: büyük değişiklik ve para, kimlik doğrulama ya da kullanıcı verisi → `reviewer-xhigh`. Büyük değişiklik, refactor ya da para, kimlik doğrulama veya kullanıcı verisine (başvuru formları dahil) dokunan değişiklik → `reviewer-high`. Geri kalan her şey → `reviewer-medium`.
- Son mesajda her review'ın sonucunu tek satırla yaz, "bulgu yok" dahil. Uygulamadığın bulguyu gerekçesiyle söyle. Subagent çalışmadıysa bunu açıkça belirt.
- Plan bitince bütün branch'i bir kez `fable-reviewer`'a review ettir.

## Commit ve PR
- Commit ve PR'lara Claude atfı ekleme: Co-Authored-By, "Generated with Claude Code", Claude-Session satırı ve session linki olmasın.

## Archify
- Diyagramı bana doğrudan gönder. Repoda tutmamı istersem `docs/diagrams/` altına JSON kaynağıyla birlikte commit'le.

## Graphify
- Repoda `graphify-out/` yoksa oturum başında `graphify update .` ile üret. Kodu değiştiren commit'lerden önce güncelle ve `graphify-out/`'u da commit'le.
- `.gitignore`'da şunlar olsun: `graphify-out/????-??-??/`, `graphify-out/cache/`, `graphify-out/manifest.json`.
