#!/bin/sh
# Claude Code status line
# Colors: green when context mostly empty, yellow mid, red when nearly full

input=$(cat)

# --- Extract data ---
cwd=$(echo "$input"      | jq -r '.workspace.current_dir // .cwd // empty')
model=$(echo "$input"    | jq -r '.model.display_name // empty')
used=$(echo "$input"     | jq -r '.context_window.used_percentage // empty')
ctx_size=$(echo "$input" | jq -r '.context_window.context_window_size // empty')
# --- Git info (no lock acquisition) ---
branch=$(git --no-optional-locks symbolic-ref --short HEAD 2>/dev/null)
dirty=$(git --no-optional-locks status --porcelain 2>/dev/null)

# --- ANSI colors ---
RESET='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[36m'
YELLOW='\033[33m'
MAGENTA='\033[35m'
RED='\033[31m'
GREEN='\033[32m'
WHITE='\033[37m'

# --- Context token count ---
if [ -n "$used" ] && [ "$used" != "null" ] && [ -n "$ctx_size" ] && [ "$ctx_size" != "null" ]; then
  used_int=$(printf '%.0f' "$used")

  # Effective limit excludes autocompact buffer (~17%)
  total_k=$(( ctx_size * 83 / 100 / 1000 ))
  used_k=$(( (ctx_size * used_int / 100 + 500) / 1000 ))
  if [ "$used_k" -gt "$total_k" ]; then used_k=$total_k; fi

  # Color based on effective usage (used_k / total_k)
  eff_pct=$(( used_k * 100 / total_k ))
  if [ "$eff_pct" -lt 50 ]; then
    cc=108   # sage green
  elif [ "$eff_pct" -lt 70 ]; then
    cc=180   # tan
  elif [ "$eff_pct" -lt 85 ]; then
    cc=216   # peach
  elif [ "$eff_pct" -lt 93 ]; then
    cc=174   # coral
  else
    cc=167   # muted red
  fi
  CTX_COLOR="\033[38;5;${cc}m"

  printf "${CTX_COLOR}${used_k}k/${total_k}k${RESET}  "
fi

# --- Git branch + dirty indicator ---
if [ -n "$branch" ]; then
  if [ -n "$dirty" ]; then
    printf "${YELLOW}(%s *)${RESET}" "$branch"
  else
    printf "${WHITE}(%s)${RESET}" "$branch"
  fi
  printf "  "
fi

# --- Model ---
if [ -n "$model" ]; then
  printf "${MAGENTA}${DIM}%s${RESET}" "$model"
fi

printf '\n'
