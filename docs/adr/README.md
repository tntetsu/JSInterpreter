# JSInterpreter — アーキテクチャ決定記録（ADR）

このディレクトリには、JSInterpreterの設計で行った重要な決定を記録した
ADR（Architecture Decision Record）が含まれています。

2026-08-10に、開発者の別PCに保管されていたClaude Codeセッションログ
（プロジェクト開始日 2026-05-23〜24 の生ログ）を発掘し、そこから復元
できた意思決定をADR-001〜005として記録しました。プロジェクトの残り
コミット（2026-05-26〜2026-08-05）については、対応するセッションログが
失われているため、姉妹プロジェクト（JSVisualizer・WebJSVisualiser）側の
ADR・CLAUDE.mdの記述と日付を突き合わせて再構成しました（ADR-006〜011）。
後者は前者に比べて確度が低いことに注意してください（各ADRの「一次資料に
ついての注記」参照）。

なお、2026-06-04のsuper()呼び出し修正・console.log表示調整、2026-06-12の
用語統一・スケルトン生成対応など、一部のコミットはADR化を見送っています
（JSVisualizer側の運用に倣い、規約確立や外部依存プロジェクトへの影響を
伴わない小規模な修正はCLAUDE.md相当の記述に留める方針）。

詳しい調査の経緯・手法上の限界については、姉妹プロジェクト
[agentic-coding-notes](https://github.com/tntetsu/agentic-coding-notes)の
`docs/agentic-coding/01-workflow.md`「手法上の限界」節を参照してください。

## 一覧

| No. | タイトル | 決定日 | 確度 |
|-----|---------|--------|------|
| [001](ADR-001-omniscient-debugging.md) | オムニシエントデバッグ方式と4操作ステップAPI | 2026-05-23 | 高（セッションログ確認済み） |
| [002](ADR-002-deep-clone-snapshot.md) | スナップショットのディープクローン化 | 2026-05-24 | 高（セッションログ確認済み） |
| [003](ADR-003-humanstep.md) | humanStep / humanStepBack（人間にやさしいステップ実行） | 2026-05-24 | 高（セッションログ確認済み） |
| [004](ADR-004-esm-migration.md) | CommonJS + esbuild から ES Modules への移行 | 2026-05-24 | 高（セッションログ確認済み） |
| [005](ADR-005-codetrace-line-linked-table.md) | CodeTrace — ソースコード行に連動するアニメーショントレース表 | 2026-05-24 | 高（セッションログ確認済み） |
| [006](ADR-006-frameenvs-and-ast-exposure.md) | frameEnvsの記録とAST公開（lexical scope対応） | 2026-06-04 | 中（姉妹プロジェクトADRとの日付一致） |
| [007](ADR-007-error-classification-and-host-exception.md) | エラー分類の統一とtry-catchホスト例外変換 | 2026-06-15 | 中（姉妹プロジェクトADRとの日付一致） |
| [008](ADR-008-es2022-semantics-and-weakmap-fix.md) | var/let/constのES2022準拠とWeakMap共有バグ修正 | 2026-06-16 | 中〜高（修正箇所まで明記されたADR-019フォローアップ記述あり） |
| [009](ADR-009-signal-unwrap-and-destructuring.md) | ReturnSignal/ThrowSignalのunwrapと分割代入サポート | 2026-05-26 | 中（一部は時間差8分の強い相関、一部は低確度） |
| [010](ADR-010-virtualdom-support.md) | VirtualDOMサポートの追加（WebJSVisualiser向け拡張） | 2026-06-12 | 中（姉妹プロジェクトADRとの相互参照あり） |
| [011](ADR-011-callexpression-receiver-fix.md) | CallExpressionのレシーバー二重評価とゲスト関数のネイティブ呼び出し修正 | 2026-08-05 | 高（JSVisualizer CLAUDE.mdに同日・同内容の記述） |
| [012](ADR-012-strict-mode-numeric-literals.md) | 0始まりの数値リテラルと8進数エスケープをstrictモードと同じく構文エラーにする | 2026-10-05 | 高（決定と同時に作成） |
| [013](ADR-013-caller-frame-variables.md) | 呼び出し元のフレームに、呼び出した地点から見える変数を記録する | 2026-11-04 | 中（姉妹プロジェクトの表示に影響） |
