# Issue tracker

Issues live in GitHub for `neovenio/h20-event-assistant`, managed with the `gh` CLI (for example `gh issue list -R neovenio/h20-event-assistant`).

## Labels (state machine)

`needs-triage` -> `needs-info` | `ready-for-agent` | `ready-for-human` | `wontfix`

- Categories: `bug` | `enhancement`
- Orchestrator: `in-progress`
- Routing: `agent:tdd` | `agent:review` | `agent:codex-rescue`

## Dependencies

Put a `Blocked by: #<N>` line at the top of the issue body. The orchestrator parses it and skips issues whose blockers are still open.

## Agent briefs

Triage posts an "Agent Brief" comment on each ready issue. It is the contract; the issue body is context. PRs use `Closes #<N>`.
