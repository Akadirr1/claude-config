<!-- claude-config -->
# claude-config
## Çalışma
- İstenenin dışında bir sorun ya da daha iyi bir yol görürsen uygulamadan önce söyle.
- Emin olmadığın ya da varsayım yaptığın yeri açıkça söyle, tahmini gerçek gibi yazma.
- "Bitti" demeden önce kanıtla: testi ya da build'i çalıştır, arayüz işinde ekran görüntüsüne bak.
- Testler ponytail açısından gereksiz kod sayılmaz.
- Aynı hata bir projede ikinci kez çıkarsa o projenin CLAUDE.md'sine tek satırlık kural öner.

## Alt agent'lar
- Dosya tarama ve araştırma gibi salt okuma işlerini alt agent'a (Sonnet) ver; sana kısa özet dönsün.
- Yazan agent'ları paralel çalıştıracaksan dokunacakları dosyalar ayrı olsun; ortak dosya varsa her biri kendi worktree'sinde çalışsın, sen birleştir.
- Alt agent'lar `git reset --hard`, `git clean` ve `git checkout .` kullanmasın.
- Biten her parçadan sonra commit at.

## Review
- Para, kimlik doğrulama ya da kullanıcı verisine (başvuru formları dahil) dokunan değişiklikte bitirmeden önce diff'i `reviewer` agent'ına ver. Diğer işlerde review'ı ben isteyince çalıştır.
- `fable-reviewer`'ı sadece ben istediğimde çalıştır.

## Commit ve PR
- Commit ve PR'lara Claude atfı ekleme: Co-Authored-By, "Generated with Claude Code", Claude-Session satırı ve session linki olmasın.

## Diyagram
- Archify diyagramını bana doğrudan gönder; repoya ancak istersem `docs/diagrams/` altına JSON kaynağıyla commit'le.
