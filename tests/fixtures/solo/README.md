# N1 fixture

Copy this directory to a fresh temporary directory outside the harness repository. Initialize Git there and commit the baseline locally. The data is synthetic and uses Python's standard library.

Run the baseline with `python3 -m unittest -v` inside the copy. The greeting test passes. The clamp test deliberately fails for values inside or above the lower bound.

Task A asks Codex to add an optional punctuation argument to greeting, defaulting to "!". Existing callers must keep working, and greeting("An", "?") must return "Hello, An?". Add an affected check in the disposable copy.

Task B asks the same Codex worker to fix clamp so the existing boundary and interior cases pass. Keep the test assertions. Capture baseline and final results.

During the combined N1 session, record the exact native session ID and cwd before disconnect/resume. Add an unrelated developer note in the copy and confirm preservation after resume. Change affected source after a check and confirm it is rerun. For missing-requirement and mandatory-review variants, explicitly provide those constraints and inspect the resulting status. Record quota/network/resource cases as unverified unless actually observed or safely simulated and identified as simulation.

Use tests on the copy for N1. Keep this committed fixture defective so a later acceptance run can reproduce the same baseline.
