#!/usr/bin/env bash
# Run on the VPS as root (or with sudo):
#   bash scripts/server-install.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/iran-analytics}"
SERVICE_NAME="iran-analytics"
ENV_FILE="/etc/iran-analytics.env"
REPO_URL="${REPO_URL:-https://github.com/yasinfrm/IranAnalytics.git}"

if [[ ! -d "$APP_DIR/.git" ]]; then
  mkdir -p "$(dirname "$APP_DIR")"
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
git fetch origin
git checkout main
git pull --ff-only origin main

mkdir -p data
npm install --omit=dev

if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  cat >"$ENV_FILE" <<'EOF'
ADMIN_USERNAME=admin
ADMIN_PASSWORD=CHANGE_ME
DATABASE_URL=sqlite:./data/iran-analytics.db
PORT=3000
COOKIE_SECURE=true
TRUST_PROXY=true
NODE_ENV=production
IA_FORCE_SQLJS=1
EOF
  echo "Created $ENV_FILE — set ADMIN_PASSWORD before relying on login."
fi

# Stop legacy nohup process if still running
pkill -f "node src/server.js" 2>/dev/null || true
sleep 1

install -m 0644 "$APP_DIR/deploy/iran-analytics.service" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
sleep 2
systemctl --no-pager --full status "$SERVICE_NAME" || true
curl -sS "http://127.0.0.1:3000/healthz" || true
echo
echo "Done. Panel: https://stats.homamigration.net/admin/"
