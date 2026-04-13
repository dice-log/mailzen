# mailzen 実装計画書

## フェーズ 1: CI/CD（GitHub Actions）

### 方針
- main ブランチへの push で Cloudflare Workers に自動デプロイ
- Cloudflare API トークンを GitHub Secrets に設定

### タスク
- [x] `.github/workflows/deploy.yml` の作成
- [x] Cloudflare API トークンを GitHub Secrets に追加
- [x] デプロイワークフローの動作確認

---

## フェーズ 2: DB 基盤（D1）

### テーブル設計

**mail_accounts**
| カラム | 型 | 説明 |
|--------|-----|------|
| id | text | PK（UUID） |
| email | text | メールアドレス |
| provider | text | gmail / outlook / yahoo 等 |
| credentials | text | 認証情報（AES-GCM 暗号化） |
| created_at | text | ISO 8601 |

**mail_results**
| カラム | 型 | 説明 |
|--------|-----|------|
| id | integer | PK（autoincrement） |
| account_id | text | FK → mail_accounts.id |
| message_id | text | プロバイダー側のメッセージID |
| thread_id | text | スレッドID（リンク生成用） |
| sender | text | 送信者名 |
| subject | text | 件名 |
| category | text | important / newsletter 等 |
| summary | text | Gemini 生成の要約（個人情報除去済み） |
| suspicious | integer | フィッシング疑い（0 / 1） |
| processed_at | text | ISO 8601 |

### タスク
- [x] D1 データベース `mailzen-db` を作成
- [x] `mail_results` テーブルを作成
- [x] 処理結果を mail_results に保存する実装

---

## フェーズ 3: 複数アカウント対応（Queues 分散）

### 方針
- cron（15分間隔）で全アカウントを取得し、Cloudflare Queues にアカウント単位でメッセージを投入
- Consumer Worker がアカウントごとに独立して処理（subrequest 制限を回避）
- 認証情報は `ENCRYPTION_KEY`（wrangler secret）で AES-GCM 暗号化して D1 に保存
- プロバイダーごとにアダプターを実装（Gmail から開始）

### アーキテクチャ
```
cron (15分) → Producer: D1 から全アカウント取得 → Queue にアカウント ID を投入
                                                      ↓
                                          Consumer: アカウント単位で起動
                                            ├─ D1 から認証情報取得・復号
                                            ├─ OAuth トークン取得
                                            ├─ メール取得・Gemini 解析
                                            └─ D1 保存・ラベル付与
```

### スケール見通し

| 規模 | プラン | 月額 | 備考 |
|------|--------|------|------|
| 1〜50 アカウント | 無料 | $0 | Queue ops 10,000/日で収まる |
| 50 超 or 1分間隔 | 有料 | $5 | cron 間隔は wrangler.toml の1行変更で対応 |

### タスク
- [x] `mail_accounts` テーブルを D1 に作成
- [x] `mail_results` に `account_id` カラムを追加
- [x] 暗号化・復号化ユーティリティの実装（AES-GCM）
- [x] `ENCRYPTION_KEY` を wrangler secret に追加
- [x] Queues 設定（wrangler.toml + Producer 実装）
- [ ] Consumer Worker の実装
- [ ] プロバイダーアダプターのインターフェース設計
- [ ] Gmail アダプターのリファクタリング

---

## フェーズ 4: PWA フロントエンド（Cloudflare Pages）

### 画面構成
- **ホーム** — 要約一覧（カテゴリ・日時・要約）
- **フィルター** — カテゴリ別・日付別・アカウント別・プロバイダー別
- **詳細リンク** — 各プロバイダーのメールに飛ぶ

### タスク
- [ ] Cloudflare Pages プロジェクト作成
- [ ] mail_results を取得する API エンドポイント実装
- [ ] 要約一覧画面の実装
- [ ] フィルターの実装
- [ ] PWA 設定（manifest.json / Service Worker）
- [ ] プッシュ通知の実装（Web Push API）

---

## フェーズ 5: OAuth 登録フロー（将来）

- ユーザーが各プロバイダーのアカウントを登録できる UI
- OAuth フローを経て認証情報を取得・暗号化保存
- users テーブル追加によるマルチテナント対応

---

## 設計方針

- **持たない情報**: メール本文・添付ファイル
- **持つ情報**: 認証情報（暗号化）・メールID・カテゴリ・要約
- **個人情報保護**: 要約生成時に Gemini プロンプトで除去指示
- **重複処理防止**: 未読フラグを状態管理として利用
- **デプロイ**: GitHub Actions で main ブランチ push 時に自動デプロイ
- **プロバイダー**: Gmail から始めて Outlook / Yahoo 等に拡張予定
- **分散方式**: Cloudflare Queues でアカウント単位に分散処理
- **料金戦略**: 無料枠で開始し、50アカウント超 or 1分間隔が必要になった時点で有料化（$5/月）
