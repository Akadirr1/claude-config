#!/bin/bash
# Claude Code cloud ortam kurulumu. Setup script'ten çağrılır.
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG=/tmp/setup.log

# Plugin'ler
claude plugin marketplace add anthropics/claude-plugins-official >> $LOG 2>&1 || echo "FAIL: official marketplace" >> $LOG
claude plugin marketplace add DietrichGebert/ponytail >> $LOG 2>&1 || echo "FAIL: ponytail marketplace" >> $LOG
claude plugin install ponytail@ponytail >> $LOG 2>&1 || echo "FAIL: ponytail" >> $LOG

# Graphify (kendi bölümünü ~/.claude/CLAUDE.md'ye yazar)
pip install graphifyy >> $LOG 2>&1 && graphify install >> $LOG 2>&1 || echo "FAIL: graphify" >> $LOG

# Archify (diyagram skill'i, ~/.claude/skills/ altına)
npx -y skills add tt-a1i/archify --skill archify --agent claude-code --global --copy --yes >> $LOG 2>&1 || echo "FAIL: archify" >> $LOG

# Git kimliği: commit'ler Claude adına değil benim adıma atılsın (ortam ~/.gitconfig'e Claude yazıyor)
git config --global user.name "Abdülkadir" && git config --global user.email "142748452+Akadirr1@users.noreply.github.com" \
  && echo "OK: git identity" >> $LOG || echo "FAIL: git identity" >> $LOG

# Agent'lar
mkdir -p ~/.claude/agents
cp "$DIR"/agents/*.md ~/.claude/agents/ && echo "OK: agents" >> $LOG || echo "FAIL: agents" >> $LOG

# Workflow'lar: yalnızca /ad ile elle çağrılır, kendiliğinden çalışmaz
mkdir -p ~/.claude/workflows
cp "$DIR"/workflows/*.js ~/.claude/workflows/ && echo "OK: workflows" >> $LOG || echo "FAIL: workflows" >> $LOG

# agentmemory (deneme): kalıcı ortak bellek. Yalnız ortamda AGENTMEMORY_URL tanımlıysa kurulur; sunucu Coolify'da
# (rohitg00/agentmemory, deploy/coolify), session'lar oraya yazar/okur. Bağlama otomatik enjeksiyon için
# AGENTMEMORY_INJECT_CONTEXT=true; yoksa bellek yalnız MCP araçlarıyla okunur.
if [ -n "$AGENTMEMORY_URL" ]; then
  claude plugin marketplace add rohitg00/agentmemory >> $LOG 2>&1 && claude plugin install agentmemory@agentmemory >> $LOG 2>&1 \
    && echo "OK: agentmemory ($AGENTMEMORY_URL)" >> $LOG || echo "FAIL: agentmemory" >> $LOG
else
  echo "SKIP: agentmemory (AGENTMEMORY_URL yok)" >> $LOG
fi

# Mod'lar: CLAUDE_CODE_PLUGIN_DIRS ile yüklenir (aşağıdaki settings bloğu)
mkdir -p ~/.claude/mods
cp -r "$DIR"/mods/wf-monitor ~/.claude/mods/ && echo "OK: mods" >> $LOG || echo "FAIL: mods" >> $LOG

# Ayarlar: Claude atfını kapat, varsayılan effort, mod dizini. Mevcut settings.json'ı (graphify hook'ları, plugin'ler) koruyarak birleştirir.
python3 - >> $LOG 2>&1 << 'PY' && echo "OK: settings" >> $LOG || echo "FAIL: settings" >> $LOG
import json, os
p = os.path.expanduser("~/.claude/settings.json")
s = json.load(open(p)) if os.path.exists(p) else {}
s["attribution"] = {"commit": "", "pr": ""}
s["effortLevel"] = "xhigh"
env = s.setdefault("env", {})
mod = os.path.expanduser("~/.claude/mods/wf-monitor")
dirs = [d for d in env.get("CLAUDE_CODE_PLUGIN_DIRS", "").split(":") if d]
if mod not in dirs:
    dirs.append(mod)
env["CLAUDE_CODE_PLUGIN_DIRS"] = ":".join(dirs)
json.dump(s, open(p, "w"), indent=2)
PY

# Kurallar: bizim bölüm zaten varsa tekrar eklemez
touch ~/.claude/CLAUDE.md
grep -q "<!-- claude-config -->" ~/.claude/CLAUDE.md || cat "$DIR/CLAUDE.md" >> ~/.claude/CLAUDE.md
echo "OK: CLAUDE.md" >> $LOG
