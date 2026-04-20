---
name: testing
description: Testing strategy and test writing — unit tests, integration tests, test patterns. Use when writing tests for new features, debugging test failures, or establishing test patterns.
---

# Testing

You write tests that catch real bugs and survive refactoring. A test suite is valuable when it gives confidence to change code. It's worthless when it breaks on every change without revealing actual problems.

## The Hardest Part: Deciding WHAT to Test

Most testing advice focuses on HOW to write tests. The real skill is knowing WHAT deserves a test and what kind. Here's the judgment framework:

**Always test:**
- Business logic with conditional paths. If there's an `if` that determines a business outcome (pricing, access control, state transition), it needs a test for each path.
- Data transformations. Input → output functions where wrong output means wrong behavior.
- Error boundaries. What happens when the external dependency fails? When the input is malformed?
- Bug fixes. Every bug fix needs a test that would have caught the bug. This prevents regressions AND documents what went wrong.

**Rarely test:**
- Glue code that just passes data between layers (controller → service → repository) — unless the wiring itself is the logic.
- Framework behavior. Don't test that React renders a div, or that Express calls your middleware. The framework authors already tested that.
- Trivial getters/setters with no logic.

**Never test:**
- Implementation details (private methods, internal state). If the public behavior is correct, the internals are correct. Testing internals makes refactoring impossible.

## Sociable vs. Solitary: The Real Question

Forget "unit vs integration" — those terms are so overloaded they're meaningless. The real question is: do you test with real collaborators (sociable) or with mocks/stubs (solitary)?

**Use sociable tests (real collaborators) when:**
- The collaborator is fast, deterministic, and you own it (e.g., your own utility classes, value objects, in-memory state).
- The integration between objects IS the thing that breaks. Mocking hides exactly the bugs you need to find.
- You're testing a workflow that spans multiple objects — the behavior only exists in their interaction.

**Use solitary tests (mocks/stubs) when:**
- The collaborator is slow (database, network, file system).
- The collaborator is non-deterministic (current time, random numbers, external APIs).
- You want to test how your code handles failure modes (mock throws an error, returns null, times out).
- The collaborator has its own test suite and you want to isolate failure signals.

**The mock trap:** If a test file has more mock setup than actual assertions, the test is probably testing the mocks, not your code. Step back and ask: "What real behavior am I verifying here?"

## Before Writing Any Test: Read the Existing Tests

This project has existing test patterns. Match them. Don't introduce a new test framework, assertion library, or file structure.

Discover:
- Where tests live (colocated? separate `tests/` directory?)
- File naming (`*.test.ts`, `*.spec.ts`, `test_*.py`?)
- Setup/teardown patterns (beforeEach, fixtures, factories?)
- How mocking is done (jest.mock, dependency injection, test doubles?)
- How async operations are tested (await, done callbacks, test utilities?)

## Writing the Test

Structure each test so a reader who has never seen the codebase can understand what's being verified:

```
// The test name IS the specification:
test('expired tokens are rejected with 401 even if signature is valid', () => {
  // ARRANGE: Build the specific scenario described in the test name.
  // Don't share arrange with other tests via global beforeEach
  // unless it's truly shared context — shared setup hides what matters.
  const token = createToken({ expiresAt: oneHourAgo });

  // ACT: One action. If you need two actions, you need two tests.
  const response = authenticateRequest(token);

  // ASSERT: Verify behavior, not implementation.
  // BAD:  expect(validateToken).toHaveBeenCalledWith(token) ← tests wiring
  // GOOD: expect(response.status).toBe(401) ← tests behavior
  expect(response.status).toBe(401);
  expect(response.body.error).toContain('expired');
});
```

**Test naming rule:** A test name should read like a specification. Not `test('works')` or `test('handles edge case')`. A good name answers: "What scenario? What outcome?" If the test fails in CI six months from now, the name alone should tell a developer what broke.

## What Makes Tests Fragile (and How to Fix It)

**Fragile pattern: Testing implementation instead of behavior.**
```javascript
// FRAGILE: breaks when you refactor the internals
expect(userService.hashPassword).toHaveBeenCalledWith('password123');

// ROBUST: verifies the outcome regardless of how it's achieved
const user = await userService.createUser({ password: 'password123' });
expect(await userService.authenticate(user.email, 'password123')).toBe(true);
expect(await userService.authenticate(user.email, 'wrongpassword')).toBe(false);
```

**Fragile pattern: Snapshot tests on dynamic content.**
Snapshots are fine for stable structures (component markup, API response shape). They're terrible for anything that includes timestamps, IDs, or content that changes by design. Every change becomes a "review and update snapshot" chore where the developer stops actually reading the diff.

**Fragile pattern: Time-dependent tests.**
```javascript
// FRAGILE: fails if CI is slow, passes on fast machines
await delay(100);
expect(callback).toHaveBeenCalled();

// ROBUST: wait for the condition, not a time interval
await waitFor(() => expect(callback).toHaveBeenCalled());
```

**Fragile pattern: Test ordering dependencies.**
If test B only passes when test A runs first, both tests are broken. Each test must create its own state and clean up after itself. Use factories or builders for test data — not shared mutable state.

## When Tests Fail

1. Read the error message completely. Not just the first line — the full stack trace and assertion diff. It usually says exactly what's wrong.
2. Run the failing test in isolation first. If it passes alone but fails in suite, you have an ordering/state leak problem.
3. Determine: is the test wrong, or is the code wrong? If the requirement changed, update the test. If the test caught a real bug, fix the code.
4. Never delete a failing test to make CI green unless you can explain why the test was wrong (not just inconvenient).
