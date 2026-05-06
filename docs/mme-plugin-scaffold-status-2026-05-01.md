# MME / Plugin Scaffold Status 2026-05-01

この文書は `feature/plugin-effect-api` 上の MME / plugin scaffold の状態メモです。
ファイル名は `2026-05-01` のままですが、内容は 2026-05-06 時点まで更新している living memo として扱います。

## PR Summary

このブランチでは `MMD_modoki` に以下を追加しています。

- read-only plugin / effect scaffold
- experimental MME compatibility pipeline

目的は、一般的な MME 再現を宣言することではなく、reviewable な拡張境界と安全な調査導線を先に整えることです。

## Why This PR Exists

This PR takes a scaffold-first approach so the plugin/effect extension points and MME investigation path can be reviewed before broader renderer work begins.

The intent is to keep the branch reviewable and safe:
- establish dry-run diagnostics first
- keep experimental behavior behind explicit gates
- make future material-application work incremental and reversible

## Current Supported Scope

- preview-only MME diagnostics and manifest / `.fx` structure inspection
- conservative `textureToon` preview guidance
  - weak or unresolved texture evidence remains warning-only
- guarded experimental `basicToon` apply
  - debug-only
  - explicit gate required
  - `single-global-effect` only
- undo / revert support for the guarded `basicToon` path
- debug-only target highlight via reusable `HighlightLayer`

## Explicitly Unsupported

- arbitrary `.fx` rendering
- HLSL translation or execution
- Ray-MMD rendering
- `textureToon` / `emissiveLite` / `katameLike` apply
- automatic per-material effect binding
- broad renderer pipeline integration

## Implemented

### Plugin / Effect Scaffold

- read-only `PluginHost`
- scene lifecycle hooks
- model / accessory asset hooks
- minimal plugin UI registry
- internal luminous glow adapter

### MME Compatibility Scaffold

- MME manifest loader
  - `.x`
  - `.fx`
  - `.fxsub`
  - `.conf`
- partial `.fx` structural parser
- mapper / analyzer
- fallback preset planner
- fallback material factory scaffold
- preview / apply controller
- experimental apply gate

### Read-only Debug UX

- scene material target candidate view
- filter / sort
- selection / detail
- `textureToon` dry-run preview diagnostics
  - texture-like fields show raw reference, resolved path, and candidate status when detected
  - unresolved or weak texture references stay nullable or warning-only
  - preview guidance remains conservative and does not imply texture binding support
- read-only highlight plan scaffold
- guarded debug highlight via reusable `HighlightLayer`
  - selected precise/highlightable candidate only
  - `multi-global-effect` and `unmatched` stay blocked
  - the same controller / scene reuses one `HighlightLayer`
- MME file picker entry point
- dry-run preview toggle

### Guarded Apply / Revert Debug UI

- guarded Apply / Revert debug UI
- read-only Apply Plan Targets preview
  - shows planned owner / mesh / material / original material availability
  - shows planned fallback preset / matching policy / effect id
  - shows current apply availability reason when no plan exists
- apply routes through controller APIs only
- apply is experimental / debug-only
- apply is limited to `basicToon`
- apply requires `matchingPolicy === "single-global-effect"`
- duplicate mesh targets are blocked
- revert restores the original material
- revert disposes the owned fallback material through the shared disposal helper

## NOT IMPLEMENTED

意図的に未実装の範囲:

- `textureToon` apply
- `emissiveLite` apply
- `katameLike` apply
- arbitrary `.fx` apply
- arbitrary `.fx` texture binding / texture assignment
- broad material replacement
- general MME shader execution
- HLSL-to-GLSL / WGSL translation
- multipass / render-target-heavy effect support
- Ray-MMD rendering
- broad renderer pipeline integration
- production/high-fidelity highlight system
- camera jump / focus-to-target workflow
- material-based highlight effect

