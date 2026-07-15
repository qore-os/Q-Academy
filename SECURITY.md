# Security Policy

## Supported versions

Security fixes are applied to the current production release. Older releases
are supported only for the duration of an explicitly documented rollback
window and must not remain exposed after a fixed release is available.

## Reporting a vulnerability

Do not open a public issue. Use GitHub private vulnerability reporting for this
repository. If that channel is unavailable, email `security@q-academy.de` with
the subject `Q-Academy security report`.

Include the affected route or component, impact, reproduction steps, and a safe
proof of concept. Do not access other tenants, alter customer data, perform
denial-of-service testing, or retain personal data obtained during research.

We target an acknowledgement within two business days, an initial severity
assessment within five business days, and status updates at least every seven
days until remediation or documented risk acceptance. Coordinated disclosure
timing is agreed with the reporter after affected operators have a fix.

The production operator must monitor the security mailbox, maintain an on-call
owner, and test the private reporting path before customer launch. Operational
incident handling follows [the incident response runbook](docs/INCIDENT_RESPONSE_RUNBOOK.md).
The reproducible CI security checks and their explicit limits are documented in
[the security testing guide](docs/SECURITY_TESTING.md).
