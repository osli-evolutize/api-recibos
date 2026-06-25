#!/bin/bash
set -e

APP_DIR="/opt/sistema/apps/api-recibos"
APP_NAME="api-recibos"

cd "$APP_DIR"
git pull
npm install
pm2 restart "$APP_NAME" --update-env
curl -fsS http://127.0.0.1:3003/api/saude
echo

