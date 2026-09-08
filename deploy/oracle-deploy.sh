#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/ludocord}"
REPO_URL="${REPO_URL:-https://github.com/jayeshdawe028-glitch/Ludo.git}"

say() { printf '\n==> %s\n' "$*"; }

if ! command -v git >/dev/null 2>&1; then
  say "Installing Git"
  sudo apt-get update
  sudo apt-get install -y git
fi

if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo systemctl enable --now docker
fi

if [ ! -d "$APP_DIR/.git" ]; then
  say "Cloning LudoCord"
  git clone "$REPO_URL" "$APP_DIR"
else
  say "Updating LudoCord"
  git -C "$APP_DIR" fetch origin main
  git -C "$APP_DIR" reset --hard origin/main
fi

cd "$APP_DIR"

if [ ! -f .env ]; then
  say "Creating production environment"
  read -rp "Discord Application/Client ID: " DISCORD_APPLICATION_ID
  read -rsp "Discord Client Secret: " DISCORD_CLIENT_SECRET; echo
  read -rsp "Discord Bot Token: " DISCORD_BOT_TOKEN; echo
  read -rp "Bot invite URL (press Enter for placeholder): " BOT_INVITE_URL
  read -rp "Community URL (press Enter for placeholder): " COMMUNITY_URL

  cat > .env <<EOF
DISCORD_APPLICATION_ID=$DISCORD_APPLICATION_ID
DISCORD_CLIENT_ID=$DISCORD_APPLICATION_ID
DISCORD_CLIENT_SECRET=$DISCORD_CLIENT_SECRET
DISCORD_BOT_TOKEN=$DISCORD_BOT_TOKEN
PUBLIC_DOMAIN=92-4-81-45.sslip.io
PUBLIC_URL=https://92-4-81-45.sslip.io
BOT_INVITE_URL=${BOT_INVITE_URL:-https://discord.com/oauth2/authorize?client_id=$DISCORD_APPLICATION_ID&scope=bot%20applications.commands}
COMMUNITY_URL=${COMMUNITY_URL:-https://discord.com/}
EOF
  chmod 600 .env
fi

say "Building and starting the app"
sudo docker compose up -d --build ludocord bot

say "Deployment status"
sudo docker compose ps
say "Health check"
curl -fsS https://92-4-81-45.sslip.io/health || true

cat <<'EOF'

Deployment is running.
Host Caddy is intentionally left in place because it already owns ports 80/443.
The Docker compose Caddy service is not started by this script.
EOF
