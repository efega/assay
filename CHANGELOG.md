# Changelog

## [0.1.0] — 2026-08-30

First public release.

### Added

- **Send `.http` files.** Compatible with the REST Client syntax: `###`
  separators, `@variables`, `# @name`, `{{substitution}}`. Existing files work
  without changes.
- **Assertions.** `# @assert status 200`, `time < 500`,
  `body.$.items.length > 0`, `header.content-type contains json`. Declarative,
  no scripting sandbox. Results appear at the top of the response and in the
  editor tab.
- **Request chaining.** `{{login.response.body.$.token}}` runs the dependency
  on its own if it hasn't run yet, with cycle detection and a depth limit.
- **Environments.** `http-client.env.json` plus a private file for secrets that
  stays out of git. Roost warns if that file is not in `.gitignore`.
- **Secret redaction.** Credential-looking query parameters and headers —
  `set-cookie` included — are masked in the response panel and the log. Values
  from the private environment file are masked anywhere they appear, because
  servers echo back what you send.
- **Read-only response documents** with a title that carries the outcome:
  `me · 3 passed · 13ms`. No unsaved buffers piling up.

### Notes

Not yet: server-sent events, GraphQL helpers, cookie jar, a CLI runner for CI.
The roadmap follows what people ask for.
