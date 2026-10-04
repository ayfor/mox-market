#!/bin/bash
# Notion/Figma write fence for coding agents (see AGENTS.md "Hard limits").
# Allows: all reads; notion-update-page when it only sets the `Status` property.
# Denies: every other Notion write tool and every Figma write tool.
# Unknown payload shape -> ask the user rather than guess.
input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  echo '{"permission":"ask","user_message":"mcp-write-fence: jq not found, cannot inspect this MCP call.","agent_message":"The MCP write fence could not run (jq missing). Ask Josh before any Notion or Figma write."}'
  exit 0
fi

tool=$(printf '%s' "$input" | jq -r '.tool_name // .toolName // .tool // .name // empty')
args=$(printf '%s' "$input" | jq -c '.tool_input // .arguments // .input // .params // .args // {}')

if [ -z "$tool" ]; then
  echo '{"permission":"ask","user_message":"mcp-write-fence: could not read the tool name from the hook payload.","agent_message":"MCP fence could not identify the tool. Ask Josh before proceeding if this is a write."}'
  exit 0
fi

deny() {
  printf '{"permission":"deny","user_message":"Blocked by mcp-write-fence: %s is a write tool outside this agent'"'"'s allowance (AGENTS.md: Notion = own story Status only; Figma = read-only).","agent_message":"Denied: %s. Coding agents may only update their own story'"'"'s Status in Notion and may not write to Figma. Record what you wanted to change in the plan doc Session Log instead."}\n' "$tool" "$tool"
  exit 0
}

case "$tool" in
  *notion-update-page*)
    cmd=$(printf '%s' "$args" | jq -r '.command // empty')
    keys=$(printf '%s' "$args" | jq -r '(.properties // {}) | keys | join(",")')
    if [ "$cmd" = "update_properties" ] && [ "$keys" = "Status" ]; then
      echo '{"permission":"allow"}'
      exit 0
    fi
    if [ -z "$cmd" ]; then
      echo '{"permission":"ask","user_message":"mcp-write-fence: notion-update-page with an unrecognised payload shape; review before allowing.","agent_message":"notion-update-page is allowed only for update_properties with the single key Status."}'
      exit 0
    fi
    deny ;;
  *notion-create-*|*notion-duplicate-page*|*notion-move-pages*|*notion-update-data-source*|*notion-update-folder*|*notion-update-view*|*notion-upload-skill*|*notion-convert-page-to-skill*|*notion-spawn-session*|*notion-stop-session*|*notion-send-message-to-session*|*notion-delete*)
    deny ;;
  *use_figma*|*generate_figma_design*|*generate_diagram*|*create_new_file*|*create_shader*|*update_shader*|*create_generative_plugin*|*update_generative_plugin*|*upload_assets*|*add_code_connect_map*|*send_code_connect_mappings*|*weave_run_tool*|*weave_upload_asset*|*weave_run_model*|*export_video*)
    deny ;;
esac

echo '{"permission":"allow"}'
exit 0
