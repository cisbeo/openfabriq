---
when:
  schedule: { cron: "0 2 * * *" }
agent: auditor
can: [create_issue]
---
Audit the code.
