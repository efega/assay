<div align="center">

<img src="icon.png" width="88" alt="">

# Assay

**An HTTP client for VS Code that tests your API.**

Plain `.http` files. No account, no cloud, nothing paywalled later.

[![Install](https://img.shields.io/badge/install-from%20Marketplace-0f6b63?style=flat-square&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=efega.assay)
[![Version](https://badgen.net/vs-marketplace/v/efega.assay?color=0f6b63&labelColor=3a3a3a)](https://marketplace.visualstudio.com/items?itemName=efega.assay)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85+-0f6b63?style=flat-square)](https://code.visualstudio.com/)
[![License](https://img.shields.io/badge/license-MIT-0f6b63?style=flat-square)](LICENSE)

</div>

<br>

![Assay running a chained request with assertions](media/hero.png)

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

Assay tells you what a request will do before you send it: how many assertions
will run, and which requests it will fire first.

<br>

## Why this one

|   |   |
| --- | --- |
| **Assertions built in** | Status, timing, headers and JSON paths. Declarative: no scripting sandbox, and the diff reads clean in code review. |
| **Request chaining** | Use one response in the next request. Dependencies run on their own, with cycle detection and a depth limit. |
| **Failures where you are looking** | A failed assertion is underlined on its own line with the value that came back, and lands in the Problems panel. You never leave your request file. |
| **Environments** | Standard `http-client.env.json`. Secrets live in a separate file that stays out of git, and Assay tells you if it isn't ignored yet. |
| **Nothing is paywalled retroactively** | Your saved requests are yours. Export is always free. That is a promise, not a tier. |

## Reads like code, not like a text file

`.http` files get proper syntax highlighting: methods, URLs, headers,
variables, `{{substitutions}}`, section titles and assertions.

It uses standard TextMate scopes rather than fixed colours, so it follows
whatever theme you already use and reads correctly in light and dark.

<br>

## The small decisions

None of these are features. They are the difference between a tool you tolerate
and one you forget you are using.

- **Highlighting follows your theme, not ours.** Standard TextMate scopes, so
  it reads correctly in light, dark and whatever you actually use. Hardcoded
  colours look right on the author's machine and wrong on everyone else's.
- **Failures appear on the line that failed**, with the value that came back,
  because that is where you are looking. Not in a popup you have to dismiss.
- **A failed assertion is a warning, not an error.** It tells you something
  about a server, not about your file. Marking it red would put an error badge
  on a perfectly valid document.
- **The response is read only.** No `Untitled-1` buffers piling up, nothing
  asking whether you want to save a response you never wrote.
- **The tab tells you the outcome**: `me · 3 passed · 13ms`. You can read the
  result without switching to the panel.
- **The editor tells you what a request will do before you send it**: how many
  assertions will run, and which requests it will fire first.
- **Chained responses are dropped the moment you edit the file**, so a stale
  token never travels silently after you changed the login above it.
- **No popup for something already on screen.** If the failure is underlined
  and listed in Problems, a modal on top of that is noise.

<br>

## Works with the files you already have

Assay reads the same `.http` syntax as REST Client: `###` separators,
`@variables`, `# @name`, `{{substitution}}` and
`{{name.response.body.$.path}}` chaining. Point it at your existing files and
they work.

The format outlives any one tool. Visual Studio 2022 ships `.http` support of
its own, and Microsoft's documentation says it was inspired by the REST Client
extension. Your requests are plain text in your repository, readable by more
than one editor, and they stay yours if you stop using this one.

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

Results land at the top of the response, **passes in green and failures in
red**, and the editor tab tells you the outcome at a glance:
`me · 3 passed · 13ms`.

A failure is also **underlined on the assertion line itself** with the value
that came back, and listed in the Problems panel. You see what broke without
leaving your request file.

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

## Sessions

APIs that authenticate with a cookie instead of a bearer token work without
writing anything extra. Log in once and the session carries:

```http
### Log in, responds with Set-Cookie
# @name login
POST {{base}}/auth

### Already authenticated
GET {{base}}/me
```

The session belongs to the file and is cleared when you edit it, when you
close it, or with **Reset chain**. A `Cookie:` header you write yourself always
wins over the stored session.

Requests follow redirects, so a cookie set on an intermediate `302` is not
visible. Form logins that redirect are affected; JSON APIs, which answer `200`
with `Set-Cookie`, are not.

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

**What redaction cannot do.** Assay masks what it knows is secret: credential
looking parameters and headers, and the exact values from your private
environment file. It cannot guess that an arbitrary string in a response body
is sensitive, because doing so would corrupt real data. Turn redaction off with
`assay.redactSecrets` when you need the raw response.

<br>

## Reference

| Command |   |
| --- | --- |
| `Assay: Send request` | `Ctrl+Alt+R` · `Cmd+Alt+R` on macOS |
| `Assay: Select environment` | Also on the status bar |
| `Assay: New request file` | Starter file with the three ideas |
| `Assay: Reset chain` | Discards saved responses |

| Setting | Default |   |
| --- | --- | --- |
| `assay.timeoutMs` | `30000` | How long to wait for a response |
| `assay.redactSecrets` | `true` | Mask credential-looking values |

<br>

## Status

Early, and honest about it.

**Working today:** syntax highlighting, request parsing, file and environment
variables, assertions with editor diagnostics, request chaining, secret
redaction.

**Not yet:** server-sent events, GraphQL helpers, a cookie jar, and a CLI
runner so a `.http` file can run in CI.

Missing something? [Open an issue](https://github.com/efega/assay/issues). The
roadmap is driven by what people actually ask for.

<div align="center">
<br>
<sub>MIT · Built for people who keep their requests in the repo</sub>
</div>
