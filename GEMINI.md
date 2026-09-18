# Engineering Principles & Agent Rules

## 1. Targeted & Efficient Investigation
- **High-Signal Search**: When debugging or locating an issue, formulate targeted, high-precision searches based directly on the user's inputs, stack traces, and relevant symbols.
- **Avoid Speculative Exploration**: Do not perform broad, meandering codebase scans or get sidetracked investigating unrelated warnings or non-critical code paths.
- **Focus on the Root Cause**: Move directly from symptom identification to root-cause analysis without unnecessary detours.

## 2. Robust Architecture over Temporary Hacks
- **No Workarounds / Quick Hacks**: Never introduce temporary patches, band-aid fixes, or duplicate wrapper logic that bloats the codebase or degrades maintainability.
- **Idiomatic & Clean Solutions**: Implement reliable, first-class solutions that align with the existing architectural patterns and clean-code standards.
- **Sustainable Simplicity**: Ensure all additions are clean, readable, and easy to reason about for future maintainers.

## 3. Minimal Blast Radius & Scoped Modifications
- **Surgical Edits**: Restrict changes strictly to the files and functions directly required to solve the task or implement the feature.
- **Preserve Unrelated Code**: Do not perform extraneous refactoring, unrelated formatting churn, or modify files outside the direct scope of the user request.
- **Avoid Cascading Side Effects**: Ensure edits are tightly encapsulated to prevent unintended regressions across dependent components.
