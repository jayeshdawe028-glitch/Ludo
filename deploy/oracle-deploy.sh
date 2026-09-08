#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/ludocord}"
REPO_URL="${REPO_URL:-https://github.com/jayeshdawe028-glitch/Ludo.git}"
DOMAIN="${PUBLIC_DOMAIN:-92-4-81-45.sslip.io}"
PUBLIC_URL="${PUBLIC_URL:-https://$DOMAIN}"

say() { printf '\n==> %s\n' "$*"; }

if ! command -v git >/dev/null 2>&1; then
  say "Installing Git"
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git
fi

if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
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
  if [ ! -t 0 ] && [ ! -r /dev/tty ]; then
    echo "No interactive terminal is available. Run this script from an SSH terminal, or create $APP_DIR/.env first." >&2
    exit 1
  fi
  say "Creating production environment"
  read -rp "Discord Application/Client ID: " DISCORD_APPLICATION_ID </dev/tty
  read -rsp "Discord Client Secret: " DISCORD_CLIENT_SECRET </dev/tty; echo
  read -rsp "Discord Bot Token: " DISCORD_BOT_TOKEN </dev/tty; echo
  read -rp "Bot invite URL (press Enter for placeholder): " BOT_INVITE_URL </dev/tty
  read -rp "Community URL (press Enter for placeholder): " COMMUNITY_URL </dev/tty

  cat > .env <<EOF
DISCORD_APPLICATION_ID=$DISCORD_APPLICATION_ID
DISCORD_CLIENT_ID=$DISCORD_APPLICATION_ID
DISCORD_CLIENT_SECRET=$DISCORD_CLIENT_SECRET
DISCORD_BOT_TOKEN=$DISCORD_BOT_TOKEN
PUBLIC_DOMAIN=$DOMAIN
PUBLIC_URL=$PUBLIC_URL
BOT_INVITE_URL=${BOT_INVITE_URL:-https://discord.com/oauth2/authorize?client_id=$DISCORD_APPLICATION_ID&scope=bot%20applications.commands}
COMMUNITY_URL=${COMMUNITY_URL:-https://discord.com/}
EOF
  chmod 600 .env
fi

say "Ensuring host firewall allows HTTPS"
if command -v iptables >/dev/null 2>&1; then
  sudo iptables -C INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp -m multiport --dports 80,443 -j ACCEPT
  if command -v netfilter-persistent >/dev/null 2>&1; then sudo netfilter-persistent save || true; fi
fi

if command -v caddy >/dev/null 2>&1; then
  say "Configuring host Caddy"
  sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:3000
    encode gzip
}
EOF
  sudo caddy validate --config /etc/caddy/Caddyfile
  sudo systemctl enable --now caddy
  sudo systemctl reload caddy || sudo systemctl restart caddy
fi

say "Building and starting LudoCord"
# Start only the app and bot. Host Caddy already owns ports 80/443.
sudo docker compose up -d --build ludocord bot

say "Deployment status"
sudo docker compose ps
say "Health check"
curl -fsS --max-time 15 "$PUBLIC_URL/health"

say "Activity build check"
sudo docker exec "$(sudo docker compose ps -q ludocord)" test -f /app/apps/activity/dist/index.html

cat <<EOF

Deployment is running.
URL: $PUBLIC_URL
The Activity is built with Vite before the server starts, so the source /src/main.tsx page is not served in production.
Host Caddy is used for HTTPS; the Docker Caddy service was intentionally not started.
EOF
