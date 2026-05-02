# MME / Plugin Scaffold 現状メモ 2026-05-01

この文書は 2026-05-01 時点の整理メモとして作成し、2026-05-02 時点の内容で追記更新している。ファイル名は最初の作成日に合わせて据え置いている。

## PR サマリー

### 何が実装されたか

`feature/plugin-effect-api` では、MMD_modoki に対して read-only 前提の plugin / effect scaffold と、MME 互換調査用の dry-run パイプラインを追加した。

今回入っているのは、以下のような「拡張の土台」と「非破壊の調査導線」である。

- read-only `PluginHost`
- scene lifecycle hook
- model / accessory asset hook
- 最小 UI registry
- 既存 Glow / AutoLuminous-lite の internal adapter
- MME bundle manifest loader
- partial `.fx` structure parser
- parsed effect mapper / analyzer
- fallback preset planner
- fallback material factory scaffold
- preview / apply controller scaffold
- experimental apply gate
- scene material target candidate view
- candidate filter / sort / selection / detail view
- selected candidate 向け highlight plan scaffold

### 何が未実装か

今回の scaffold は、MME の完全対応でも shader 実行基盤でもない。

特に未実装なのは以下。

- 実際の fallback material 適用
- `mesh.material` の差し替え
- MME shader の実行
- HLSL-to-GLSL / WGSL translation
- multipass / render target effect の実行互換
- Ray-MMD 対応
- 実際の mesh highlight
- apply / revert の本実装

### Safety Guarantees

現時点の MME / plugin scaffold は、意図的に non-mutating である。

- preview は dry-run のみ
- scene / material / mesh / camera を自動変更しない
- `mesh.material` を書き換えない
- material apply を自動実行しない
- shader を compile / translate / execute しない
- experimental apply gate は default で `false`
- apply path は gate が開いていても `apply-not-implemented` を返す

### なぜ apply を gate しているか

MME 互換は、材質差し替え・shader 差し替え・render state の扱いを間違えると、既存の MMD ワークフローを壊しやすい。

そのため、現段階では以下を優先している。

- まず file discovery と `.fx` 構造把握を安定化する
- 次に fallback 候補を dry-run で可視化する
- 最後に scope を狭くした apply を opt-in で検討する

つまり、apply gate は「未完成な apply を accidental に有効化しないため」の明示的な安全装置である。

## マイルストーン要約

### Step 1-5

- Step 1: `PluginHost` / plugin 型 / no-op registry を追加
- Step 2: scene lifecycle hook を `MmdManager` に配線
- Step 3: model / accessory load hook を配線
- Step 4: shared material target helper を追加
- Step 5: 既存 luminous glow を internal `EffectPlugin` adapter として包んだ

### Step 6-10

- Step 6: plugin panel 用の最小 UI registry を追加
- Step 7: internal `mme-compat-manifest` plugin を追加し、MME 関連 file discovery を実装
- Step 8: partial `.fx` structure parser を追加
- Step 9: parsed effect の mapper / analyzer を追加
- Step 10: fallback preset planner を追加

### Step 11-15

- Step 11: fallback material factory scaffold を追加
- Step 12: preview / apply controller scaffold を追加
- Step 13: debug panel を controller 中心の single source of truth に整理
- Step 14: apply transaction / revert scaffold を追加
- Step 15: internal MME file registration API を追加

### Step 16-20

- Step 16: registered file path normalization と root selection policy を明文化
- Step 17: debug panel に minimal file picker を追加
- Step 18: preview toggle を有効化し、dry-run preview を panel から明示制御できるようにした
- Step 19: duplicate だった dry-run preview computation を整理し、preview cleanup path を controller 側へ寄せた。dry-run / no-apply の挙動は維持した
- Step 20: experimental apply gate を追加

### Step 21-27

- Step 21: Apply Status 表示を gate 状態込みで整理
- Step 22: docs へ安全性と現状整理を追加
- Step 23: scene material target candidate view を追加
- Step 24: candidate filter / sort を追加
- Step 25: candidate selection / detail view を追加
- Step 26: selected candidate 向け highlight plan scaffold を追加
- Step 27: `MmeFallbackHighlightPlan.reason` を literal union に狭めた

## 現在のアーキテクチャ

### 1. PluginHost

対象:

- `src/plugin/plugin-types.ts`
- `src/plugin/plugin-host.ts`

役割:

- plugin registration / dispatch の最小土台
- callback へ渡す read-only runtime context の定義
- duplicate id reject
- hook dispatch の例外隔離

### 2. Lifecycle / Asset Hooks

対象:

- `src/mmd-manager.ts`
- `src/assets/model-asset-service.ts`
- `src/mmd-manager-x-extension.ts`

役割:

- scene ready / before render / after render / dispose
- model loaded / accessory loaded

### 3. UI Registry

対象:

- `src/plugin/ui-registry.ts`
- `src/ui-controller.ts`

役割:

- plugin panel 用の最小 mount point
- 既存 UI を壊さず panel を差し込むための extension point

### 4. Internal Luminous Adapter

対象:

- `src/plugin/internal-luminous-glow-effect.ts`
- `src/scene/material-shader-service.ts`

役割:

