# bootstrap-config.sh — Repo-specific 1Password mappings
#
# INJECT_FILES (preferred): "template_path:output_path"
#   Templates contain op:// references resolved by `op inject`.
#   Templates are committed to git; output files are gitignored.
#
# BOOTSTRAP_FILES (legacy): "1password_item_id:relative_file_path"
#   Falls back to reading notesPlain from a Secure Note.

INJECT_FILES=(
  ".env.tpl:.env.local"
  "firebase-config.local.tpl:firebase-config.local.js"
)

# Legacy fallback (kept for backward compatibility; INJECT_FILES takes precedence)
BOOTSTRAP_FILES=()
