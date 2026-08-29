import { test } from "node:test";
import assert from "node:assert/strict";
import { redactarUrl, redactarCabeceras, formatearBytes } from "../../src/http";

test("redacta valores sensibles de la query", () => {
  assert.equal(
    redactarUrl("https://x.dev/a?token=abc123&page=2"),
    "https://x.dev/a?token=***&page=2",
  );
  assert.equal(
    redactarUrl("https://x.dev/a?api_key=k&x-secret=s"),
    "https://x.dev/a?api_key=***&x-secret=***",
  );
});

test("no toca urls sin nada sensible", () => {
  const url = "https://x.dev/users?page=2&sort=name";
  assert.equal(redactarUrl(url), url);
});

test("una url relativa o con variables sin resolver se deja igual", () => {
  assert.equal(redactarUrl("{{base}}/users"), "{{base}}/users");
  assert.equal(redactarUrl("/users?token=x"), "/users?token=x");
});

test("redacta cabeceras sensibles y respeta las demas", () => {
  const r = redactarCabeceras({
    Authorization: "Bearer secreto",
    "X-Api-Key": "k",
    Accept: "application/json",
  });
  assert.equal(r["Authorization"], "***");
  assert.equal(r["X-Api-Key"], "***");
  assert.equal(r["Accept"], "application/json");
});

test("formateo de tamanyos", () => {
  assert.equal(formatearBytes(512), "512 B");
  assert.equal(formatearBytes(2048), "2.0 KB");
  assert.equal(formatearBytes(3 * 1024 * 1024), "3.0 MB");
});
