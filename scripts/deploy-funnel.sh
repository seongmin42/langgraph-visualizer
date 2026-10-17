#!/usr/bin/env bash
# Tailscale Funnel 로 이 앱을 https://<기기>.<tailnet>.ts.net/langgraph/ 에 공개한다.
#
# 같은 기기의 다른 앱(예: 5173 포트, Funnel 의 "/" 경로)은 건드리지 않는다.
#  - MODE=auto (기본): 먼저 tailscaled 가 폴더를 직접 서빙(dir)해 보고, 403 등으로 실패하면 proxy 로 전환
#  - MODE=dir  : tailscaled 가 빌드 폴더를 직접 서빙. 포트가 필요 없지만, tailscaled 가 폴더를 읽을 수
#                있어야 한다 (macOS 앱 샌드박스, SELinux, snap 환경에서는 403 Forbidden 이 난다)
#  - MODE=proxy: 내 계정으로 도는 작은 정적 서버(기본 4173 포트)를 띄우고 Funnel 이 그쪽으로 프록시.
#                Linux 는 systemd 사용자 서비스, macOS 는 LaunchAgent 로 등록해 재부팅 후에도 유지
#
# 사용법:  ./scripts/deploy-funnel.sh
#          MODE=proxy PORT=4180 ./scripts/deploy-funnel.sh
# 내리기:  ./scripts/deploy-funnel.sh down
set -euo pipefail

MOUNT="${MOUNT:-/langgraph}"
MODE="${MODE:-auto}"
PORT="${PORT:-4173}"
DATA_DIR="${DATA_DIR:-$HOME/.local/share/langgraph-visualizer}"
SITE_DIR="$DATA_DIR/site"
NAME="langgraph-visualizer"

cd "$(dirname "$0")/.."
REPO="$(pwd)"

command -v tailscale >/dev/null || { echo "tailscale CLI 가 필요합니다: https://tailscale.com/download" >&2; exit 1; }
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "Node.js 가 필요합니다" >&2; exit 1; }

HOST="$(tailscale status --json | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,"")))')"
URL="https://${HOST}${MOUNT%/}/"

http_code() {
  local c
  c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1" 2>/dev/null)" || true
  echo "${c:-000}"
}

stop_local_server() {
  if command -v systemctl >/dev/null && systemctl --user list-unit-files "$NAME.service" >/dev/null 2>&1; then
    systemctl --user disable --now "$NAME.service" >/dev/null 2>&1 || true
  fi
  if [ "$(uname)" = Darwin ]; then
    launchctl bootout "gui/$(id -u)/com.$NAME" >/dev/null 2>&1 || true
  fi
  if [ -f "$DATA_DIR/server.pid" ]; then
    kill "$(cat "$DATA_DIR/server.pid")" >/dev/null 2>&1 || true
    rm -f "$DATA_DIR/server.pid"
  fi
}

if [ "${1:-}" = down ]; then
  tailscale funnel --set-path "$MOUNT" off || true
  stop_local_server
  echo "내렸습니다: $URL"
  exit 0
fi

if [ "$PORT" = 5173 ]; then
  echo "5173 은 다른 앱이 쓰는 포트입니다. PORT 를 바꿔 주세요." >&2
  exit 1
fi

echo "== 현재 serve/funnel 설정 (다른 경로의 설정은 그대로 유지됩니다)"
tailscale funnel status || true

echo "== 빌드"
npm ci
npm run build

# 빌드 폴더를 고정 위치로 복사해 두면, 저장소에서 다시 빌드하거나 지워도 공개 중인 사이트가 깨지지 않는다.
mkdir -p "$SITE_DIR"
find "$SITE_DIR" -mindepth 1 -delete
cp -R dist/. "$SITE_DIR"/
cp scripts/serve-static.mjs "$DATA_DIR/serve-static.mjs"

deploy_dir() {
  echo "== Funnel 등록 (dir): $MOUNT → $SITE_DIR"
  tailscale funnel --set-path "$MOUNT" off >/dev/null 2>&1 || true
  tailscale funnel --bg --set-path "$MOUNT" "$SITE_DIR"
}

start_local_server() {
  stop_local_server
  if "$NODE" -e "require('net').connect($PORT,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"; then
    echo "포트 $PORT 를 이미 다른 프로그램이 쓰고 있습니다. PORT=다른번호 로 다시 실행해 주세요." >&2
    exit 1
  fi
  local cmd=("$NODE" "$DATA_DIR/serve-static.mjs" "$SITE_DIR" "$PORT" 127.0.0.1)
  if [ "$(uname)" = Linux ] && command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
    mkdir -p "$HOME/.config/systemd/user"
    cat >"$HOME/.config/systemd/user/$NAME.service" <<EOF
[Unit]
Description=LangGraph Visualizer static server (for Tailscale Funnel)

[Service]
ExecStart=${cmd[*]}
Restart=on-failure

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now "$NAME.service"
    echo "systemd 사용자 서비스로 등록했습니다 ($NAME.service)."
    echo "로그아웃 상태에서도 유지하려면 한 번만: sudo loginctl enable-linger $USER"
  elif [ "$(uname)" = Darwin ]; then
    local plist="$HOME/Library/LaunchAgents/com.$NAME.plist"
    mkdir -p "$(dirname "$plist")"
    cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.$NAME</string>
  <key>ProgramArguments</key><array>
    <string>${cmd[0]}</string><string>${cmd[1]}</string><string>${cmd[2]}</string><string>${cmd[3]}</string><string>${cmd[4]}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$DATA_DIR/server.log</string>
</dict></plist>
EOF
    launchctl bootstrap "gui/$(id -u)" "$plist"
    echo "LaunchAgent 로 등록했습니다 (com.$NAME)."
  else
    nohup "${cmd[@]}" >"$DATA_DIR/server.log" 2>&1 &
    echo $! >"$DATA_DIR/server.pid"
    echo "백그라운드로 실행했습니다 (pid $(cat "$DATA_DIR/server.pid")). 재부팅 후에는 다시 실행해야 합니다."
  fi
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ "$(http_code "http://127.0.0.1:$PORT/")" = 200 ] && return 0
    sleep 0.5
  done
  echo "로컬 서버가 응답하지 않습니다. 로그: $DATA_DIR/server.log" >&2
  exit 1
}

deploy_proxy() {
  echo "== 로컬 정적 서버: http://127.0.0.1:$PORT/"
  start_local_server
  echo "== Funnel 등록 (proxy): $MOUNT → http://127.0.0.1:$PORT"
  tailscale funnel --set-path "$MOUNT" off >/dev/null 2>&1 || true
  tailscale funnel --bg --set-path "$MOUNT" "http://127.0.0.1:$PORT"
}

case "$MODE" in
  dir) deploy_dir ;;
  proxy) deploy_proxy ;;
  auto)
    stop_local_server
    deploy_dir
    sleep 2
    code="$(http_code "$URL")"
    if [ "$code" != 200 ]; then
      echo "tailscaled 가 폴더를 직접 서빙하지 못했습니다 (HTTP $code). proxy 방식으로 전환합니다."
      deploy_proxy
    fi
    ;;
  *) echo "MODE 는 auto | dir | proxy 중 하나여야 합니다" >&2; exit 1 ;;
esac

echo
tailscale funnel status
echo
code="$(http_code "$URL")"
echo "공개 주소: $URL  (HTTP $code)"
[ "$code" = 200 ] || echo "처음에는 인증서 발급 때문에 1분 정도 걸릴 수 있습니다. 잠시 뒤 브라우저로 다시 열어 보세요."
