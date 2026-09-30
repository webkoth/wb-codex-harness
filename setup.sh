#!/usr/bin/env bash
# Установка за один запуск: зависимости, сборка MCP, конфиг Codex с путями этого мака, проверка.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then echo "Нет Node.js. Установите Node 20+ (https://nodejs.org) и повторите."; exit 1; fi
echo "Node: $NODE ($(node -v))"

npm install --no-fund --no-audit
npm run build

[ -f .env ] || { cp .env.example .env; echo "Создан .env — вставьте токен WB в строку WB_API_TOKEN="; }

mkdir -p .codex data drafts reports
sed -e "s#__NODE__#${NODE}#g" -e "s#__ROOT__#${ROOT}#g" codex.config.template.toml > .codex/config.toml
echo "Записан .codex/config.toml"

if command -v codex >/dev/null 2>&1; then
  echo
  echo "Codex читает .codex/config.toml только в доверенном проекте."
  echo "При первом запуске 'codex' в этой папке ответьте, что доверяете проекту."
else
  echo "Codex CLI не найден: npm i -g @openai/codex"
fi

echo
npx tsx scripts/check.ts || true
