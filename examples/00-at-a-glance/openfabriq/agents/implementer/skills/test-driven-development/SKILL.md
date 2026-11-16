---
name: test-driven-development
description: How to change code test first, red then green, and show the proof in the pull request. Use before writing or changing any code, for a feature, a bug fix or a change a review requested.
---

# Test-driven development

No code without a test that failed first. A test you never saw fail proves nothing: it may test the wrong thing, or pass whatever the code does.

## The cycle, for each acceptance criterion

1. **Red.** Write one small test for one behavior, named after what should happen ("rejects an empty title"). Test through the public functions or what a person sees, with real code; mock only what leaves the machine.
2. **Watch it fail.** Run it with the project's test command. It must fail, not crash, and for the expected reason: the behavior is missing. It passes already? It tests behavior that exists: change the test. It crashes on a typo or an import? Fix that and run it again. Keep the end of the output.
3. **Green.** Write the smallest change that makes it pass. Nothing the test does not ask for: no option, no cleanup of other code.
4. **Watch it pass, then the whole suite**, not only your file: every test green, no new warning. A test of the suite that fails, even one you did not break, is named in the pull request.
5. **Clean up**, tests still green. Then the next criterion.

Code written before its test is not kept "as a reference": delete it and start from the test.

## A bug, or a production error

The first test reproduces the bug: the input of the issue, or the one in the stack trace. It fails the way the bug does, then passes with the fix, and stays as the regression test.

## Proof in the pull request

For each acceptance criterion: the test, the end of its failing run before the change, and its passing run after. Then the command of the whole suite and its result.

## When there is no test to write

Documentation, configuration, generated files, a change nothing can observe: say so in the pull request, criterion by criterion, instead of writing a test that checks nothing.

## Excuses that do not hold

| Excuse | Why not |
| --- | --- |
| "Too simple to test" | Simple code breaks too, and the test takes a minute. |
| "I will add the tests after" | A test written after the code passes at once: it describes the code, not what it should do. |
| "I already tried it by hand" | Nobody can run what you tried again, and the next change breaks it silently. |
| "The test is hard to write" | Then the code is hard to use: simplify its interface. |
| "This code has no tests" | Then your first test is for the behavior you change. |

Adapted from the test-driven-development skill of [obra/superpowers](https://github.com/obra/superpowers) (MIT).
