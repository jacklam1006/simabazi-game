#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): 机械化语法检查层，独立于任何agent的自我报告。
set -uo pipefail

input="$(cat)"
file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"

[ -z "$file_path" ] && exit 0
[ -f "$file_path" ] || exit 0

case "$file_path" in
  *.js)
    command -v node >/dev/null 2>&1 || exit 0
    if ! output="$(node --check "$file_path" 2>&1)"; then
      reason="node --check 语法检查失败: ${file_path}
${output}"
      jq -n --arg reason "$reason" '{decision:"block", reason:$reason, continue:true}'
      exit 0
    fi
    ;;
  *.py)
    command -v python3 >/dev/null 2>&1 || exit 0
    if ! output="$(python3 -m py_compile "$file_path" 2>&1)"; then
      reason="python3 -m py_compile 语法检查失败: ${file_path}
${output}"
      jq -n --arg reason "$reason" '{decision:"block", reason:$reason, continue:true}'
      exit 0
    fi
    ;;
  *)
    exit 0
    ;;
esac

exit 0
