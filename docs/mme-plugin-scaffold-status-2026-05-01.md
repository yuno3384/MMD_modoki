# MME / Plugin Scaffold 現状メモ 2026-05-01

## 目的

このメモは、`feature/plugin-effect-api` ブランチ上で段階的に追加した
plugin / effect API と MME 互換 scaffold の現状をまとめるものです。

現段階の主目的は次の 3 点です。

- 将来の MME 互換実装に向けた接続点を明確にする
- 既存 runtime を壊さず dry-run 中心の調査導線を用意する
- 材質適用や shader 実行の前に、安全境界を文書化する

この段階では、`実際の fallback 材質適用` や `MME shader 実行` はまだ実装していません。

## 現在の構成

### 1. PluginHost

関連ファイル:

- `src/plugin/plugin-types.ts`
- `src/plugin/plugin-host.ts`

read-only 前提の `PluginHost` / `PluginContext` と、no-op safe な registry を持つ。

現状の役割:

- plugin 登録と解除
- scene lifecycle hook 発火
- asset hook 発火
- plugin callback の例外隔離

制約:

- plugin callback へ mutable な host 操作 API は渡さない
- `registerPlugin()` は duplicate id を reject する

### 2. Scene lifecycle hooks

関連ファイル:

- `src/mmd-manager.ts`

接続済み hook:

- `emitSceneReady()`
- `emitBeforeRender()`
- `emitAfterRender()`
- `emitDispose()`

方針:

- 既存 render loop や scene 初期化順を大きく変えず、将来 plugin が差し込める境界だけを作る

### 3. Asset hooks

関連ファイル:

- `src/assets/model-asset-service.ts`
- `src/mmd-manager-x-extension.ts`

接続済み hook:

- `emitModelLoaded()`
- `emitAccessoryLoaded()`

渡している情報:

- source path
- root node
- mesh references
- material list
- model / accessory kind

### 4. UI registry

関連ファイル:

- `src/plugin/ui-registry.ts`
- `src/ui-controller.ts`

最小の plugin UI 登録面を用意している。

現状の登録面:

- `registerPanel()`
- `registerToolbarAction()` は registry のみ
- `registerInspectorSection()` は registry のみ

実際に mount しているのは panel のみ。

### 5. Internal luminous glow adapter

関連ファイル:

- `src/plugin/internal-luminous-glow-effect.ts`
- `src/mmd-manager.ts`
- `src/scene/material-shader-service.ts`

既存の Glow / AutoLuminous-lite 相当挙動を再実装せず、internal `EffectPlugin` adapter で包んでいる。

意図:

- plugin/effect API が既存 effect を host できることの確認
- 既存 glow 実装の複製を避ける

### 6. MME manifest loader

関連ファイル:

- `src/plugin/mme-compat-manifest.ts`
- `src/plugin/internal-mme-compat-manifest-plugin.ts`

役割:

- `.x` / `.fx` / `.fxsub` / `.conf` の登録
- include path 探索
- same-name `.x -> .fx` 発見
- texture candidate 列挙
- missing file / warning 集約

root 選択ポリシー:

- `.x` があれば優先
- なければ最初の `.fx`
- 次に `.fxsub`
- 最後に `.conf`

### 7. Partial .fx parser

関連ファイル:

- `src/plugin/mme-fx-parser.ts`

現状 parse しているもの:

- `#include`
- parameter / uniform の一部
- texture declaration
- sampler / sampler2D
- annotation
- semantic
- technique / pass
- `VertexShader`
- `PixelShader`
- 一部 render target 記述

現状やっていないもの:

- HLSL 翻訳
- shader compile
- shader 実行

### 8. Mapper

関連ファイル:

- `src/plugin/mme-effect-mapper.ts`

`MMEEffectIR` を保守的に解析し、次を返す。

- support status
- mapped material-like fields
- unsupported features
- warnings

status:

- `parsed`
- `partiallyMapped`
- `unsupported`
- `failed`

### 9. Fallback preset planner

関連ファイル:

- `src/plugin/mme-fallback-preset-planner.ts`

解析結果から、将来どの fallback preset が候補かだけを決める。

preset:

- `none`
- `basicToon`
- `textureToon`
- `katameLike`
- `emissiveLite`
- `unsupported`