これは full MME support でも Ray-MMD support でもなく、rendering parity も主張しません。

## Safety Guarantees

### Preview / Debug

- preview is dry-run
- candidate view is read-only
- `textureToon` preview is diagnostics-only
- weak candidate-only / unresolved texture evidence does not recommend `textureToon`
- resolved texture evidence may improve preview guidance only
- guarded debug highlight is debug-only and non-destructive
- preview / candidate / highlight paths do not mutate scene / material / mesh / camera
- highlight does not mutate `mesh.material`
- highlight does not modify material colors / properties
- highlight does not move the camera
- highlight does not trigger apply / revert
- `clearHighlight()`, preview disable, manifest clear, and controller dispose clean up highlight state

### Apply

apply は controller guard を通る safety experiment に限定しています。

- Apply Plan Targets does not create materials
- Apply Plan Targets does not mutate scene / material / mesh state
- Apply Plan Targets does not trigger apply / revert
- Apply / Revert still route only through controller guards
- controller enabled
- `mode === "apply"`
- `experimentalApplyEnabled === true`
- valid apply plan
- controller validation success

strict apply limits:

- `basicToon` only
- `single-global-effect` only
- `textureToon` is not apply-eligible
- duplicate mesh targets blocked
- no partial apply

UI から controller validation を bypass する path はありません。

## Milestone Summary

### Step 1-5

- Step 1: `PluginHost` / plugin types / no-op registry
- Step 2: scene lifecycle hooks in `MmdManager`
- Step 3: model / accessory load hooks
- Step 4: shared material target helpers
- Step 5: luminous glow internal `EffectPlugin` adapter

### Step 6-10

- Step 6: minimal plugin UI registry integration
- Step 7: internal `mme-compat-manifest` plugin and file discovery
- Step 8: partial `.fx` structural parser
- Step 9: parsed effect mapper / analyzer
- Step 10: fallback preset planner

### Step 11-15

- Step 11: fallback material factory scaffold
- Step 12: preview / apply controller scaffold
- Step 13: preview pipeline consolidated through controller
- Step 14: apply transaction / revert scaffold
- Step 15: internal MME file registration API

### Step 16-20

- Step 16: registered file path normalization and root selection policy
- Step 17: minimal debug-panel file picker
- Step 18: preview toggle in debug panel
- Step 19: removed duplicate dry-run preview computation and consolidated preview cleanup path
- Step 20: experimental apply gate

### Step 21-27

- Step 21: Apply Status cleanup for gate state
- Step 22: scaffold status docs
- Step 23: scene material target candidate view
- Step 24: candidate filter / sort
- Step 25: candidate selection / detail view
- Step 26: selected candidate highlight plan scaffold
- Step 27: `MmeFallbackHighlightPlan.reason` literal-union cleanup

### Step 28-35

- Step 28: PR / milestone documentation update
- Step 29: skipped
- Step 30: undoable `basicToon` apply
- Step 31: fallback material disposal helper cleanup
- Step 32: disposal helper dual-input contract docs
- Step 33: guarded Apply / Revert debug UI wiring
- Step 34: Apply Status aligned with `getApplyAvailability()`
- Step 35: `getApplyAvailability()` result field rename `enabled` -> `available`

### Step 36-42

- Step 36: status document updated after guarded Apply / Revert UI
- Step 37: final PR description section
- Step 38: safer `basicToon` field mapping quality improvements
- Step 39: `specularPower` heuristic documentation
- Step 40: guarded candidate debug highlight
- Step 41: reusable `HighlightLayer` lifecycle cleanup
- Step 42: documentation update for guarded debug highlight

### Step 43-48

- Step 43: `textureToon` dry-run preview diagnostics
- Step 44: conservative `textureToon` planning policy
- Step 45: documented conservative `textureToon` preview-only policy
  - `textureToon` remains non-apply-eligible
  - weak / unresolved texture evidence remains diagnostic / warning-only
