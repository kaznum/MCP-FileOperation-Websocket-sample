# MCP WebSocket Sample

WebSocketを使用したModel Context Protocol (MCP)のサンプル実装です。Docker Composeで構成されたMCPサーバーとクライアントを提供し、ファイル操作機能を実装しています。

## 機能

- **MCPサーバー**: WebSocketでMCPプロトコルを実装
  - `list-files`: ディレクトリ内のファイル一覧を取得
  - `read-file`: ファイルの内容を読み込み
  - **OAuth 2.1認証**: クライアントクレデンシャルズフローによるBearerトークン検証
- **MCPクライアント**: サーバーに接続してツールを実行
- **Docker Compose**: サーバーとクライアントをコンテナ化

## 必要要件

- Docker
- Docker Compose
- Node.js 24以降（ローカル開発の場合）

## セットアップ

### 1. 依存関係のインストール

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Dockerイメージのビルド

```bash
docker compose build
```

## 使い方

### サーバーと認可サーバーの起動

```bash
# 必要に応じてクライアント資格情報を上書き
export OAUTH_CLIENT_ID="mcp-client"
export OAUTH_CLIENT_SECRET="replace-with-strong-secret"
docker compose up mcp -d
```

`mcp`サービスを起動すると依存関係としてOAuth 2.1認可サーバー（`auth`）も自動的に立ち上がり、`mcp`サーバーはJWKSを用いてBearerトークンを検証します。

> **注意**: サンプルのデフォルト資格情報（`mcp-client` / `mcp-client-secret`）は開発用途のみです。本番環境では必ず強固なシークレットに置き換えてください。

### サーバーログの確認

```bash
docker compose logs mcp --tail 20
```

### クライアントの実行

```bash
# サーバー起動時に使用した資格情報を共有
export OAUTH_CLIENT_ID="mcp-client"
export OAUTH_CLIENT_SECRET="replace-with-strong-secret"
docker compose run --rm --no-deps mcp-client
```

クライアントは以下のテストを実行します：
1. サーバーへの接続と初期化（OAuth 2.1 認証）
2. ルートディレクトリのファイル一覧取得
3. sample1.txtの読み込み
4. sample2.txtの読み込み

> **ヒント**: 既存のトークンを直接指定したい場合は、`OAUTH_ACCESS_TOKEN`環境変数にBearerトークンをセットするとクライアントはトークンエンドポイントへのアクセスを省略します。

### サーバーの停止

```bash
docker compose down
```

## アーキテクチャ

```
┌─────────────────┐      Token Request      ┌────────────────────────┐
│   MCP Client    │ ───────────────────────►│  OAuth 2.1 Auth Server │
│  (Node.js 24)   │◄─────────────────────── │   (client credentials) │
└─────────────────┘   Bearer Token (JWT)    └────────────────────────┘
          │                                             │
          │ WebSocket (Bearer Token)                    │ JWKS
          ▼                                             ▼
┌─────────────────┐◄────────────────────────────────────┘
│   MCP Server    │            Key Validation
│  (Node.js 24)   │
└─────────────────┘
          │
          │ File Access
          ▼
┌─────────────────┐
│     /data       │
│   (volume)      │
└─────────────────┘
```

### ディレクトリ構成

```
.
├── auth/                # OAuth 2.1認可サーバー
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
├── server/              # MCPサーバー
│   ├── server.js        # WebSocketサーバー実装
│   ├── manifest.json    # MCPツール定義
│   ├── package.json
│   └── Dockerfile
├── client/              # MCPクライアント
│   ├── client.js        # WebSocketクライアント実装
│   ├── package.json
│   └── Dockerfile
├── data/                # ファイル操作対象ディレクトリ
│   ├── sample1.txt
│   └── sample2.txt
├── docker-compose.yml
└── README.md
```

## 環境変数

### サーバー (mcp)

- `PORT`: WebSocketサーバーのポート（デフォルト: 3000）
- `TARGET_DIR`: ファイル操作の対象ディレクトリ（デフォルト: /data）
- `OAUTH_ISSUER`: トークン発行者のURL（例: http://auth:8080）
- `OAUTH_JWKS_URL`: JWKSエンドポイント（例: http://auth:8080/jwks.json）
- `OAUTH_AUDIENCE`: 検証対象となるaudクレーム（デフォルト: mcp-server）
- `OAUTH_REQUIRED_SCOPES`: 必須スコープをスペース区切りで列挙

### クライアント (mcp-client)

- `SERVER_URL`: MCPサーバーのWebSocket URL（デフォルト: ws://mcp:3000）
- `OAUTH_TOKEN_URL`: トークンエンドポイント（例: http://auth:8080/token）
- `OAUTH_CLIENT_ID`: クライアントID
- `OAUTH_CLIENT_SECRET`: クライアントシークレット
- `OAUTH_SCOPE`: 要求するスコープ（デフォルト: file.read file.list）
- `OAUTH_ACCESS_TOKEN`: 既存のアクセストークン（任意。指定時はトークンエンドポイントへアクセスしません）

