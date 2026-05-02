# Security Policy

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report them privately using [GitHub's security advisory system](https://github.com/arvindrk/twitter-agent/security/advisories/new). This keeps the details confidential until a patch is available.

Include as much detail as possible:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

Do not include actual credentials, tokens, or secrets in the report.

## Scope

Security issues relevant to this project include:

- Unauthorized access to the cron endpoints
- Secrets or API keys exposed in logs or responses
- Dependency vulnerabilities with a known exploit path

## Out of Scope

- Rate limiting or abuse of the X (Twitter) API (report those to X directly)
- Theoretical vulnerabilities with no realistic exploit path

## Response

All reports will be reviewed. Given this is a personal project, response times may vary, but critical issues will be addressed as quickly as possible.