- Step 46: human-readable texture preview summary
- Step 47: structured texture preview cards / rows
- Step 48: read-only Apply Plan Targets preview

### Step 49-50

- Step 49: documentation update for Apply Plan Targets preview
- Step 50: runtime Apply Plan Targets wording cleanup
  - uses `effect id` wording instead of ambiguous `target`

## Current Experimental Apply Scope

現在の apply は strictly limited な safety experiment です。

- debug-only
- experimental
- undoable
- `basicToon` only
- `single-global-effect` only

任意の `.fx` をそのまま適用する仕組みではありません。

## Validation Status

2026-05-06 時点:

- `npm.cmd run lint`
  - success
  - `0 errors / 455 warnings`
- `node_modules\.bin\tsc.cmd --noEmit`
  - fail
  - 既存の repo-wide TypeScript errors によるもの
- targeted `Vitest`
  - この sandbox では `spawn EPERM`

## Next Steps

- add original-material vs fallback-material diff summary before guarded apply
- polish Apply Plan Targets UI field labels and target/effect wording
- add DOM test coverage for Apply Plan Targets
- improve target-to-effect association precision
- decide whether `textureToon` is safe to prototype behind the same gate
- keep Ray-MMD explicitly unsupported unless a separate design/validation track is created

## Non-goals

この scaffold が直接目指していないもの:

- general MME rendering compatibility
- arbitrary `.fx` application
- Ray-MMD support
- renderer parity
- production-ready material replacement system

## PR Description

### Title

Add plugin/effect scaffold and experimental MME compatibility pipeline

### Copy-paste-ready PR description

#### Overview

This PR adds plugin/effect scaffold groundwork and an experimental MME compatibility investigation pipeline.

The branch is intentionally scaffold-first and dry-run-first. It introduces reviewable extension points, conservative diagnostics, and a narrowly gated experimental apply path without claiming general MME rendering support.

#### Implemented

- read-only plugin/effect host groundwork
  - `PluginHost`
  - scene lifecycle hooks
  - model/accessory asset hooks
  - minimal plugin UI registry
  - internal luminous/glow adapter
- MME compatibility investigation pipeline
  - manifest discovery/loading for `.x`, `.fx`, `.fxsub`, `.conf`
  - partial `.fx` structural parser and analyzer
  - fallback mapper, planner, material factory scaffold, and controller
- dry-run diagnostics and debug tooling
  - preview diagnostics
  - candidate view with filter/sort/selection/detail
  - guarded debug highlight via reusable `HighlightLayer`
  - read-only Apply Plan Targets preview using `effect id` wording
- guarded experimental fallback path
  - `basicToon`-only apply/revert
  - undo/revert support

#### Experimental

- `basicToon` is the only experimental apply path
- apply is debug-only and routes through controller guards only
- apply requires:
  - controller enabled
  - `mode === "apply"`
  - `experimentalApplyEnabled === true`
  - a valid apply plan
  - validation success
- apply remains blocked for:
  - non-`basicToon` presets
  - non-`single-global-effect` candidates
  - duplicate mesh targets

#### Unsupported / Intentionally Not Implemented

- arbitrary `.fx` rendering
- HLSL translation or execution
- Ray-MMD rendering
- `textureToon` / `emissiveLite` / `katameLike` apply
- automatic per-material effect binding
- broad renderer pipeline integration

#### Reviewer Guidance

- this PR is scaffold-first
- rendering parity is intentionally deferred
- review should focus on architecture, safety boundaries, disposal/undo behavior, and extensibility
- this PR should not be read as full MME support

#### Validation

- `npm.cmd run lint`
  - passed
  - `0 errors / 455 warnings`
- `node_modules\.bin\tsc.cmd --noEmit`
  - still fails due to existing repo-wide TypeScript errors outside this scaffold work
- targeted `Vitest`
  - could not run in this sandbox because of `spawn EPERM`
