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
- [x] Consumer Worker の実装
- [x] プロバイダーアダプターのインターフェース設計
- [x] Gmail アダプターのリファクタリング

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

---

## 鍵ローテーション（軽量運用）

### 目的
- `ENCRYPTION_KEY` 漏えい時の被害期間を短くする
- 鍵の変更手順を固定化して復号不能事故を防ぐ

### 手順（漏えい疑い時・年1回目安）
1. 現行 `ENCRYPTION_KEY` を安全な保管先に退避（即削除せず一時保管）
2. 新しい32バイト鍵（64桁hex）を生成し、Cloudflare secret と GitHub Secrets に設定
3. `mail_accounts.credentials` を旧鍵で復号し、新鍵で再暗号化して更新
4. テストアカウント1件で復号・処理成功を確認後、通常運用に戻す

### 最低限のルール
- 鍵変更前に旧鍵退避を必須化する
- 復号テスト1件が通るまで旧鍵を破棄しない
- 本番データがある環境では、再暗号化なしで鍵だけ先に差し替えない

---

## Gmail credentials.json 最小フォーマット

`scripts/register-account.mjs` で登録する Gmail 認証情報は以下を最小構成とする。

```json
{
  "clientId": "xxx.apps.googleusercontent.com",
  "clientSecret": "xxx",
  "refreshToken": "xxx"
}
```

### 用語整理（Gmail OAuth と ENCRYPTION_KEY）

#### 1) `clientId` / `clientSecret`（Google OAuth クライアント）
- **何のため**: 「このアプリが Google OAuth を使う許可」を証明するペア
- **どこにあるべき**: Google Cloud の OAuth 2.0 クライアントID（種類は **Webアプリ**）
- **どこに保存されるか（このプロジェクト）**: D1 の `mail_accounts.credentials`（**暗号化された JSON** の中）
- **Cloudflare Secret に必須か**: **基本不要**（過去実装の名残で `GMAIL_*` が残っている可能性はあるが、現行コードは D1 参照）

#### 2) `refreshToken`（長期トークン）
- **何のため**: `access_token` を何度も作り直すための長期トークン
- **どこに保存されるか**: D1 の `mail_accounts.credentials`（暗号化 JSON の中）
- **特徴**: 失効したり、OAuthクライアントと紐づく（クライアント作り直し時は取り直しが必要になりやすい）

#### 3) `access_token`（短期トークン）
- **何のため**: Gmail API を実際に叩くときの資格情報（短期）
- **どこに保存されるか**: **基本保存しない**（実行時に `refresh_token` から取得）
- **特徴**: 短命。OAuth Playground で見えやすいのは通常こちら

#### 4) `ENCRYPTION_KEY`（アプリ独自の暗号化鍵）
- **何のため**: D1 に保存する `credentials` JSON を **AES-GCM で暗号化/復号**するため（DB漏えい時の被害を減らす）
- **どこにあるべき**: Cloudflare Worker Secret（運用保険として GitHub Secrets にも保持）
- **重要**: **Gmail のトークンではない**（名前が紛らわしいので別物として扱う）

---

## Secret 同期と動作確認手順

### 事前準備
- GitHub Secrets に `CLOUDFLARE_API_TOKEN` と `ENCRYPTION_KEY` を設定
- `ENCRYPTION_KEY` は64桁hex（32バイト）であることを確認
- 旧 `ENCRYPTION_KEY` を安全な保管先に退避

### 手順
1. GitHub Actions の `Sync Cloudflare Secret` を手動実行（`target=production`, `confirm_old_key_backed_up=yes`）
2. テスト用 `credentials.json` を用意してアカウント登録
   - `ENCRYPTION_KEY=<テスト用キー> npm run register:account -- --email you@example.com --credentials-file ./credentials.json --execute true`
3. `https://mailzen.<your-subdomain>.workers.dev/run` を呼び出してジョブ投入
4. Worker ログと D1 の `mail_results` を確認し、1件以上処理されることを検証

### 失敗時のロールバック（3ステップ固定）
1. 旧 `ENCRYPTION_KEY` を GitHub Secrets に戻し、`Sync Cloudflare Secret` を再実行
2. `/run` を呼び出してテストアカウント1件の復号・処理成功を確認
3. 実施日時、原因、対応内容を運用メモに記録
