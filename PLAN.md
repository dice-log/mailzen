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

## フェーズ 2: DB 基盤（Supabase）

### テーブル設計

**users**
| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid | PK |
| plan | text | free / pro 等 |
| created_at | timestamp | |

**mail_accounts**
| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid | PK |
| user_id | uuid | FK → users.id |
| provider | text | gmail / outlook / yahoo 等 |
| credentials | text | 認証情報（暗号化）|
| created_at | timestamp | |

**mail_results**
| カラム | 型 | 説明 |
|--------|-----|------|
| id | uuid | PK |
| account_id | uuid | FK → mail_accounts.id |
| message_id | text | プロバイダー側のメッセージID |
| thread_id | text | スレッドID（リンク生成用）|
| category | text | important / newsletter 等 |
| summary | text | Gemini 生成の要約（個人情報除去済み）|
| processed_at | timestamp | |

### タスク
- [x] D1 データベース `mailzen-db` を作成（Supabase から変更）
- [x] `mail_results` テーブルを作成
- [x] 処理結果を mail_results に保存する実装

---

## フェーズ 3: 複数アカウント・複数プロバイダー対応

### 方針
- 認証情報は暗号化キー（Cloudflare シークレット）で暗号化して Supabase に保存
- プロバイダーごとにアダプターを実装（Gmail / Outlook / Yahoo 等）
- アカウントごとに独立した Worker 呼び出しにして subrequests 制限を回避

### タスク
- [ ] 暗号化・復号化ユーティリティの実装（AES-GCM）
- [ ] `ENCRYPTION_KEY` を wrangler secret に追加
- [ ] プロバイダーアダプターのインターフェース設計
- [ ] Gmail アダプターのリファクタリング
- [ ] アカウントごとに処理を分割するオーケストレーター実装

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

---

## 設計方針

- **持たない情報**: メール本文・添付ファイル
- **持つ情報**: 認証情報（暗号化）・メールID・カテゴリ・要約
- **個人情報保護**: 要約生成時に Gemini プロンプトで除去指示
- **重複処理防止**: 未読フラグを状態管理として利用
- **デプロイ**: GitHub Actions で main ブランチ push 時に自動デプロイ
- **プロバイダー**: Gmail から始めて Outlook / Yahoo 等に拡張予定
