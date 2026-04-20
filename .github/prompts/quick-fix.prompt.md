---
description: Quick fix — minimal ceremony for small changes
agent: DevAgent
argument-hint: Describe what needs to be fixed
tools:
  - read_file
  - replace_string_in_file
  - multi_replace_string_in_file
  - create_file
  - grep_search
  - file_search
  - list_dir
  - run_in_terminal
  - get_terminal_output
  - get_errors
---

This is a quick fix. No planning, no exploration phase, no questions unless truly blocked.

1. Understand what needs to change from the user's description
2. Find the relevant file(s)
3. Make the change
4. Verify: read the file back, check for errors with `get_errors`, run tests if they exist
5. Report what you changed — one sentence is enough
