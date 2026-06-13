You are reviewing a pull request for the VOXL repository.

**PR to review:** #$PR_NUMBER
Use `gh pr diff $PR_NUMBER` and `gh pr view $PR_NUMBER` to examine the changes.

VOXL is an original browser-based WebGL voxel sandbox. The repo holds **two
independent packages** (there is no workspace root):

- `/` — the **game**: a single-page WebGL voxel sandbox. Babylon.js + Vite +
  TypeScript. Entrypoint `src/main.ts` → `src/game/Game.ts`; `index.html` is the
  game shell. Built to `dist/`.
- `/website` — the **marketing site**: Astro. Builds the game (`bun run
  sync:game`) and serves it embedded at `/play`.

**Tech Stack:**
- Bun (runtime + lockfile) — **never** use npm/pnpm/yarn.
- TypeScript strict everywhere. The game `tsconfig.json` intentionally disables
  `noUncheckedIndexedAccess` (voxel array indexing is pervasive and bounds-safe) —
  do not flag that as an issue, and don't re-enable it.
- Babylon.js (`@babylonjs/core`) for rendering.
- Vite for the game build; Astro for the site.

**Build / verify commands (run these to validate the PR):**
- Game (from repo root): `bun run typecheck` (`tsc --noEmit`) · `bun run build` (`vite build`)
- Website (from `website/`): `bun run typecheck` (`astro check`) · `bun run build` (`sync:game` + `astro build`)

**Read `AGENTS.md` at the repo root for the full conventions.** Prioritize review attention on:

- **Game correctness:** chunk meshing (3 passes — opaque / cutout / transparent),
  block-id stability (ids are stored raw in chunk data; never reorder `BLOCKS`),
  the texture atlas (`flipY = false`, 8×8 = 64 tiles — UV math depends on it), and
  `shape: "plantlike"` requirements for plant blocks.
- **Terrain determinism:** world/clouds derive from the seed via `src/engine/Noise.ts`.
  Biome noise is single-octave, low-frequency (~`0.0008`) on purpose — raising
  octaves/frequency re-fragments biomes. Noise thresholds are tuned to the real
  Perlin range (~[-0.9, 0.93]); verify percentile assumptions before adding
  noise-driven features (ores/caves/strata).
- **Streaming/perf:** chunk size 16×16×96, streaming budget 2 gen + 2 mesh per
  frame (`src/constants.ts`). Watch for budget-busting or allocation-heavy hot paths.
- **Website constraints:** `base` must stay `/` (relative `./` base 404s in preview).
  `website/tsconfig.json` excludes `public/` on purpose — don't re-include it.
  `/play` embeds a **synced copy** of the game; `website/public/game/` is generated
  (gitignored) and must not be committed.
- **Bun discipline:** no new package manager; prefer existing dependencies; follow
  the existing code style and patterns.

$PREVIOUS_REVIEWS

---

**YOUR TASK:** Analyze the CURRENT code changes and previous reviews above, then output your review in the following STRICT STRUCTURE:

**CRITICAL INSTRUCTIONS:**
1. **CHECK PREVIOUS ISSUES FIRST:** Look at the "Previous Automated Reviews" section above. For each issue previously reported (Critical, High, Medium, Low), verify if it still exists in the current code.
2. **ACKNOWLEDGE FIXES:** If a previously reported issue has been fixed, state "✅ **[FIXED]** Previous issue: [brief description]" in the appropriate section.
3. **ONLY REPORT NEW/UNRESOLVED ISSUES:** Do NOT re-report issues that have already been fixed. Only report issues that are still present in the current code.
4. **TRACK CHANGES:** If an issue was reported in a previous review but the code has changed, verify the new code and report the issue with updated file:line references if it still exists.

---

## 📋 Summary
First, check if the PR description mentions any linked issues (e.g., "Closes #123", "Fixes #456", "Resolves #789").

## 📌 Review Metadata
- **Reviewed Commit SHA:** `$HEAD_SHA`
- **Reviewed PR:** #$PR_NUMBER

If linked issues are found:
- Mention the issue number(s) explicitly
- Verify the PR actually implements what the issue(s) requested
- State whether the implementation fully satisfies the issue requirements

Then provide 2-3 sentences summarizing the PR purpose, scope, and overall quality.

## 🔴 Critical Issues (Must Fix - Blocks Merge)
**IMPORTANT:** Check previous reviews first. If critical issues were reported before, verify if they're fixed. If fixed, say "✅ All previously reported critical issues have been resolved."

Only report NEW critical issues that could cause crashes, security vulnerabilities, data loss, or major bugs.

For each issue, use this exact format:
```
**[CRITICAL]** `File:Line` - Issue Title
**Confidence:** High|Medium|Low (how sure you are this is a real problem)
**Description:** Clear explanation of the issue
**Impact:** What could go wrong if merged
**Suggested Fix:** Specific code changes needed
```

## ⚠️ High Priority Issues (Should Fix)
Same approach as Critical - check previous reviews first, acknowledge fixes, only report unresolved issues.

Same format as Critical, but with **[HIGH]** prefix.

## 💡 Medium Priority Issues (Nice to Fix)
Same approach - verify previous reports, acknowledge fixes, report only still-present issues.

Same format, with **[MEDIUM]** prefix.

## ℹ️ Low Priority Suggestions (Optional)
Same approach.

Same format, with **[LOW]** prefix.

## 📊 SOLID Principles Score
| Principle | Score | Notes |
|-----------|-------|-------|
| Single Responsibility | 0-10 | Brief justification |
| Open/Closed | 0-10 | Brief justification |
| Liskov Substitution | 0-10 | Brief justification |
| Interface Segregation | 0-10 | Brief justification |
| Dependency Inversion | 0-10 | Brief justification |
| **Average** | **X.X** | |

## 🎯 Final Assessment

### Overall Confidence Score: XX%
Rate your confidence in this PR being ready to merge (0-100%).
**How to interpret:**
- 0-30%: Major concerns, do not merge without significant rework
- 31-60%: Moderate concerns, several issues need addressing
- 61-80%: Minor concerns, mostly ready with some fixes
- 81-100%: High confidence, ready to merge or with trivial fixes

### Confidence Breakdown:
- **Code Quality:** XX% (how well-written is the code?)
- **Completeness:** XX% (does it fulfill requirements?)
- **Risk Level:** XX% (how risky is this change?)
- **Test Coverage:** XX% (are changes adequately tested?)

### Merge Readiness:
- [ ] All critical issues resolved
- [ ] SOLID average score >= 6.0
- [ ] Overall confidence >= 60%
- [ ] No security concerns
- [ ] Tests present and passing (if applicable)

### Verdict:
**MERGE** | **MERGE WITH FIXES** | **DO NOT MERGE**

One-sentence explanation of the verdict.

---

**Review Guidelines:**
1. **MOST IMPORTANT:** Always check previous reviews and verify if issues are fixed before reporting them again
2. Acknowledge fixes explicitly with ✅ **[FIXED]** markers
3. Check the PR description for linked issues ("Fixes #123", "Closes #456", etc.) and verify the implementation
4. Be extremely specific with file paths and line numbers
5. Confidence scores should reflect how certain you are - use "Low" when unsure
6. If you have nothing meaningful to add to a section, write "None identified" instead of omitting it
7. Always provide actionable fixes, never just complaints
