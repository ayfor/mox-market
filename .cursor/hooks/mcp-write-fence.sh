#!/bin/bash
# MCP write fence for coding agents in Cursor (beforeMCPExecution). See AGENTS.md "Hard limits".
# Maintained by Bitey. Its SHA-256 is pinned in .cursor/hooks.json: after ANY edit to this file,
# re-pin with `shasum -a 256 .cursor/hooks/mcp-write-fence.sh` or every MCP call fails closed.
#
# Cursor 3.21 contract (verified against its shipped agent-exec code, 2026-10-04):
#   stdin  = {tool_name, tool_input: <JSON *string*>, mcp_server_name, hook_event_name, workspace_roots, ...}
#   output = {"permission": "allow" | "deny", ...}. Cursor blocks MCP calls ONLY on "deny"; "ask" is
#            not enforced for MCP, so this script never emits it. Exit 2 also blocks; with failClosed,
#            any other non-zero exit, a timeout, or invalid output blocks too.
# Trust anchors live in .json files, which Cursor write-protects (.cursor/**/*.json):
#   story-pages.json   story ID -> Notion page ID, for every story Bitey has cut
#   active-story.json  {"story": "S#.#"}, committed by Bitey on each story branch; absent on main
#
# Policy:
#   Notion server: read tools allowed. notion-update-page allowed only as update_properties that sets
#                  Status alone, to In Progress | Testing | In Review | Blocked, on the page of the
#                  active story, from that story's branch. Every other Notion tool is denied.
#   Figma server:  read tools allowed; everything else denied. Recognized by server name OR by the
#                  official Figma plugin's tool names, so renaming the server key cannot bypass it.
#   Cursor built-in servers (cursor-ide-browser, cursor-app-control, cursor-origin-readonly,
#                  cursor-subscriptions): allowed.
#   Any other server: denied until Bitey adds it here. Unreadable payload: denied.

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
    agent_message:("Denied by the MCP write fence: " + $m + ". Coding agents may only set their own story Status in Notion and may not write to Figma (AGENTS.md, Hard limits). Do not edit the harness to get past this; stop, record what you wanted to change in the plan doc Session Log, and ask Bitey.")}'
  exit 0
}

tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)
server=$(printf '%s' "$input" | jq -r '.mcp_server_name // empty' 2>/dev/null)
args=$(printf '%s' "$input" | jq -c '(.tool_input // {}) | if type == "string" then (try fromjson catch null) else . end' 2>/dev/null)

[ -n "$tool" ] || deny "unreadable hook payload"

is_notion=0; is_figma=0
case "$server" in *[Nn]otion*) is_notion=1 ;; *[Ff]igma*) is_figma=1 ;; esac
case "$tool" in notion-*) is_notion=1 ;; esac
# The official Figma plugin's tools (Cursor 3.21, 2026-10-04), so a Figma server registered under
# any key still gets the Figma policy.
case "$tool" in
  add_code_connect_map|create_generative_plugin|create_new_file|create_shader|download_assets|\
export_video|generate_diagram|generate_figma_design|get_code_connect_map|get_code_connect_suggestions|\
get_context_for_code_connect|get_design_context|get_figjam|get_generative_plugin|get_libraries|\
get_metadata|get_motion_context|get_screenshot|get_shader|get_variable_defs|\
list_file_components_for_code_connect|list_file_shaders|list_generative_plugins|list_shaders|\
search_design_system|send_code_connect_mappings|update_generative_plugin|update_shader|upload_assets|\
use_figma|weave_cancel_tool_run|weave_find_model|weave_get_model_run_output|weave_get_tool_inputs|\
weave_get_tool_run_output|weave_list_tools|weave_run_model|weave_run_tool|weave_upload_asset|whoami)
    [ "$is_notion" = 1 ] || is_figma=1 ;;
esac

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
        and (((.allow_async // false) | type) == "boolean")
        and ((.properties | type) == "object")
        and ((.properties | keys) == ["Status"])
        and ((.properties.Status | type) == "string")
        and (.properties.Status as $s | ["In Progress", "Testing", "In Review", "Blocked"] | index($s) != null)
      ' 2>/dev/null)
      [ "$ok" = "true" ] || deny "notion-update-page is allowed only as update_properties setting Status alone (In Progress, Testing, In Review or Blocked)"
      branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
      sid=$(printf '%s' "$branch" | sed -n 's#^story/\(S[0-9][0-9]*\.[0-9][0-9]*\)-.*#\1#p')
      [ -n "$sid" ] || deny "Status updates are allowed only from a story/S#.#-slug branch (current: ${branch:-unknown})"
      active=$(jq -r '.story // empty' "$here/active-story.json" 2>/dev/null)
      [ "$active" = "$sid" ] || deny "branch is $sid but the active story recorded by Bitey is ${active:-none}"
      own=$(jq -r --arg s "$sid" '.[$s] // empty | ascii_downcase' "$here/story-pages.json" 2>/dev/null)
      printf '%s' "$own" | grep -qE '^[0-9a-f]{32}$' || deny "story $sid has no page mapping; ask Bitey to add it"
      pid=$(printf '%s' "$args" | jq -r '.page_id | select(type == "string") | ascii_downcase | gsub("-"; "") | select(test("^[0-9a-f]{32}$"))' 2>/dev/null)
      [ -n "$pid" ] || deny "page_id must be the bare Notion page ID (32 hex digits, dashes optional)"
      [ "$pid" = "$own" ] || deny "story $sid may update only its own page ($own), not $pid"
      allow ;;
    *)
      deny "$tool is not on the Notion read allowlist" ;;
  esac
fi

if [ "$is_figma" = 1 ]; then
  case "$tool" in
    get_*|list_*|search_design_system|whoami|download_assets|export_video|weave_list_tools|\
weave_get_tool_inputs|weave_get_tool_run_output|weave_find_model|weave_get_model_run_output)
      allow ;;
    *)
      deny "$tool is not on the Figma read allowlist" ;;
  esac
fi

case "$server" in
  cursor-ide-browser|cursor-app-control|cursor-origin-readonly|cursor-subscriptions) allow ;;
esac
deny "MCP server '${server:-unknown}' is not on the fence's allowlist"
