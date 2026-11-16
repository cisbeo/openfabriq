---
when: [pull_request.opened]
agent: tester
can: [add_comment]
---
Run the tests of the dependencies this pull request changes.
