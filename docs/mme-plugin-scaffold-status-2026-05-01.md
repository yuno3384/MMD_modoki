# MME / Plugin Scaffold 状態メモ 2026-05-01

この文書は `feature/plugin-effect-api` ブランチ上の MME / plugin scaffold の現状メモです。
ファイル名は `2026-05-01` のままですが、内容は 2026-05-04 時点まで更新している living memo として扱います。

## PR 要約

このブランチでは、MMD_modoki に対して次の 2 系統を段階的に追加しています。

- read-only な plugin / effect scaffold
- 実験的な MME compatibility 調査・dry-run・限定 apply 導線

目的は、いきなり一般的な MME 描画互換を実装することではなく、
既存ランタイムを大きく壊さずに次の検証土台を作ることです。

- plugin host と hook 境界の明確化
- MME 関連ファイルの discovery / parser / analyzer の足場作り
- fallback material 適用前の dry-run 可視化
- strict gate 付きの最小 apply / revert 実験

## 実装済み

### Plugin / Effect Scaffold

- read-only `PluginHost`
- scene lifecycle hook
- model / accessory asset hook
- minimal UI registry
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
- MME file picker entry point
- dry-run preview toggle

### Guarded Apply / Revert Debug UI

- guarded Apply / Revert debug UI が存在する
- apply は controller API 経由のみで実行される
- apply は `basicToon` に限定
- `matchingPolicy === "single-global-effect"` が必須
- duplicate mesh target は block
- revert は original material を復元する
- revert は owned fallback material を dispose helper 経由で破棄する

## NOT IMPLEMENTED

次はまだ未実装です。

- `textureToon` apply
- `emissiveLite` apply
- `katameLike` apply
- arbitrary `.fx` apply
- broad material replacement
- general MME shader execution
- HLSL-to-GLSL / WGSL translation
- multipass / render-target-heavy effect 実行
- Ray-MMD rendering
- broad renderer pipeline integration
- real mesh highlight
- camera jump / focus

このブランチは、一般的な MME rendering support や Ray-MMD support を提供するものではありません。

## Safety Guarantees

### Preview / Debug

- preview は dry-run
- candidate view は read-only
- highlight plan は scaffold のみ
- preview / candidate / highlight 表示は scene / material / mesh / camera を mutate しない

### Apply

apply は完全に自由ではなく、次の条件を全部満たしたときだけ controller 側で許可されます。

- controller enabled
- `mode === "apply"`
- `experimentalApplyEnabled === true`
- valid apply plan が存在
- controller validation を通過

controller validation では UI 条件を再チェックします。UI で誤って button が有効に見えても、controller が最終ガードです。

追加の strict limit:

- `basicToon` のみ
- `single-global-effect` のみ
- duplicate mesh target は block
- partial apply は許可しない

UI から controller を bypass する apply path は入れていません。

## Milestone Summary

### Step 1-5

- Step 1: `PluginHost` / plugin types / no-op registry
- Step 2: scene lifecycle hook を `MmdManager` に配線
- Step 3: model / accessory load hook を配線
- Step 4: shared material target helper を追加
- Step 5: luminous glow を internal `EffectPlugin` adapter 化

### Step 6-10

- Step 6: plugin panel 用の minimal UI registry
- Step 7: internal `mme-compat-manifest` plugin と file discovery
- Step 8: partial `.fx` structure parser
- Step 9: parsed effect mapper / analyzer
- Step 10: fallback preset planner

### Step 11-15

- Step 11: fallback material factory scaffold
- Step 12: preview / apply controller scaffold
- Step 13: debug panel の preview source を controller に集約
- Step 14: apply transaction / revert scaffold
- Step 15: internal MME file registration API

### Step 16-20

- Step 16: registered file path normalization と root selection policy
- Step 17: debug panel の minimal file picker
- Step 18: preview toggle を panel から有効化
- Step 19: duplicate な dry-run preview computation を整理し、preview cleanup path を統一
- Step 20: experimental apply gate

### Step 21-27

- Step 21: Apply Status 表示の gate 反映
- Step 22: scaffold status docs 整備
- Step 23: scene material target candidate view
- Step 24: candidate filter / sort
- Step 25: candidate selection / detail view
- Step 26: selected candidate 用 highlight plan scaffold
- Step 27: `MmeFallbackHighlightPlan.reason` の literal union 化

### Step 28-35

- Step 28: PR / milestone documentation 整備
- Step 29: skipped
- Step 30: undoable `basicToon` apply 実装
- Step 31: fallback material disposal helper への cleanup 統一
- Step 32: disposal helper dual-input contract の文書化
- Step 33: guarded Apply / Revert debug UI 配線
- Step 34: Apply Status を `getApplyAvailability()` 表示に整合
- Step 35: `getApplyAvailability()` の result field を `enabled` から `available` へ rename

## 現在の限定 apply の意味

今の apply は「一般的な MME fallback apply」ではなく、strictly limited な safety experiment です。

- debug-only
- experimental
- undoable
- `basicToon` only
- single-global-effect only

つまり、「ごく狭い条件で元に戻せる material 置換を通せるか」を見るための段階です。

## Validation Status

2026-05-04 時点の確認結果:

- `npm.cmd run lint`
  - success
  - `0 errors / 455 warnings`
- `node_modules\.bin\tsc.cmd --noEmit`
  - fail
  - 既存 repo-wide TypeScript errors が残っている
- targeted `Vitest`
  - この sandbox では `spawn EPERM` で実行できない

このため、現時点の健全性確認は主に changed-file lint と repo-wide lint success を基準にしています。

## 次の候補

### Step 36

- apply plan 対象の read-only 一覧を debug panel に追加
- Apply 前に「どの mesh / material が置換対象か」を明示

### Step 37 以降の候補

- `basicToon` apply の UI 側説明強化
- real undo transaction 表示の追加
- `textureToon` の可否検討
  - ただし strict gate 維持前提
- per-material binding 精度の改善

## 明示的に主張しないこと

この scaffold は次を主張しません。

- 一般的な MME rendering compatibility
- arbitrary `.fx` application
- Ray-MMD support
- renderer parity
- production-ready material replacement system

現状は、MMD_modoki の既存描画系を大きく壊さずに、
plugin 境界・MME 調査・dry-run・限定 apply 実験を reviewable に保つことを優先しています。
