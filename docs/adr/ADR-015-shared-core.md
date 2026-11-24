# ADR-015: 言語非依存の共通コア（src/core/）を切り出す

## ステータス

採択済み（2026-11-24）。作業ブランチ `feature/interp-core` で実装。main（master）へのマージは、JSVisualizer・BhvVisualizer を使う授業の学期後（2027年2月以降）とする。

## コンテキスト

JSVisualizer の Python 版 [PyVisualizer](https://github.com/tntetsu/PyVisualizer)（将来は C++・Java も）を作るにあたり、評価器は言語ごとに書くが、実行状態を配列に記録する仕組み（Recorder）、ステップ操作（JSDebugger）、TraceEvent の形式は全言語で共通にする方針になった（PyVisualizer の `docs/development-plan.md`・ADR-001）。

PyVisualizer の Phase 0（スパイク）で、JSInterpreter を改変せずに Python の評価器から使ったところ、次の回避策が必要だった（PyVisualizer `docs/phase0-report.md` 3.2 節）。

- `JSDebugger` のコンストラクターが中で JS をパースするので、`fromTrace()` で作ったインスタンスのプロトタイプを差し替えた
- `Environment` の `get`/`set` が JS の規則（const・TDZ・エラー文言）を持つので、`bindings` を直接操作した
- `Recorder.captureLog` が JS の書式で整形し端末にも出力するので、派生クラスで上書きした
- `consoleLogs` が 1 行 1 件なので、Python の `print(x, end=" ")` を表せなかった
- `deepClone` が言語ごとの値の印（Python の tuple の目印など）を落とした
- humanStep の停止点の規則が JS の nodeType 名を直接参照しているので、他の言語の構文（Python の `for x in` の各回）で止められなかった

## 決定

言語に依存しない部品を `src/core/` に切り出し、`js-interpreter/core` として公開する（`package.json` の `exports`）。

| ファイル | 中身 |
|---|---|
| `signals.js` | `ReturnSignal`・`BreakSignal`・`ContinueSignal`・`ThrowSignal` |
| `clone.js` | `deepClone(val, seen, hook)`・`createCloner(hook)`。hook で言語ごとの値のクローン方法を足せる |
| `scope.js` | `Scope`（`bindings`・`parent`・`kind`・スナップショットだけ。参照・代入の規則は持たない） |
| `recorder.js` | `Recorder(maxSteps, { clone, formatLog, echo })`、出力の断片を記録する `write()`、`eventExtras()`、`joinConsoleLines()` |
| `trace-debugger.js` | `TraceDebugger`（トレースを受け取るだけのデバッガー。ステップ操作・humanStep）、`ExecutionError`、`finalizePartialTrace()` |

humanStep の停止点は、nodeType 名の代わりに「役割ごとの nodeType の一覧」（`static nodeCategories`：`stopOnExit`・`call`・`block`・`branch`・`condLoop`・`forLoop`・`forInit`・`exprStmt`）で決める。規則そのもの（①〜⑥b）は変えない。

JS の部品はコアの派生クラスにする。外から見える名前・import 先・挙動は変えない。

- `Recorder`（interpreter.js）：コアの `Recorder` に、`formatLogArg` での整形・端末への出力・`domSnapshot` を加える
- `Environment`（environment.js）：コアの `Scope` に、const・`getFunctionScope`・TDZ と未定義変数のエラーを加える。`deepClone` は再 export
- `JSDebugger`（debugger.js）：コアの `TraceDebugger` に、JS の実行・DOM モード・`JS_NODE_CATEGORIES` を加える。`ExecutionError` は再 export

## 挙動を変えていないことの確認

- 既存のテスト 266 件がそのまま通る（共通コアのテスト 18 件を追加し、計 284 件）
- master と作業ブランチの両方の `JSDebugger` で同じプログラムを実行し、全 TraceEvent・consoleLogs・humanStep の停止点・getResult・例外を比べた（PyVisualizer の `scripts/compare-js-core.mjs`）。対象は JSVisualizer の組み込みサンプルと記事の題材、examples、BhvVisualizer の授業の演習、エラー・上限超過・DOM モードなどの追加ケースの計 194 プログラム（約 24 万イベント）で、すべて一致した。スタックオーバーフローで止まるプログラムは、止まる深さが実行ごとに変わる（ADR-014）ため、共通の長さまでを比べた

## 結果

- 他の言語の評価器は `js-interpreter/core` だけを使えばよい。PyVisualizer の Python エンジンは、Phase 0 の回避策をすべて外してコアの API に乗せ換えた
- 既存の挙動を保つため、`console.log` の 2 番目以降の文字列の引数に引用符が付く挙動（`console.log(1, "a")` が `1 'a'` になる。`args.map(formatLogArg)` で配列の添字が depth として渡っていたため。Node.js では `1 a`）もそのまま残した。直すかどうかは別に判断する
- コアの `Recorder` は、既定では端末に出力しない（JS の `Recorder` は従来どおり出力する）
