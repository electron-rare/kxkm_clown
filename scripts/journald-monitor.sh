#!/usr/bin/env bash
# journald-monitor.sh — TUI-style systemd journal monitor for KXKM services
# Usage: bash scripts/journald-monitor.sh [--service <name>] [--lines <n>] [--watch]
#
# Shows status and last N journal lines for kxkm-tts and kxkm-lightrag user services.

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SERVICES=(kxkm-tts kxkm-lightrag)
DEFAULT_LINES=20

# ---------------------------------------------------------------------------
# Colors & symbols
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

DOT_OK="●"       # green  — active/running
DOT_FAIL="●"     # red    — failed
DOT_WARN="●"     # yellow — activating/deactivating
DOT_DEAD="○"     # dim    — inactive/dead

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
LINES=$DEFAULT_LINES
WATCH=false
FILTER_SERVICE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --lines|-n) LINES="$2"; shift 2 ;;
    --service|-s) FILTER_SERVICE="$2"; shift 2 ;;
    --watch|-w) WATCH=true; shift ;;
    --help|-h)
      echo "Usage: $0 [--service <name>] [--lines <n>] [--watch]"
      echo "  --service, -s   Only show a specific service"
      echo "  --lines,   -n   Number of journal lines to show (default: $DEFAULT_LINES)"
      echo "  --watch,   -w   Refresh every 5 seconds"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
now() { date '+%Y-%m-%d %H:%M:%S'; }

status_dot() {
  local state="$1"
  case "$state" in
    active)       printf "${GREEN}${DOT_OK}${RESET}"  ;;
    failed)       printf "${RED}${DOT_FAIL}${RESET}"  ;;
    activating|deactivating) printf "${YELLOW}${DOT_WARN}${RESET}" ;;
    *)            printf "${DIM}${DOT_DEAD}${RESET}"  ;;
  esac
}

