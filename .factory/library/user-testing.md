# User Testing — SobatNgupi Agent Optimization

## Validation Surface

This is a documentation/configuration project — there is no application UI to test with automated tools.

**Primary surface:** File content review (automated via shell commands and manual inspection)
- JSON validation: `jq . menu-schema.json`
- Word count verification: `wc -w <file>`
- Content pattern matching: `grep` for field names, forbidden words, cross-references
- File existence checks: `ls`, `test -f`

**Secondary surface (manual, by user):** WhatsApp conversation testing
- User (Acid) tests the agent via real WhatsApp conversations after changes
- Cannot be automated — OpenClaw agent platform is the runtime

## Validation Concurrency

Max concurrent validators: **5** (all validation is lightweight file inspection — grep, cat, wc, jq)
No services need to be running for validation. All checks are against static files.

## Testing Tools

- `jq` — JSON validation
- `grep`/`rg` — Content pattern matching
- `wc` — Word count verification
- `ls`/`test` — File existence checks
- Standard shell tools — all pre-installed

## Limitations

- Cannot test actual agent conversation behavior — that requires the OpenClaw runtime + WhatsApp
- Cannot verify QRIS payment flow works — requires live backend + payment gateway
- Validation is limited to file quality, consistency, and correctness
