# MME Fallback Quality Plan

This document is the Step 1 readiness audit for the `mme-fallback-quality` branch.

It defines the safety criteria for a future `textureToon` fallback apply path. It does not implement texture assignment, material replacement, shader execution, HLSL translation, or Ray-MMD rendering.

## Current Baseline

- The plugin/effect scaffold is merged into the MME compatibility work.
- `basicToon` apply is experimental, guarded, and undoable.
- `textureToon` is currently preview-only.
- Texture candidates are represented with:
  - `reference`
  - `resolvedPath`
  - `status`
- Current texture candidate statuses include:
  - `resolved`
  - `candidate-only`
  - `unresolved`

## textureToon Apply Eligibility

A future `textureToon` apply path may be considered only when all of these conditions are true:

- The planned fallback preset is `textureToon`.
- The target `matchingPolicy` is `single-global-effect`.
- Texture evidence is `resolved`, not `candidate-only` or `unresolved`.
- A diffuse texture path is available.
- The diffuse texture path is loadable through a controlled texture loading path.
- No critical texture file required by the fallback plan is missing.
- The analysis does not require a custom vertex shader.
- The analysis does not require a custom pixel shader.
- The analysis does not require multipass behavior.
- The analysis does not require render target or postprocess dependencies.
- The apply transaction has no duplicate mesh targets.
- The experimental apply gate is explicitly enabled.
- The controller is enabled and in `apply` mode.
- The apply plan passes controller validation immediately before apply.

These criteria are intentionally strict. Passing this list would mean the fallback is eligible for a narrow `textureToon` approximation, not that the original MME effect is supported or faithfully rendered.

## Hard Blockers

Any of these conditions must block `textureToon` apply:

- Unresolved texture evidence.
- `candidate-only` texture evidence.
- Missing diffuse texture file.
- Missing critical texture file.
- `matchingPolicy === "multi-global-effect"`.
- `matchingPolicy === "unmatched"`.
- Unsupported effect analysis.
- Failed effect analysis.
- Custom vertex shader dependency.
- Custom pixel shader dependency.
- Multipass dependency.
- Render target dependency.
- Postprocess dependency.
- Duplicate mesh target records in one apply transaction.
- Controller disabled.
- Mode is not `apply`.
- Experimental apply gate disabled.

Blocked cases may still appear in diagnostics and preview UI, but they must remain non-apply-eligible.

## Ownership And Revert Requirements

Any future `textureToon` apply implementation must preserve the existing undo safety model:

- Created Babylon `Texture` instances must be tracked by the apply transaction.
- Created fallback materials must be tracked by the apply transaction.
- Revert must restore each mesh's original material reference.
- Revert must dispose created fallback materials owned by the transaction.
- Revert must dispose created textures owned by the transaction.
- Failure cleanup must dispose any material or texture allocated before the failure.
- No partial apply is allowed.
- If any target is invalid, the whole transaction must abort before assigning materials.
- The UI must not bypass controller validation.
- The controller must revalidate immediately before apply.

The caller remains responsible for not disposing textures or materials still in use outside the transaction.

## Implementation Sequence

Planned sequence for future work:

- Step 2: texture asset loader scaffold and dry-run validation.
- Step 3: `textureToon` apply plan extension.
- Step 4: texture ownership transaction model.
- Step 5: guarded `textureToon` apply.
- Step 6: revert/dispose stress tests.

Each step should keep `textureToon` disabled for real apply until the required ownership and validation checks are present.

Step 2 adds `src/plugin/mme-texture-asset-validator.ts` as a dry-run texture candidate validator. It checks resolved texture candidates against supported image extensions and optional registered-file context, returning `valid`, `missing`, `unsupported-extension`, `unresolved`, `ambiguous`, or `failed`. It does not allocate Babylon `Texture` instances, assign textures to materials, or make `textureToon` apply-eligible.

## Non-goals

- No arbitrary `.fx` rendering.
- No HLSL execution.
- No HLSL-to-GLSL or HLSL-to-WGSL translation.
- No Ray-MMD rendering.
- No general MME parity claim.
- No texture assignment before the loader, ownership model, and failure cleanup are reviewed.
