#!/bin/zsh

PROJECT_DIR="${0:A:h}"
PREVIEW_FILE="$PROJECT_DIR/dist/index.html"

if [[ ! -f "$PREVIEW_FILE" ]]; then
  osascript -e 'display alert "Локальная версия не найдена" message "Сначала нужно собрать файл dist/index.html."'
  exit 1
fi

open -a "/Applications/Google Chrome.app" "$PREVIEW_FILE"