この時点では material 作成も適用もしない。

### 10. Fallback material factory scaffold

関連ファイル:

- `src/plugin/mme-fallback-material-factory.ts`

安全な Babylon material 作成経路を将来向けに準備している。

現状:

- dry-run が既定
- `basicToon`
- `textureToon`
- `emissiveLite`
  の scaffold 判定を持つ
- `katameLike` は未対応

重要点:

- mesh へは attach しない
- non-dry-run allocation は自動では行わない

### 11. Preview / apply controller

関連ファイル:

- `src/plugin/mme-fallback-controller.ts`

役割:

- preview plan の作成
- apply transaction plan の作成
- clear / dispose 管理
- 将来 apply / revert の安全境界を定義

default state:

- `enabled = false`
- `mode = "preview"`

現時点の apply は stub であり、実際の材質差し替えはしない。

### 12. Experimental apply gate

関連ファイル:

- `src/plugin/mme-fallback-controller.ts`
- `src/plugin/internal-mme-compat-manifest-plugin.ts`

`experimentalApplyEnabled` を追加済み。

目的:

- 将来 apply 実装を入れる前に、明示的 opt-in が必要な gate を先に固定する

default:

- `false`

現状:

- gate を ON にしても apply 自体は未実装
- debug panel 上でも `Apply Fallback (TODO)` は disabled のまま

## 安全チェックリスト

現段階の scaffold は、次の安全条件を前提にしている。

- 自動 material apply を行わない
- `mesh.material` を代入しない
- non-dry-run material allocation を自動では行わない
- shader を実行しない
- HLSL-to-GLSL/WGSL translation をしない
- Ray-MMD rendering をしない
- preview は dry-run のみ
- apply は未実装のまま blocked/unsupported を返す
- experimental apply gate の default は `false`
- manifest / preview / apply plan の clear は分離ではなく安全側に寄せて reset する

## 現在の UI 導線

MME debug panel では次が可能。

- `.x` / `.fx` / `.fxsub` / `.conf` の複数選択登録
- manifest summary 確認
- partial `.fx` parse 結果確認
- fallback preview の明示的 ON/OFF
- experimental apply gate の明示的 ON/OFF

ただし次はまだ不可。

- 実際の fallback material apply
- Apply button の有効化
- shader 実行結果の確認

## 検証状況

2026-05-01 時点の確認結果:

- `npm.cmd run lint`
  - `0 errors / 455 warnings`
  - warning は repo-wide 既存のものを含む
- `node_modules\.bin\tsc.cmd --noEmit`
  - 既存の repo-wide TypeScript error により失敗
  - この scaffold 追加だけが原因ではない
- `Vitest` の targeted test
  - この環境では `spawn EPERM` により実行不可
  - test file 自体は追加済みだが、sandbox 上の runtime 検証は未完了

## 現時点で未実装のもの

- real material assignment
- undo を伴う実 apply transaction
- per-material target への具体的 binding
- shader translation
- MME 固有 render state の再現
- multipass / render target effect の再現
- Ray-MMD compatibility

## 次の実装候補

### 1. MME bundle UX 改善

- bundle 単位の登録状態表示
- root 選択状態の UI 表示
- missing include / missing texture の見やすい表示

### 2. Material target との接続

- `material-targets.ts` ベースで scene 上の実材質と preview plan を結び付ける
- どの model / accessory material が候補かを read-only で見せる

### 3. 明示的 apply 実装

条件:

- experimental gate のまま
- narrow scope
- undo plan を先に詰める

最初の対象候補:

- `basicToon`
- `textureToon`

### 4. Undo transaction 実装

- original material の退避
- created fallback material の ownership
- revert path の明確化

### 5. Ray-MMD 方針整理

現時点では unsupported のままにする。

扱うとしても:

- stress-test / research 扱い
- 一般 fallback と混ぜない

## 判断メモ

現 scaffold は、`MME を動かす` 段階ではなく、`MME を安全に調査し将来の適用境界を作る` 段階として読むべきです。

このため、apply がまだ未実装であること、dry-run に寄せていること、preview を明示的 opt-in にしていることは、欠落ではなく現段階の安全設計です。
