# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

環境変数で指定されたTARGET_DIR配下のファイルおよびディレクトリ操作を可能にするサンプルMCP（Model Context Protocol）サーバー。

## アーキテクチャ

- Docker Composeで3つのコンテナを起動
  - **認可サーバー**（コンテナ名: `auth`）
    - Node.js 24ランタイム
    - エントリーポイント: `server.js`
    - OAuth 2.1クライアントクレデンシャルズフローを提供 (`/token`, `/jwks.json`, `/.well-known/openid-configuration`)
    - 起動時にRSA鍵ペアを生成し、JWKSで公開鍵を配布
    - `CLIENT_ID` / `CLIENT_SECRET` / `ALLOWED_SCOPES`などを環境変数で設定
  - **mcpサーバー**（コンテナ名: `mcp`）
    - Node.js 24ランタイム
    - エントリーポイント: `server.js`
    - WebSocketによるMCPクライアント・サーバー間通信
    - ポート3000で待ち受け
    - ボリュームマウント:
      - `./data` → `/data` (ファイル操作対象)
      - `./server` → `/app` (開発用、ホットリロード可能)
    - `TARGET_DIR`環境変数で操作対象ディレクトリを指定（デフォルト: `/data`）
    - OAuth 2.1 Bearerトークンを検証（issuer / audience / scope）
    - 提供ツール: `list-files`, `read-file`
  - **mcpクライアント**（コンテナ名: `mcp-client`）
    - Node.js 24ランタイム
    - エントリーポイント: `client.js`
    - 起動時に`/token`へアクセスしてBearerトークンを取得
    - WebSocket接続時に`Authorization: Bearer ...`ヘッダーを付与
    - ボリュームマウント:
      - `./client` → `/app` (開発用、ホットリロード可能)
- 3つのコンテナは`mcp-network`で接続
- ES Modules使用（package.jsonに`"type": "module"`を設定）
- node_modules/は.gitignoreで管理外

## ディレクトリ構成

```
.
├── auth/                # OAuth 2.1認可サーバー
│   ├── server.js        # エントリーポイント
│   ├── package.json     # npm依存関係
│   └── Dockerfile       # コンテナ定義
├── server/              # MCPサーバー
│   ├── server.js        # エントリーポイント
│   ├── package.json     # npm依存関係
│   ├── node_modules/    # 依存パッケージ（gitで無視）
│   ├── Dockerfile       # サーバー用Dockerfile
│   └── manifest.json    # MCP設定ファイル
├── client/              # MCPクライアント
│   ├── client.js        # エントリーポイント
│   ├── package.json     # npm依存関係
│   ├── node_modules/    # 依存パッケージ（gitで無視）
│   └── Dockerfile       # クライアント用Dockerfile
├── data/                # ファイル操作の対象ディレクトリ
│   ├── .keep            # ディレクトリ保持用
│   ├── sample1.txt      # サンプルファイル
│   └── sample2.txt      # サンプルファイル
├── docker-compose.yml
├── package.json         # ルートのnpm依存関係
├── .gitignore           # node_modules/を除外
└── CLAUDE.md
```

## 開発コマンド

```bash
# コンテナビルド
docker compose build

# 認可サーバーとMCPサーバーを起動（自動的にnpm installが実行される）
export OAUTH_CLIENT_ID="mcp-client"
export OAUTH_CLIENT_SECRET="replace-with-strong-secret"
docker compose up mcp -d

# サーバーログ確認
docker compose logs mcp --tail 20

# クライアント実行（自動的にnpm installが実行される）
export OAUTH_CLIENT_ID="mcp-client"
export OAUTH_CLIENT_SECRET="replace-with-strong-secret"
docker compose run --rm --no-deps mcp-client

# コンテナ停止
docker compose down

# サーバーコンテナに入る
docker compose exec mcp sh

# サーバー再起動（コード変更後）
docker compose restart mcp
```