### 認可サーバー (auth)

- `PORT`: 認可サーバーの待受ポート（デフォルト: 8080）
- `CLIENT_ID`: 許可するクライアントID
- `CLIENT_SECRET`: クライアントシークレット
- `ISSUER`: 発行者識別子（例: http://auth:8080）
- `AUDIENCE`: アクセストークンに設定するaudクレーム
- `ALLOWED_SCOPES`: 許可するスコープ一覧（スペース区切り）
- `TOKEN_TTL`: アクセストークンの有効期限（秒、デフォルト: 300）

## 開発

### ローカルでの開発

ボリュームマウントにより、ローカルでコードを編集すると自動的にコンテナに反映されます。

```bash
# サーバーコードを編集後、再起動
docker compose restart mcp

# クライアントコードを編集後、再実行
docker compose run --rm mcp-client
```

### サーバーコンテナに入る

```bash
docker compose exec mcp sh
```

## MCPツール仕様

### list-files

指定したディレクトリ配下のファイル一覧を取得します。

**リクエスト:**
```json
{
  "type": "tool_call",
  "name": "list-files",
  "arguments": {
    "directory": "."
  }
}
```

**レスポンス:**
```json
{
  "type": "tool_result",
  "result": {
    "success": true,
    "files": [
      {"name": "sample1.txt", "type": "file", "path": "./sample1.txt"},
      {"name": "sample2.txt", "type": "file", "path": "./sample2.txt"}
    ]
  }
}
```

### read-file

指定したファイルの内容を読み込みます。

**リクエスト:**
```json
{
  "type": "tool_call",
  "name": "read-file",
  "arguments": {
    "filePath": "sample1.txt"
  }
}
```

**レスポンス:**
```json
{
  "type": "tool_result",
  "result": {
    "success": true,
    "content": "ファイルの内容...",
    "path": "sample1.txt"
  }
}
```

## セキュリティ

### 認証

このサンプルはOAuth 2.1のクライアントクレデンシャルズフローを実装しています：

- **トークン取得**: クライアントは`auth`サービスの`/token`エンドポイントに対してBasic認証でリクエストを送り、アクセストークン（JWT）を取得します。
- **鍵配布**: 認可サーバーは起動時にRSA鍵ペアを生成し、`/jwks.json`で公開鍵を配布します。オプションでOpenID Provider Metadata (`/.well-known/openid-configuration`) も提供します。
- **トークン検証**: `mcp`サーバーはWebSocketハンドシェイク時にBearerトークンを受け取り、issuer / audience / scope を検証します。不正なトークンの場合は`401 Unauthorized`を返します。

### セキュリティのベストプラクティス

1. **強力なクライアントシークレットを使用**: 推測困難なランダム文字列を生成し、資格情報ストアやシークレットマネージャーで安全に保管します。
2. **スコープは最小限に**: 必要な権限だけを`OAUTH_SCOPE`および`OAUTH_REQUIRED_SCOPES`に設定し、不要なアクセスを避けます。
3. **本番環境ではHTTPS/WSSを使用**:
   - 現在の実装は`ws://`（非暗号化）
   - 本番環境ではリバースプロキシ（Nginx, Traefik等）でTLS終端を実装
4. **資格情報と鍵のローテーション**: クライアントシークレットや署名鍵を定期的に更新し、必要に応じて複数のJWKSキーを配布する実装に拡張します。

### 将来の拡張

- Authorization Code + PKCE フローの追加
- Refresh Token / Token Revocation 対応
- レート制限とアノマリ検知
- セキュリティ監査ログの外部ストレージ出力

## トラブルシューティング

### サーバーが起動しない

```bash
docker compose logs mcp
```

### クライアントが接続できない（401 Unauthorized）

- 認可サーバーとMCPサーバーのログで詳細を確認：
  ```bash
  docker compose logs auth --tail 20
  docker compose logs mcp --tail 20
  ```
- `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` が一致しているか確認：
  ```bash
  echo $OAUTH_CLIENT_ID
  echo $OAUTH_CLIENT_SECRET
  ```
- 発行されたトークンのスコープに`file.read`や`file.list`が含まれているか確認：
  ```bash
  docker compose logs auth | grep scope
  ```

### クライアントが接続できない（その他）

サーバーが起動しているか確認：
```bash
docker compose ps
```

### node_modulesが見つからない

コンテナ起動時に自動的に`npm install`が実行されます。問題がある場合：
```bash
docker compose down
docker compose build --no-cache
```

## ライセンス

MIT
