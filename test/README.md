# NexusFlow tests

These tests use Node.js's built-in test runner and require no extra test dependency.

Run the NLP tests from the project root:

```powershell
node --test test/nlp.test.js
```

Run every test file under `test/`:

```powershell
node --test
```

The safety cases intentionally protect against accidental destructive actions. If one
fails, update the command parser or its execution policy before treating that command
as safe to run.
