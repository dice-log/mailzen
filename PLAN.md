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
| sender | text | 送信者表示名（表示名優先、無い場合はマスク済み表記） |
| sender_id | text | 正規化後メールアドレスの SHA-256 先頭20桁（識別子） |
| sender_domain | text | 送信元ドメイン（例: `gmail.com`） |
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
- **送信者ポリシー**: `sender_id` 単位で `sender_policies` に `trust` を登録した送信元は、`suspicious=1` 判定でも既読化を許可
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

### ENCRYPTION_KEY ローテーション（GCP Secret Manager を正にする完全版）

方針:
- **GCP Secret Manager** に `ENCRYPTION_KEY` の原本（バージョン管理）を置く
- **GitHub Secrets / Cloudflare Secret** は配布先（実行環境へ同期）
- D1 の `mail_accounts.credentials` は暗号化済みデータなので、鍵だけ先に差し替えると復号不能になり得る  
  → この手順は **再登録前提（DELETE → register）** を基本とする（全件再暗号化ジョブが無い前提）

補足:
- **GitHub Secrets に `ENCRYPTION_KEY` を置かない**運用へ寄せることは可能だが、同期パイプライン用の認証（GCP/Cloudflare）は別途必要になる
- 「GCPに一本化」は検討余地あり（現状は GitHub Secrets 経由の同期でも可）

#### 0) 事前確認
- 旧 `ENCRYPTION_KEY` を安全な保管先に退避（ロールバック用）
- 影響範囲を把握（`mail_accounts` の再登録が必要）

#### 1) 新鍵生成（64桁hex）+ クリップボード + 一時ファイル（WSL）
```bash
umask 077
KEY_FILE=/tmp/mailzen_encryption_key.txt
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | tee "$KEY_FILE" | tr -d '\n' | clip.exe
echo "len=$(tr -d '\n' < "$KEY_FILE" | wc -c)"
```
- `len` が **64** であることを確認

#### 2) GCP Secret Manager を更新（原本）
前提: `gcloud` が使え、対象プロジェクトが選べる

初回のみ（シークレット未作成のとき）:
```bash
export PROJECT_ID="your-gcp-project-id"
gcloud config set project "$PROJECT_ID"
gcloud services enable secretmanager.googleapis.com
gcloud secrets create mailzen-encryption-key --replication-policy="automatic"
```

ローテーション本体（新バージョン追加）:
```bash
gcloud secrets versions add mailzen-encryption-key --data-file="$KEY_FILE"
```

確認（値は出さずメタ情報だけ）:
```bash
gcloud secrets versions list --secret=mailzen-encryption-key --limit=5
```

#### 3) GitHub Secrets を更新（配布先その1）
GitHub → Repository → Settings → Secrets and variables → Actions  
- `ENCRYPTION_KEY` を新しい値に更新

CLI派:
```bash
gh secret set ENCRYPTION_KEY < "$KEY_FILE"
```

#### 4) Cloudflare Worker Secret を更新（配布先その2）
GitHub Actions の `Sync Cloudflare Secret` を手動実行:
- `target=production`
- `confirm_old_key_backed_up=yes`

CLI派（代替）:
```bash
printf '%s' "$(tr -d '\n' < "$KEY_FILE")" | npx wrangler secret put ENCRYPTION_KEY
```

#### 5) D1 を整理（再登録前提）
```bash
npx wrangler d1 execute mailzen-db --remote --command "DELETE FROM mail_accounts;"
```

任意（履歴も捨てるなら）:
```bash
npx wrangler d1 execute mailzen-db --remote --command "DELETE FROM mail_results;"
```

#### 6) 再登録（新鍵で暗号化して INSERT）
```bash
export ENCRYPTION_KEY="$(tr -d '\n' < "$KEY_FILE")"
echo -n "$ENCRYPTION_KEY" | wc -c

npm run register:account -- \
  --email "you@example.com" \
  --provider gmail \
  --credentials-file "./credentials.json" \
  --execute true
```

注意:
- `register:account` は基本 **INSERT** なので、**5) を挟まずに複数回実行すると重複しやすい**

#### 7) 動作確認（E2E）
```bash
curl -fsS "https://mailzen.<your-subdomain>.workers.dev/run"
```

```bash
npx wrangler d1 execute mailzen-db --remote --command "SELECT COUNT(*) AS cnt FROM mail_results;"
```

#### 8) 後片付け
```bash
shred -u "$KEY_FILE" 2>/dev/null || rm -f "$KEY_FILE"
unset ENCRYPTION_KEY
```

#### 失敗時のロールバック（最短）
1. 旧 `ENCRYPTION_KEY` を GitHub Secrets に戻す（退避済みの値）
2. `Sync Cloudflare Secret` を再実行（または `wrangler secret put`）
3. `/run` で復号・処理が戻ることを確認

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

### `ENCRYPTION_KEY` 生成と取り込み（WSL）

#### 生成 + Windows クリップボード + 一時ファイル保存
```bash
umask 077
KEY_FILE=/tmp/mailzen_encryption_key.txt
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | tee "$KEY_FILE" | tr -d '\n' | clip.exe
echo "saved:$KEY_FILE len=$(tr -d '\n' < "$KEY_FILE" | wc -c)"
```

#### シェルにセット（そのターミナルだけ有効）
```bash
export ENCRYPTION_KEY="$(tr -d '\n' < /tmp/mailzen_encryption_key.txt)"
echo -n "$ENCRYPTION_KEY" | wc -c
```

`wc -c` が **64** なら長さはOK（値自体は画面に出さない運用推奨）。

#### クリップボードから取り込み（任意）
```bash
export ENCRYPTION_KEY="$(powershell.exe -NoProfile -Command "Get-Clipboard" | tr -d '\r' | tr -d '\n')"
echo -n "$ENCRYPTION_KEY" | wc -c
```

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
