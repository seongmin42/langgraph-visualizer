#!/usr/bin/env bash
# Tailscale Funnel 로 이 앱을 https://<기기>.<tailnet>.ts.net/langgraph/ 에 공개한다.
#
# 같은 기기의 다른 앱(예: 5173 포트, Funnel 의 "/" 경로)은 건드리지 않는다.
#  - 기본(MODE=dir): tailscaled 가 빌드된 정적 파일을 직접 서빙한다. 별도 서버·포트가 필요 없다.
#  - MODE=proxy: 로컬 정적 서버(vite preview, 기본 4173 포트)를 띄우고 그쪽으로 프록시한다.
#    (tailscaled 가 파일 폴더를 읽을 수 없는 환경, 예: macOS App Store 버전에서 사용)
#
# 사용법:  ./scripts/deploy-funnel.sh            # https://<host>/langgraph/
#          MOUNT=/lg ./scripts/deploy-funnel.sh   # 다른 경로로
#          MODE=proxy PORT=4180 ./scripts/deploy-funnel.sh
# 내리기:  tailscale funnel --set-path /langgraph off
set -euo pipefail

MOUNT="${MOUNT:-/langgraph}"
MODE="${MODE:-dir}"
PORT="${PORT:-4173}"
SITE_DIR="${SITE_DIR:-$HOME/.local/share/langgraph-visualizer/site}"

cd "$(dirname "$0")/.."

command -v tailscale >/dev/null || { echo "tailscale CLI 가 필요합니다: https://tailscale.com/download" >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js 가 필요합니다" >&2; exit 1; }
if [ "$MODE" = proxy ] && [ "$PORT" = 5173 ]; then
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

echo "== Funnel 등록: $MOUNT"
if [ "$MODE" = dir ]; then
  tailscale funnel --bg --set-path "$MOUNT" "$SITE_DIR"
else
  LOG="$(dirname "$SITE_DIR")/preview.log"
  nohup npx vite preview --host 127.0.0.1 --port "$PORT" --strictPort --outDir "$SITE_DIR" >"$LOG" 2>&1 &
  echo "로컬 서버 pid $! (로그: $LOG) — 재부팅 후에는 이 스크립트를 다시 실행하거나 서비스로 등록하세요"
  tailscale funnel --bg --set-path "$MOUNT" "http://127.0.0.1:$PORT"
fi

tailscale funnel status

HOST="$(tailscale status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,"")))')"
URL="https://${HOST}${MOUNT%/}/"
echo
echo "공개 주소: $URL"
if command -v curl >/dev/null; then
  code="$(curl -sS -o /dev/null -w '%{http_code}' "$URL" || true)"
  echo "응답 코드: ${code:-없음} (처음에는 인증서 발급 때문에 1분 정도 걸릴 수 있습니다)"
fi
