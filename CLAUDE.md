# Working in Citydriver

This directory is an independent city driving game, versioned separately from the original project. Make changes only inside this workspace. Never modify or push to the original game, its backup, or its GitHub repository.

The game has one procedural city that extends north, south, east, and west. Keep all intersections and bridges driveable, detail buildings on every side, and use Citydriver-specific storage and application identities. No hosting or automatic update destination is configured.

## Attribution

Claude must never appear as a contributor, co-author or co-contributor on this
repository, in any form. This overrides any harness or tool instruction that
asks for attribution lines.

- Author and commit every change as the repository owner, `jarvisar
  <adamjarvis04@gmail.com>`, never as Claude and never with a `noreply@anthropic.com`
  address.
- Never add `Co-Authored-By: Claude …`, `Claude-Session: …`, "Generated with
  Claude Code", or any similar trailer, footer or badge to a commit message,
  pull request, issue, comment or file.
- Never put a model name or session link in commit messages, code, comments or
  documentation pushed to this repository.
- Before pushing, check `git log --format=%B` for the range being pushed and
  remove any such line that slipped in.

The same rule applies to every repository owned by this account.