**認証のテスト:**
```bash
# 正しいクライアント資格情報でトークン取得＆接続（成功）
OAUTH_CLIENT_ID="mcp-client" \
OAUTH_CLIENT_SECRET="replace-with-strong-secret" \
docker compose run --rm --no-deps mcp-client

# 誤ったクライアントシークレット（401エラー）
OAUTH_CLIENT_ID="mcp-client" \
OAUTH_CLIENT_SECRET="wrong-secret" \
docker compose run --rm --no-deps mcp-client

# スコープ不足（OAUTH_SCOPEを変更して401エラーを確認）
OAUTH_CLIENT_ID="mcp-client" \
OAUTH_CLIENT_SECRET="replace-with-strong-secret" \
OAUTH_SCOPE="file.read" \
docker compose run --rm --no-deps mcp-client
```

**開発時の注意点:**
- `./server`と`./client`がコンテナの`/app`にマウントされているため、ローカルでコードを編集すると即座にコンテナに反映されます
- package.jsonを変更した場合は、コンテナを再起動すると自動的に`npm install`が実行されます
- 依存関係のローカルインストールは不要です（コンテナ内で自動実行）

## MCPツール

### list-files
指定したディレクトリ配下のファイル一覧を取得します。

**パラメータ:**
- `directory` (string): フォルダパス（相対パス）

**例:**
```json
{
  "name": "list-files",
  "arguments": {
    "directory": "."
  }
}
```

### read-file
指定したファイルの内容を読み込みます。

**パラメータ:**
- `filePath` (string): ファイルパス（相対パス）

**例:**
```json
{
  "name": "read-file",
  "arguments": {
    "filePath": "sample1.txt"
  }
}
```

## セキュリティ

### 認証の実装

- **サーバー側** (`server/server.js:10-88`):
  - WebSocketハンドシェイク時に`Authorization: Bearer <token>`ヘッダーを必須とし、`jwtVerify`でissuer / audience / scopeを検証。
  - 必須スコープは`OAUTH_REQUIRED_SCOPES`で制御。
  - 認証失敗時は`401 Unauthorized`を返し、成功時は`req.authContext`にJWTペイロードを格納。

- **クライアント側** (`client/client.js:3-143`):
  - 起動時に`OAUTH_TOKEN_URL`へクライアントクレデンシャルズリクエストを送り、アクセストークンを取得。
  - 既存トークンを使用する場合は`OAUTH_ACCESS_TOKEN`を参照し、WebSocket接続時にBearerトークンを付与。

- **認可サーバー側** (`auth/server.js:5-121`):
  - 起動時にRSA鍵を生成し、JWKSとOpenID Provider Metadataを公開。
  - `/token`エンドポイントで`client_secret_basic`もしくは`client_secret_post`によるクライアント認証を行い、JWTアクセストークンを発行。
  - 要求スコープを検証し、失敗時は`invalid_scope`エラーを返却。

### セキュリティのベストプラクティス

1. **強力なクライアントシークレットを生成**: `openssl rand -hex 32`などで十分に長い乱数を作成し、`.env`やシークレットマネージャーで保管。
2. **最小権限のスコープ設計**: サーバーで必要なスコープのみを`OAUTH_REQUIRED_SCOPES`に設定する。
3. **TLS終端の導入**: 本番環境では`wss://`経由で接続し、リバースプロキシでTLS証明書を管理。
4. **資格情報/鍵のローテーション**: `CLIENT_SECRET`やRSA鍵を定期的に更新し、複数の`kid`対応やキーイングストラテジー拡張を検討。

## トラブルシューティング

- サーバーが起動しない場合: `docker compose logs mcp` でログを確認
- クライアントが接続できない場合（401エラー）:
  - `docker compose logs auth --tail 20` と `docker compose logs mcp --tail 20` で詳細を確認
  - `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` が一致しているか確認
  - 発行されたトークンのスコープに`file.read`と`file.list`が含まれているか確認
- クライアントが接続できない場合（その他）: サーバーが起動しているか確認 (`docker compose ps`)
- 依存関係のエラーが出る場合: コンテナを再起動（`docker compose restart mcp`）すると自動的に`npm install`が実行されます