- 既存 glow 実装を plugin/effect API 上で扱えることの実証
- glow 実装そのものは再実装しない

### 5. MME Manifest Loader

対象:

- `src/plugin/mme-compat-manifest.ts`
- `src/plugin/internal-mme-compat-manifest-plugin.ts`

役割:

- `.x` / `.fx` / `.fxsub` / `.conf` の発見
- include graph
- missing file / warning 管理
- same-name `.x -> .fx` discovery

### 6. Partial .fx Parser

対象:

- `src/plugin/mme-fx-parser.ts`

役割:

- `.fx` / `.fxsub` から高レベル構造だけを抽出
- `#include`
- parameter / uniform
- texture / sampler
- technique / pass
- `VertexShader` / `PixelShader`

### 7. Mapper

対象:

- `src/plugin/mme-effect-mapper.ts`

役割:

- parsed effect を `parsed` / `partiallyMapped` / `unsupported` / `failed` に分類
- material-like field を保守的に抽出

### 8. Planner

対象:

- `src/plugin/mme-fallback-preset-planner.ts`

役割:

- `basicToon`
- `textureToon`
- `katameLike`
- `emissiveLite`
- `unsupported`

への fallback 推奨を dry-run で決める。

### 9. Factory

対象:

- `src/plugin/mme-fallback-material-factory.ts`

役割:

- fallback preset ごとの material scaffold 作成可否を dry-run 判定
- `basicToon` / `textureToon` / `emissiveLite` は safe scaffold 寄り
- `katameLike` は現状 unsupported

### 10. Preview / Apply Controller

対象:

- `src/plugin/mme-fallback-controller.ts`

役割:

- preview plan 構築
- apply transaction scaffold
- target candidate view 構築
- highlight plan scaffold
- experimental apply gate 管理

### 11. Candidate View / Highlight Plan

対象:

- `src/plugin/internal-mme-compat-manifest-plugin.ts`
- `src/plugin/material-targets.ts`

役割:

- scene material target を read-only candidate として列挙
- filter / sort / selection / detail
- selected candidate から highlight plan を作る

ただし highlight plan は「将来のための計画」であり、実際の highlight はまだしない。

## NOT IMPLEMENTED

以下は明示的に未実装である。

- real material replacement
- `mesh.material` assignment
- non-dry-run fallback apply
- undo / revert の実動作
- MME shader execution
- HLSL translation
- render target dependency 解決
- Ray-MMD support
- real mesh highlight
- camera focus / jump

## Safety Guarantees

実装済み scaffold が守るべき安全条件は以下。

- dry-run only を基本とする
- preview は read-only
- apply は未実装
- scene mutation は行わない
- explicit future implementation と experimental gate の両方が揃わない限り apply しない
- `experimentalApplyEnabled` は default `false`
- clear / dispose 時に preview / apply plan / gate / selection を安全に落とす

## 検証状況

2026-05-02 時点の確認結果:

- `npm.cmd run lint`
  - 通過
  - `0 errors / 455 warnings`
- `node_modules\.bin\tsc.cmd --noEmit`
  - 失敗
  - 既存の repo-wide TypeScript error による
- targeted `Vitest`
  - この sandbox では `spawn EPERM` により実行不可

このため、現状の品質表現は「lint は通るが、repo 全体の TypeScript 健全性とテスト実行環境は別課題が残っている」が正確である。

## 次の候補

### Step 29

非常に限定した `basicToon` apply を gate 配下で試す。

条件:

- 明示 opt-in
- 対象を狭く限定
- 既存材質への復帰手段を先に整理

### Step 30

undo transaction の本実装。

- original material reference の保存
- created fallback material ownership の管理
- revert path の明示

### Step 31

optional な real highlight 実装。

ただし以下が前提。

- highlight する対象 mesh の同定精度
- scene mutation の scope 制御
- UI から accidental に走らない設計

### Step 32+

advanced fallback / partial material replacement の検討。

候補:

- `textureToon` の限定 apply
- emissive 系の限定 apply
- per-material binding の改善

### Ray-MMD について

Ray-MMD は引き続き unsupported として扱う。

現段階では:

- parity を目標にしない
- stress-test / research 対象としてのみ扱う
- core MMD workflow より優先しない

## PR 用説明文たたき台

This PR adds a read-only plugin/effect scaffold and an experimental MME compatibility investigation pipeline to `feature/plugin-effect-api`.

Implemented:

- read-only plugin host and lifecycle hooks
- model/accessory asset hooks
- minimal plugin UI registry
- internal luminous glow adapter
- MME manifest discovery and partial `.fx` structural parsing
- effect analysis, fallback preset planning, and dry-run material factory scaffolding
- preview/apply controller scaffolding with an experimental apply gate
- read-only scene material candidate view with filter/sort/selection/detail and highlight-plan scaffolding

Not implemented:

- real material application
- `mesh.material` replacement
- shader execution or translation
- Ray-MMD support
- real highlight/apply/revert behavior

Safety:

- preview is dry-run only
- no scene/material/mesh/camera mutation
- apply is still stubbed and additionally gated behind an explicit experimental flag that defaults to false

This PR is intended to make the scaffold reviewable and extensible before any real fallback material application is attempted.
