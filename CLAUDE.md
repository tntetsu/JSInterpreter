# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

JavaScript で書かれた JavaScript インタープリターです。モダンな ES6+ 構文をターゲットとし、**ツリーウォーク** 実行戦略を採用しています。ソーステキストをトークンにスキャンし、AST に解析した後、AST ノードを直接評価します（バイトコードコンパイルステップなし）。

## コマンド

```bash
# 依存関係のインストール
npm install

# 全テストの実行（ES modules のため npx jest は直接使用不可）
npm test

# 単一テストファイルの実行
node --experimental-vm-modules node_modules/.bin/jest src/parser/parser.test.js

# 名前パターンに一致するテストの実行
node --experimental-vm-modules node_modules/.bin/jest -t "binary expression"

# ウォッチモードでテストを実行
npm run test:watch

# JS ファイルでインタープリターを実行
node src/index.js <file.js>

# REPL の起動
node src/index.js

# 対話型デバッガーを起動（ステップ実行）
node src/index.js --debug <file.js>

# Web UI（CodeTrace）用バンドルのビルド
npm run build:web

# Web UI 開発サーバーの起動（ファイル変更を監視）
npm run dev:web
```

> **注意**：プロジェクトは `"type": "module"` で ES modules を使用しているため、テストは必ず `npm test` 経由で実行すること（`npx jest` 単体では `Cannot use import statement outside a module` エラーになる）。

## アーキテクチャ

パイプラインは4つのステージで構成され、それぞれ独自のディレクトリに収められています：

```
src/
  errors.js   → 共通エラークラス（循環依存回避のため独立）
  lexer/      → レキサー（ソース文字列 → トークンストリーム）
  parser/     → パーサー（トークンストリーム → AST）
  interpreter/→ 評価器（AST → ランタイム値）、デバッガー、環境
  index.js    → エントリポイント：REPL・ファイル実行・デバッガー UI
web/
  app.js              → CodeTrace UI（ブラウザ向けステップ実行 UI）
  interpreter.bundle.js → esbuild でバンドルした debugger.js（git 管理外）
```

### エラークラス（`src/errors.js`）

`LexError`・`ParseError`・`RuntimeError` の3クラスを定義する独立モジュール。レキサー・パーサー・インタープリターが相互に参照すると循環依存が発生するため、このファイルに集約している。各クラスはプレフィックス付きメッセージと位置情報（`line`/`column` または `loc`）を持つ。

### レキサー（`src/lexer/`）

生のソーステキストを `Token` オブジェクトのフラットなリストに変換します。各トークンは `type`（`TokenType` 列挙型から）、`lexeme` 文字列、ソース `line` 番号を持ちます。

### パーサー（`src/parser/`）

トークンリストを消費して AST を生成する再帰下降パーサーです。各文法規則はメソッドに対応します（例：`parseExpression`、`parseStatement`）。AST ノードは `type` フィールドを持つプレーンな JS オブジェクトです（例：`{ type: 'BinaryExpression', operator, left, right }`）。

処理すべき主要な ES6+ 構文：`let`/`const`/`var`、アロー関数、クラス、分割代入、テンプレートリテラル、スプレッド/レスト、`for…of`、`import`/`export`（モジュールがスコープに入っていない場合は静的解析のみ）。

### インタープリター / 評価器（`src/interpreter/interpreter.js`）

AST を再帰的にウォークします。主要な概念：

- **`run(source)`** — ソース文字列を受け取り最終値を返す便利関数。
- **`evaluate(node, env, recorder, depth, callDepth)`** — 中央のディスパッチ関数が `node.type` で分岐し、JS ランタイム値を返します。`recorder` が `null` の場合は通常実行（記録なし）。
- **`createGlobalEnv(recorder?)`** — `console` などの組み込みを持つグローバル環境を生成。`recorder` を渡すと `console.log` が横取りされ `Recorder.consoleLogs` に記録される。
- **制御フローシグナル** — `return`/`break`/`continue`/`throw` は例外ではなく専用クラス（`ReturnSignal`・`BreakSignal`・`ContinueSignal`・`ThrowSignal`）として throw され、適切なノードでキャッチされます。
- **`Recorder`** — `evaluate` に渡すと全ノードの `enter`/`exit` イベントを `trace` 配列に記録します。`JSDebugger` のオムニシェント・デバッグ基盤。

