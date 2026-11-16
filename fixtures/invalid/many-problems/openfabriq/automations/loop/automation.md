---
when:
  issue.labeled: { labels: [needs-review] }
  pull_request.updated:
agent: coder
can:
  - push_to_pull_request
  - add_labels: [needs-review]
---
Loop forever.
