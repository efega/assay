```http
GET {{base}}/users

# @assert status 200
# @assert time < 500
# @assert body.$.items.length > 0
```

```
3/3 assertions passed
  PASS  status 200
  PASS  time < 500
  PASS  body.$.items.length > 0
```
