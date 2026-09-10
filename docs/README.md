# Documentation index

## Current usage and maintenance

- [README](../README.md): installation, first successful request, and evaluation overview.
- [Consumer guide](usage.md): current API and integration recipes for applications and AI agents.
- [Changelog](../CHANGELOG.md): version boundaries and upgrade instructions, including Prisma 7 in 0.5.0.
- [Runnable examples](../README.md#documentation-and-examples): independent consumer applications.
- [Repository instructions](../AGENTS.md): maintenance and verification commands.
- [Documentation remediation checklist](2026-09-10-documentation-remediation.md): fixed scope and evidence for this documentation/implementation update.

The current checkout contains unreleased fixes while `package.json` still says `0.5.0`. Read the version scope in the README and consumer guide before applying checkout-only options to an installed release.

## Historical records

The files below record earlier decisions or checks performed at the time. Their dependency versions, evaluation rules, APIs, benchmark figures, and validation results can differ from current code. They are useful for understanding a change, but are not installation instructions or evidence that the current checkout has passed the same checks.

- [Initial design](2026-04-05-feature-flag-design.md)
- [0.1.0 validation](2026-04-05-validation-report-v0.1.0.md)
- [0.2.0 validation](2026-04-10-validation-report-v0.2.0.md)
- [2026-04-10 SOLID review](2026-04-10-solid-validation-report.md)
- [Implementation plans](superpowers/plans/)
- [Release design specifications](superpowers/specs/)

Prefer the current consumer guide, public declarations, and executable example fixtures when these records disagree with current behavior. Keep historical records intact; record current verification evidence in the remediation checklist or the relevant change description.
