#!/bin/sh
# Shared patterns: commits must never be authored, committed, or co-authored by Anthropic/Claude.
BLOCKED_IDENT='anthropic|claude'
BLOCKED_MSG='co-authored-by:.*(anthropic|claude)|generated with \[?claude code|noreply@anthropic\.com'
