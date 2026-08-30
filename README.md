<div align="center">

<img src="icon.png" width="88" alt="">

# Roost

**An HTTP client for VS Code that tests your API.**

Plain `.http` files. No account, no cloud, nothing paywalled later.

[![Version](https://vsmarketplacebadges.dev/version-short/roost.roost.svg?style=flat-square&color=0f6b63&label=marketplace)](https://marketplace.visualstudio.com/items?itemName=roost.roost)
[![Installs](https://vsmarketplacebadges.dev/installs-short/roost.roost.svg?style=flat-square&color=0f6b63)](https://marketplace.visualstudio.com/items?itemName=roost.roost)
[![Rating](https://vsmarketplacebadges.dev/rating-short/roost.roost.svg?style=flat-square&color=0f6b63)](https://marketplace.visualstudio.com/items?itemName=roost.roost&ssr=false#review-details)
[![License](https://img.shields.io/badge/license-MIT-0f6b63?style=flat-square)](LICENSE)

</div>

<br>

![Roost running a chained request with assertions](media/hero.png)

<br>

## One line is the whole setup

```http
GET https://api.example.com/health
```

Press **Send** above the request, or `Ctrl+Alt+R`.

## Then make it a test

```http
@base = https://api.example.com

### Log in
# @name login
POST {{base}}/auth
Content-Type: application/json

{ "user": "ana", "password": "{{password}}" }

### Use the token (login runs on its own if it hasn't yet)
GET {{base}}/me
Authorization: Bearer {{login.response.body.$.token}}

# @assert status 200
# @assert time < 500
# @assert body.$.roles.length > 0
```

Roost tells you what a request will do before you send it: how many assertions
will run, and which requests it will fire first.

<br>

## Why this one

|   |   |
| --- | --- |
| **Assertions built in** | Status, timing, headers and JSON paths. Declarative: no scripting sandbox, and the diff reads clean in code review. |
| **Request chaining** | Use one response in the next request. Dependencies run on their own, with cycle detection and a depth limit. |
| **Environments** | Standard `http-client.env.json`. Secrets live in a separate file that stays out of git, and Roost tells you if it isn't ignored yet. |
| **Nothing is paywalled retroactively** | Your saved requests are yours. Export is always free. That is a promise, not a tier. |

## Works with the files you already have

Roost reads the same `.http` syntax as REST Client: `###` separators,
`@variables`, `# @name`, `{{substitution}}` and
`{{name.response.body.$.path}}` chaining. Point it at your existing files and
they work.

<br>

## Assertions

```http
# @assert status 200
# @assert status < 300
# @assert time < 1000
# @assert header.content-type contains json
# @assert body.$.token exists
# @assert body.$.items.length > 0
# @assert body.$.name matches ^ana
```

|   |   |
| --- | --- |
| **Targets** | `status` · `time` · `bytes` · `header.<name>` · `body.<path>` |
| **Operators** | `=` `!=` `<` `<=` `>` `>=` `contains` `matches` `exists` `empty` |

Omit the operator for equality. Assertions work anywhere in the block.

Results land at the top of the response, and the editor tab tells you the
outcome at a glance: `me · 3 passed · 13ms`.

<br>

## Environments

`http-client.env.json`, committed with the project:

```json
{
  "dev":  { "base": "http://localhost:3000" },
  "prod": { "base": "https://api.example.com" }
}
```

`http-client.private.env.json`, never committed:

```json
{ "dev": { "password": "the-real-one" } }
```

Pick the active one from the status bar. Values in the private file win.
Variables declared in the `.http` file itself still take precedence, so
existing files keep behaving exactly as before.

<br>

## Your credentials stay on your machine

- No account, ever. Nothing to sign up for.
- No cloud sync, no telemetry, no phoning home.
- Resolved secrets are **never written to the log**. You see the reference
  (`login.response.body.$.token`), not its value.
- Query parameters and headers that look like credentials are shown as `***`
  (`set-cookie` included, since that is where the session usually travels).
- Values from your private environment file are masked **anywhere they appear**,
  including inside a response body, because servers do echo back what you sent.
- Chained responses are dropped as soon as you edit the file, so a stale token
  never travels silently.

**What redaction cannot do.** Roost masks what it knows is secret: credential
looking parameters and headers, and the exact values from your private
environment file. It cannot guess that an arbitrary string in a response body
is sensitive, because doing so would corrupt real data. Turn redaction off with
`roost.redactSecrets` when you need the raw response.

<br>

## Reference

| Command |   |
| --- | --- |
| `Roost: Send request` | `Ctrl+Alt+R` · `Cmd+Alt+R` on macOS |
| `Roost: Select environment` | Also on the status bar |
| `Roost: New request file` | Starter file with the three ideas |
| `Roost: Reset chain` | Discards saved responses |

| Setting | Default |   |
| --- | --- | --- |
| `roost.timeoutMs` | `30000` | How long to wait for a response |
| `roost.redactSecrets` | `true` | Mask credential-looking values |

<br>

## Status

Early, and honest about it. Working today: parsing, variables, environments,
assertions, chaining, secret redaction. Not yet: server-sent events, GraphQL
helpers, cookie jar, a CLI runner for CI.

Missing something? [Open an issue](https://github.com/efega/roost/issues). The
roadmap is driven by what people actually ask for.

<div align="center">
<br>
<sub>MIT · Built for people who keep their requests in the repo</sub>
</div>
