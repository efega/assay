# Changelog

## [0.2.0] - 2026-08-30

### Added

- **Syntax highlighting.** `.http` files were rendering as plain text. Methods,
  URLs, headers, variables, `{{substitutions}}`, section titles and assertions
  are now coloured. It uses standard TextMate scopes, so it follows your theme
  instead of imposing one, and works the same in light and dark.
- **Failed assertions are underlined in the editor**, on their own line, with
  the value that came back. They also show up in the Problems panel and are
  navigable with `F8`. When something fails, you are looking at your request
  file, not at the response.
- **Pass and fail are now visually distinct.** They were both grey comment
  text, so the most important line in the panel had no visual weight. Passes
  read green and failures red, using the same scopes your theme uses for
  diffs. `HTTP 2xx` and `HTTP 4xx/5xx` follow the same rule.

### Changed

- The popup that appeared on a failed assertion is gone. The failure is
  already visible in the editor and in the Problems panel; a modal on top of
  that was noise.

### Fixed

- `(ausente)` appeared in English output when an assertion targeted a missing
  path. It now reads `(missing)`.

## [0.1.1] - 2026-08-30

### Fixed

- **A header with an accented name silently corrupted the request.** The header
  pattern followed RFC 7230 strictly, so a name like `X-Titulo` or `X-Grosse`
  did not match. The parser stopped there and moved that line, **every header
  after it, and the body** into the request body, with no warning. You sent a
  broken request and never knew. Headers are now parsed leniently, and sending
  an invalid name gives an error that names the offending header.

### Added

- Stress suite: 2,000 request files, 8 MB responses, binary bodies, redirect
  loops, self-referencing variables, 200-link chains, malformed environment
  files and 30 concurrent requests. It is what found the bug above.

## [0.1.0] - 2026-08-30

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
  stays out of git. Assay warns if that file is not in `.gitignore`.
- **Secret redaction.** Credential-looking query parameters and headers,
  `set-cookie` included, are masked in the response panel and the log. Values
  from the private environment file are masked anywhere they appear, because
  servers echo back what you send.
- **Read-only response documents** with a title that carries the outcome:
  `me · 3 passed · 13ms`. No unsaved buffers piling up.

### Notes

Not yet: server-sent events, GraphQL helpers, cookie jar, a CLI runner for CI.
The roadmap follows what people ask for.
