# MME / Plugin Scaffold Status 2026-05-01

この文書は `feature/plugin-effect-api` ブランチ上の MME / plugin scaffold 現状メモです。
ファイル名は `2026-05-01` のままですが、内容は 2026-05-05 時点の実装状況まで更新している living memo として扱います。

## PR Summary

このブランチでは、`MMD_modoki` に対して以下の 2 系統を追加しています。

- read-only plugin / effect scaffold
- experimental MME compatibility pipeline

目的は、一般的な MME 描画互換を完成させることではなく、拡張境界と dry-run 中心の調査導線を reviewable な形で整えることです。

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
- read-only highlight plan scaffold
- guarded debug highlight via reusable `HighlightLayer`
  - selected precise/highlightable candidate only
  - `multi-global-effect` and `unmatched` stay blocked
  - same controller / same scene では `HighlightLayer` を再利用
- MME file picker entry point
- dry-run preview toggle

### Guarded Apply / Revert Debug UI

- guarded Apply / Revert debug UI
- apply は controller API 経由のみ
- apply は experimental / debug-only
- apply は `basicToon` のみ
- apply は `matchingPolicy === "single-global-effect"` のみ
- duplicate mesh target は block
- revert は original material を復元
- revert は owned fallback material を disposal helper 経由で破棄

## NOT IMPLEMENTED

現時点で intentionally 未実装:

- `textureToon` apply
- `emissiveLite` apply
- `katameLike` apply
- arbitrary `.fx` apply
- broad material replacement
- general MME shader execution
- HLSL-to-GLSL / WGSL translation
- multipass / render-target-heavy effect support
- Ray-MMD rendering
- broad renderer pipeline integration
- no production/high-fidelity highlight system
- no camera jump / focus to target
- no material-based highlight effect

この scaffold は full MME support でも Ray-MMD support でもありません。rendering parity も主張しません。

## Safety Guarantees

### Preview / Debug

- preview は dry-run
- candidate view は read-only
- guarded debug highlight exists, but remains debug-only and non-destructive
- preview / candidate / highlight は scene / material / mesh / camera を mutate しない
- highlight は `mesh.material` を変更しない
- highlight は material color / property を変更しない
- highlight は camera を動かさない
- highlight は apply / revert を trigger しない
- `clearHighlight()`, preview disable, manifest clear, controller dispose で highlight state は安全に cleanup される

### Apply

apply は controller 側で明示ガードされ、UI 条件とは別に再検証されます。

- controller enabled
- `mode === "apply"`
- `experimentalApplyEnabled === true`
- valid apply plan
- controller validation success

strict apply limits:

- `basicToon` only
- `single-global-effect` only
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

## Current Experimental Apply Scope

現在の apply は strictly limited な safety experiment です。

- debug-only
- experimental
- undoable
- `basicToon` only
- `single-global-effect` only

一般的な MME fallback apply や arbitrary `.fx` の反映を意味しません。

## Validation Status

2026-05-05 時点の確認:

- `npm.cmd run lint`
  - success
  - `0 errors / 455 warnings`
- `node_modules\.bin\tsc.cmd --noEmit`
  - fail
  - 既存の repo-wide TypeScript errors によるもの
- targeted `Vitest`
  - この sandbox 環境では `spawn EPERM`

## Next Steps

- Step 43: apply plan target list の read-only subview
- target-to-effect association precision の改善
- `textureToon` を同じ gate の下で試すかどうか再評価
- Ray-MMD は別トラックを作らない限り unsupported のまま維持

## Non-goals

この scaffold は以下をまだ提供しません。

- general MME rendering compatibility
- arbitrary `.fx` application
- Ray-MMD support
- renderer parity
- production-ready material replacement system

## PR Description

### Title

Add plugin/effect scaffold and experimental MME compatibility pipeline

### Copy-paste-ready PR description

#### Summary

This PR adds a read-only plugin/effect scaffold and an experimental MME compatibility pipeline to `feature/plugin-effect-api`.

The goal is to create reviewable extension points and a safe investigation path for MME-style effects without claiming general MME rendering support.

#### What changed

- added a read-only `PluginHost` with scene lifecycle and asset hooks
- added a minimal plugin UI registry
- wrapped the existing luminous/glow behavior as an internal effect adapter
- added MME file discovery and manifest loading for `.x`, `.fx`, `.fxsub`, and `.conf`
- added a partial `.fx` structural parser and effect analyzer
- added fallback preset planning and a fallback material factory scaffold
- added a dry-run preview/apply controller with experimental gating
- added a read-only candidate view with filter/sort/selection/detail/highlight-plan scaffolding
- added guarded, non-destructive debug candidate highlighting through a reusable `HighlightLayer`
- added guarded debug-panel Apply/Revert wiring for a very limited fallback path

#### Safety boundaries

- this is not full MME support
- Ray-MMD is not supported
- arbitrary `.fx` rendering is not supported
- HLSL translation/execution is not implemented
- preview remains dry-run by default
- debug highlight is non-destructive and controller-guarded
- debug highlight only activates for selected precise/highlightable candidates
- debug highlight does not mutate `mesh.material`, material properties, or camera state
- UI apply routes through the controller only; there is no bypass path
- apply is limited to experimental `basicToon` only
- apply requires:
  - controller enabled
  - `mode === "apply"`
  - `experimentalApplyEnabled === true`
  - a valid apply plan
  - controller validation success
- apply is blocked for:
  - non-`basicToon` presets
  - non-`single-global-effect` candidates
  - duplicate mesh targets
- apply is undoable; revert restores the original material and disposes the owned fallback material

#### Current limitations

- no general material replacement pipeline
- no `textureToon`, `emissiveLite`, or `katameLike` apply path
- no arbitrary shader execution
- no production/high-fidelity highlight system
- no camera focus/jump-to-target workflow
- no material-based highlight rendering path
- no broad renderer pipeline integration
- no rendering parity claim with MME or Ray-MMD
- most of the MME path is still investigation/debug scaffold rather than production behavior

#### Validation

- `npm.cmd run lint`
  - passed
  - `0 errors / 455 warnings`
- `node_modules\.bin\tsc.cmd --noEmit`
  - still fails due to existing repo-wide TypeScript errors outside this scaffold work
- targeted `Vitest`
  - could not run in this sandbox because of `spawn EPERM`

#### Next steps

- add a read-only apply-plan target list in the debug panel before broader apply work
- improve target-to-effect association precision
- decide whether `textureToon` is safe to prototype behind the same gate
- keep Ray-MMD explicitly unsupported unless a separate design/validation track is created
