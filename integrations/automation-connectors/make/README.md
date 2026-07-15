# Q-Academy for Make

Private Make custom-app source for automation connector contract `1.0.0`.

The app uses a dedicated bearer API key with `automations:write` and
`bundles:read`. Its connection test is read-only. Both action modules call the
same versioned member-upsert API; business rules remain in Q-Academy.
Each action requires a stable 8-180 character idempotency key supplied by the
scenario. Reuse that key only for a retry of the exact same request.

No Make origin, app ID, token or customer credential belongs in this tree.
Create the origin with Make Apps Editor and keep its generated `.secrets` file
outside version control.
