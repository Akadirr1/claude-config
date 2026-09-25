#!/bin/bash
# Claude Code cloud ortam kurulumu. Setup script'ten çağrılır.
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG=/tmp/setup.log

# Plugin'ler
claude plugin marketplace add anthropics/claude-plugins-official >> $LOG 2>&1 || echo "FAIL: official marketplace" >> $LOG
claude plugin marketplace add DietrichGebert/ponytail >> $LOG 2>&1 || echo "FAIL: ponytail marketplace" >> $LOG
claude plugin install ponytail@ponytail >> $LOG 2>&1 || echo "FAIL: ponytail" >> $LOG
claude plugin marketplace add obra/superpowers-marketplace >> $LOG 2>&1 || echo "FAIL: superpowers marketplace" >> $LOG
claude plugin install superpowers@superpowers-marketplace >> $LOG 2>&1 || echo "FAIL: superpowers" >> $LOG

# Graphify (kendi bölümünü ~/.claude/CLAUDE.md'ye yazar)
pip install graphifyy >> $LOG 2>&1 && graphify install >> $LOG 2>&1 || echo "FAIL: graphify" >> $LOG

# Agent'lar
mkdir -p ~/.claude/agents
cp "$DIR"/agents/*.md ~/.claude/agents/ && echo "OK: agents" >> $LOG || echo "FAIL: agents" >> $LOG

# Kurallar: bizim bölüm zaten varsa tekrar eklemez
touch ~/.claude/CLAUDE.md
grep -q "<!-- claude-config -->" ~/.claude/CLAUDE.md || cat "$DIR/CLAUDE.md" >> ~/.claude/CLAUDE.md
echo "OK: CLAUDE.md" >> $LOG
