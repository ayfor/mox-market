#!/bin/bash
# MCP write fence for coding agents in Cursor (beforeMCPExecution). See AGENTS.md "Hard limits".
#
# Cursor 3.21 contract (verified against its shipped agent-exec code, 2026-10-04):
#   stdin  = {tool_name, tool_input: <JSON *string*>, mcp_server_name, hook_event_name, workspace_roots, ...}
#   output = {"permission": "allow" | "deny", ...}. Cursor blocks MCP calls ONLY on "deny";
#            "ask" is NOT enforced for MCP, so this script never emits it. Exit 2 also blocks.
#
# Policy:
#   Notion server: read tools allowed; notion-update-page allowed only as update_properties that sets
#                  Status alone, to In Progress | Testing | In Review | Blocked, on the page mapped (in
#                  story-pages.txt) to the story of the checked-out story/S#.#-slug branch. All else denied.
#   Figma server:  read tools allowed; everything else denied.
#   Other servers: allowed.
#   Unreadable payload: denied (fail closed).

here="$(cd "$(dirname "$0")" && pwd)"
input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  echo "mcp-write-fence: jq not found; blocking MCP call" >&2
  exit 2
fi

allow() { echo '{"permission":"allow"}'; exit 0; }
deny() {
  jq -nc --arg m "$1" '{permission:"deny",
    user_message:("mcp-write-fence: " + $m),
    agent_message:("Denied by the MCP write fence: " + $m + ". Coding agents may only set their own story Status in Notion and may not write to Figma (AGENTS.md, Hard limits). Record what you wanted to change in the plan doc Session Log.")}'
  exit 0
}

tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)
server=$(printf '%s' "$input" | jq -r '.mcp_server_name // empty' 2>/dev/null)
args=$(printf '%s' "$input" | jq -c '(.tool_input // {}) | if type == "string" then (try fromjson catch null) else . end' 2>/dev/null)

[ -n "$tool" ] || deny "unreadable hook payload"

is_notion=0; is_figma=0
case "$server" in *[Nn]otion*) is_notion=1 ;; *[Ff]igma*) is_figma=1 ;; esac
# Defence in depth: classify by tool name too, in case a server is registered under another name.
case "$tool" in notion-*) is_notion=1 ;; esac

if [ "$is_notion" = 1 ]; then
  case "$tool" in
    notion-fetch|notion-search|notion-ai-search|notion-get-*|notion-list-*|notion-query-*|notion-search-*|\
notion-read-session-event|notion-wait-session|notion-download-attachment|notion-download-skill|\
notion-check-mcp-next-steps|notion-show-advanced-analysis-next-steps)
      allow ;;
    notion-update-page)
      ok=$(printf '%s' "$args" | jq -r '
        type == "object"
        and .command == "update_properties"
        and ((keys - ["page_id", "command", "properties", "allow_async"]) | length == 0)
        and ((.properties | type) == "object")
        and ((.properties | keys) == ["Status"])
        and ((.properties.Status | type) == "string")
        and (.properties.Status as $s | ["In Progress", "Testing", "In Review", "Blocked"] | index($s) != null)
      ' 2>/dev/null)
      [ "$ok" = "true" ] || deny "notion-update-page is allowed only as update_properties setting Status alone (In Progress, Testing, In Review or Blocked)"
      branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
      sid=$(printf '%s' "$branch" | sed -n 's#^story/\(S[0-9][0-9]*\.[0-9][0-9]*\)-.*#\1#p')
      [ -n "$sid" ] || deny "Status updates are allowed only from a story/S#.#-slug branch (current: ${branch:-unknown})"
      own=$(awk -v s="$sid" '$1 == s { print tolower($2) }' "$here/story-pages.txt" 2>/dev/null | head -n 1)
      [ -n "$own" ] || deny "story $sid has no page mapping in .cursor/hooks/story-pages.txt"
      pid=$(printf '%s' "$args" | jq -r '.page_id // empty' | tr -d '-' | tr 'A-F' 'a-f' | grep -oE '[0-9a-f]{32}' | tail -n 1)
      [ "$pid" = "$own" ] || deny "story $sid may update only its own page ($own), not ${pid:-an unparsed page id}"
      allow ;;
    *)
      deny "$tool is not on the Notion read allowlist" ;;
  esac
fi

if [ "$is_figma" = 1 ]; then
  case "$tool" in
    get_*|list_*|search_design_system|whoami|download_assets|weave_list_tools|weave_get_tool_inputs|\
weave_get_tool_run_output|weave_find_model|weave_get_model_run_output)
      allow ;;
    *)
      deny "$tool is not on the Figma read allowlist" ;;
  esac
fi

allow