box_header() {
  local title="$1" width=72
  local pad=$(( (width - ${#title} - 2) / 2 ))
  printf "${CYAN}%s${RESET}\n" "$(printf '─%.0s' $(seq 1 $width))"
  printf "${CYAN}│${RESET} ${BOLD}${WHITE}%*s%s%*s${RESET} ${CYAN}│${RESET}\n" \
    $pad "" "$title" $pad ""
  printf "${CYAN}%s${RESET}\n" "$(printf '─%.0s' $(seq 1 $width))"
}

service_header() {
  local svc="$1" state="$2" sub="$3" pid="$4" mem="$5" uptime="$6"
  printf "\n  $(status_dot "$state")  ${BOLD}${WHITE}%-30s${RESET}  " "$svc"
  case "$state" in
    active)  printf "${GREEN}%-12s${RESET}" "$state ($sub)" ;;
    failed)  printf "${RED}%-12s${RESET}"   "$state" ;;
    *)       printf "${YELLOW}%-12s${RESET}" "$state" ;;
  esac
  [[ -n "$pid"    ]] && printf "  PID: ${DIM}%s${RESET}" "$pid"
  [[ -n "$mem"    ]] && printf "  MEM: ${DIM}%s${RESET}" "$mem"
  [[ -n "$uptime" ]] && printf "  UP: ${DIM}%s${RESET}" "$uptime"
  printf "\n"
}

get_service_info() {
  local svc="$1"
  # systemctl --user show returns key=value pairs
  local info
  if info=$(systemctl --user show "$svc" \
      --property=ActiveState,SubState,MainPID,MemoryCurrent,ActiveEnterTimestamp \
      2>/dev/null); then
    echo "$info"
  else
    echo "ActiveState=unknown"
  fi
}

parse_prop() {
  local info="$1" key="$2"
  echo "$info" | grep "^${key}=" | cut -d= -f2-
}

humanize_mem() {
  local bytes="$1"
  if [[ -z "$bytes" || "$bytes" == "18446744073709551615" || "$bytes" == "0" ]]; then
    echo ""
    return
  fi
  if   (( bytes >= 1073741824 )); then printf "%.1fGB" "$(echo "scale=1; $bytes/1073741824" | bc)"
  elif (( bytes >= 1048576 ));    then printf "%.1fMB" "$(echo "scale=1; $bytes/1048576" | bc)"
  elif (( bytes >= 1024 ));       then printf "%.0fKB" "$(echo "scale=0; $bytes/1024" | bc)"
  else echo "${bytes}B"
  fi
}

humanize_uptime() {
  local ts="$1"
  [[ -z "$ts" || "$ts" == "n/a" ]] && echo "" && return
  local epoch now diff
  epoch=$(date -d "$ts" +%s 2>/dev/null) || { echo ""; return; }
  now=$(date +%s)
  diff=$(( now - epoch ))
  if   (( diff >= 86400 )); then printf "%dd%dh" $(( diff/86400 )) $(( (diff%86400)/3600 ))
  elif (( diff >= 3600  )); then printf "%dh%dm"  $(( diff/3600 )) $(( (diff%3600)/60 ))
  elif (( diff >= 60    )); then printf "%dm%ds"  $(( diff/60 )) $(( diff%60 ))
  else printf "%ds" "$diff"
  fi
}

print_journal() {
  local svc="$1" n="$2"
  printf "\n  ${DIM}── Journal: last %d lines ──────────────────────────────────${RESET}\n" "$n"
  if ! journalctl --user -u "$svc" -n "$n" --no-pager --output=short-iso 2>/dev/null \
      | sed 's/^/    /'; then
    printf "    ${YELLOW}(no journal entries or journald not available)${RESET}\n"
  fi
}

# ---------------------------------------------------------------------------
# Summary exit codes tracker
# ---------------------------------------------------------------------------
FAILED_SERVICES=()

check_services() {
  FAILED_SERVICES=()
  local services_to_check=("${SERVICES[@]}")
  [[ -n "$FILTER_SERVICE" ]] && services_to_check=("$FILTER_SERVICE")

  box_header "KXKM Systemd Monitor  —  $(now)"

  for svc in "${services_to_check[@]}"; do
    local info state sub pid mem_raw mem uptime_ts uptime

    info=$(get_service_info "$svc")
    state=$(parse_prop "$info" "ActiveState")
    sub=$(parse_prop "$info" "SubState")
    pid=$(parse_prop "$info" "MainPID")
    mem_raw=$(parse_prop "$info" "MemoryCurrent")
    uptime_ts=$(parse_prop "$info" "ActiveEnterTimestamp")

    [[ "$pid" == "0" ]] && pid=""
    mem=$(humanize_mem "$mem_raw")
    uptime=$(humanize_uptime "$uptime_ts")

    service_header "$svc.service" "$state" "$sub" "$pid" "$mem" "$uptime"

    [[ "$state" == "failed" ]] && FAILED_SERVICES+=("$svc")

    print_journal "$svc" "$LINES"
    printf "\n"
  done

  # Summary line
  printf "${CYAN}%s${RESET}\n" "$(printf '─%.0s' $(seq 1 72))"
  if [[ ${#FAILED_SERVICES[@]} -gt 0 ]]; then
    printf "  ${RED}${DOT_FAIL} ALERT: failed services: %s${RESET}\n" \
      "$(IFS=', '; echo "${FAILED_SERVICES[*]}")"
    printf "  ${DIM}Run: systemctl --user restart <service>${RESET}\n"
  else
    printf "  ${GREEN}${DOT_OK} All monitored services OK${RESET}\n"
  fi
  printf "${CYAN}%s${RESET}\n" "$(printf '─%.0s' $(seq 1 72))"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if $WATCH; then
  while true; do
    clear
    check_services
    printf "\n  ${DIM}Refreshing every 5s — Ctrl+C to exit${RESET}\n"
    sleep 5
  done
else
  check_services
  # Exit 1 if any service failed
  [[ ${#FAILED_SERVICES[@]} -gt 0 ]] && exit 1
  exit 0
fi