### 環境（`src/interpreter/environment.js`）

- **`Environment`** — スコープの連結リスト。各インスタンスは `Map<string, value>` と外側スコープへのポインターを持ちます。変数ルックアップはチェーンをたどります。`snapshot()` でスコープ全体のディープクローンを返し、ステップバック時の状態再現に使用されます。
- **`deepClone(val)`** — スナップショット用ディープクローン。`JSFunction`/`JSClass` は参照保持、ネイティブ組み込みオブジェクトも参照保持、循環参照は `WeakMap` で検出します。

### デバッガー（`src/interpreter/debugger.js`）

**スナップショット配列方式（オムニシェント・デバッグ）**：コンストラクターでプログラムを末尾まで実行し、全ノードの `TraceEvent` を `trace` 配列に収録。ステップ操作は配列 `cursor` の操作に還元され、stepBack が O(1) で実現されます。

| メソッド | 動作 |
|---------|------|
| `stepIn()` | 次のイベントへ（深さ問わず） |
| `stepOver()` | 現在の enter → 対応する exit へジャンプ |
| `stepOut()` | callDepth が下がる最初の exit へジャンプ |
| `stepBack()` | cursor-- |
| `humanStep()` | 宣言・代入・関数呼び出し等「意味のある変化点」へジャンプ |
| `continue(breakpoints)` | ブレークポイントまたは末尾まで実行 |

### ランタイム値の表現

- **プリミティブ**：ネイティブ JS 値（`number`/`string`/`boolean`/`null`）そのまま。
- **ボックス型**：`__type__` マーカーを持つプレーンオブジェクト。
  - `{ __type__: 'JSFunction', name, params, body, closure }` — ユーザー定義関数（定義時の `Environment` をクロージャとして保持）
  - `{ __type__: 'JSClass', name, methods, superClass }` — クラスディスクリプター
  - `{ __type__: '__instance__', __class__, ...props }` — クラスインスタンス
  - `{ __type__: 'JSPromise', status, value/reason }` — 同期シミュレーションの Promise

### CodeTrace Web UI（`web/`）

`JSDebugger` API を使ったブラウザ向けステップ実行ビジュアライザー。`npm run build:web` で `src/interpreter/debugger.js` を esbuild でバンドルし `web/interpreter.bundle.js` を生成、`web/index.html` から読み込む。

## 主要な慣習

- AST ノードはプレーンオブジェクト（クラスインスタンスではない）— シリアライズを簡単にするため。
- テストはカバー対象のソースファイルと同じ場所に配置（`lexer.test.js` は `lexer.js` の隣など）。
- スナップショットテストは避け、明示的な `expect(result).toBe(...)` アサーションを優先。

## コード変更時の必須手順

ソースコード（`src/` 以下）を変更した場合は、**必ず以下を両方実施すること**。

### 1. 回帰テストの実行

```bash
npm test
```

全 187 テストがパスすることを確認してからコミットする。テストが失敗した場合はコミットしない。

### 2. ドキュメントの更新

変更内容に応じて、以下のドキュメントを同じコミットで更新する：

| 変更の種類 | 更新対象 |
|-----------|---------|
| 新機能・API 変更 | `README.md` / `README.ja.md`（Features・Usage・API セクション） |
| 動作仕様の変更 | `docs/functional-specification.md` / `.ja.md` |
| 内部設計の変更 | `docs/detailed-design.md` / `.ja.md` |
| Web UI の変更 | `web/` ファイルと上記ドキュメントの § 6.4 / § 9 |
| テスト数の変更 | `README.md` のテスト数、`docs/detailed-design.md` の § 10 テスト設計、**このファイルのテスト数** |

ドキュメントは英語版と日本語版（`.ja.md`）を常にセットで更新する。
