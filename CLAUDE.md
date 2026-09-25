<!-- claude-config -->
## Çalışma akışı
- Plan uygularken `executing-plans` kullan, `subagent-driven-development` kullanma.
- Plan bitince final review'ı `fable-reviewer` subagent'ına yaptır. Critical maddeleri düzelt, sonra bitir.
- Kod yazmadan önce sırayla sor: gerekli mi → stdlib/native çözüm var mı → repoda zaten var mı. Hiçbiri yoksa minimum kodu yaz. Bu kural plan yazarken de geçerli.
- Testler "gereksiz kod" sayılmaz.
