```http
### Log in
# @name login
POST {{base}}/auth

### Assay sends login first, on its own
GET {{base}}/me
Authorization: Bearer {{login.response.body.$.token}}
```

Cycle detection and a depth limit included. The token never reaches the log.
