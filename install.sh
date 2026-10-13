#!/bin/bash
# Claude Code cloud ortam kurulumu. Setup script'ten çağrılır.
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG=/tmp/setup.log

# Plugin'ler
claude plugin marketplace add DietrichGebert/ponytail >> $LOG 2>&1 || echo "FAIL: ponytail marketplace" >> $LOG
claude plugin install ponytail@ponytail >> $LOG 2>&1 || echo "FAIL: ponytail" >> $LOG

# Archify (diyagram skill'i, ~/.claude/skills/ altına)
npx -y skills add tt-a1i/archify --skill archify --agent claude-code --global --copy --yes >> $LOG 2>&1 || echo "FAIL: archify" >> $LOG

# Agent'lar
mkdir -p ~/.claude/agents
cp "$DIR"/agents/*.md ~/.claude/agents/ && echo "OK: agents" >> $LOG || echo "FAIL: agents" >> $LOG

# Ayarlar: Claude atfını kapat, varsayılan effort. Mevcut settings.json'ı koruyarak birleştirir.
python3 - >> $LOG 2>&1 << 'PY' && echo "OK: settings" >> $LOG || echo "FAIL: settings" >> $LOG
import json, os
p = os.path.expanduser("~/.claude/settings.json")
s = json.load(open(p)) if os.path.exists(p) else {}
s["attribution"] = {"commit": "", "pr": ""}
s["effortLevel"] = "high"
json.dump(s, open(p, "w"), indent=2)
PY

# Kurallar: bizim bölüm zaten varsa tekrar eklemez
touch ~/.claude/CLAUDE.md
grep -q "<!-- claude-config -->" ~/.claude/CLAUDE.md || cat "$DIR/CLAUDE.md" >> ~/.claude/CLAUDE.md
echo "OK: CLAUDE.md" >> $LOG
