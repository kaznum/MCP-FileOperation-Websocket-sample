# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

環境変数で指定されたTARGET_DIR配下のファイルおよびディレクトリ操作を可能にするサンプルMCP（Model Context Protocol）サーバー。

## アーキテクチャ

- Docker Composeで2つのコンテナを起動
  - **mcpサーバー**（コンテナ名: `mcp`）
    - Node.js 24ランタイム
    - エントリーポイント: `server.js`
    - WebsocketによるMCPクライアント・サーバー間通信
    - ポート3000で待ち受け
    - ボリュームマウント:
      - `./data` → `/data` (ファイル操作対象)
      - `./server` → `/app` (開発用、ホットリロード可能)
    - コンテナ起動時に自動的に`npm install`を実行
    - `TARGET_DIR`環境変数で操作対象ディレクトリを指定（デフォルト: `/data`）
    - `API_KEY`環境変数で認証を有効化（未設定時は認証無効）
    - 提供ツール: `list-files`, `read-file`
    - **認証機能**: WebSocketハンドシェイク時にAPIキーを検証
  - **mcpクライアント**（コンテナ名: `mcp-client`）
    - Node.js 24ランタイム
    - エントリーポイント: `client.js`
    - WebSocketでサーバーに接続
    - ボリュームマウント:
      - `./client` → `/app` (開発用、ホットリロード可能)
    - コンテナ起動時に自動的に`npm install`を実行
    - `API_KEY`環境変数を`X-API-Key`ヘッダーでサーバーに送信
- 両コンテナは`mcp-network`で接続
- ES Modules使用（package.jsonに`"type": "module"`を設定）
- node_modules/は.gitignoreで管理外

## ディレクトリ構成

```
.
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

# サーバーコンテナ起動（自動的にnpm installが実行される）
API_KEY="your-secret-key" docker compose up mcp -d

# サーバーログ確認
docker compose logs mcp --tail 20

# クライアント実行（自動的にnpm installが実行される）
API_KEY="your-secret-key" docker compose run --rm mcp-client

# コンテナ停止
docker compose down

# サーバーコンテナに入る
docker compose exec mcp sh

# サーバー再起動（コード変更後）
docker compose restart mcp
```

**認証のテスト:**
```bash
# サーバー起動
API_KEY="test-key-123" docker compose up mcp -d

# 正しいAPIキーでクライアント実行（成功）
API_KEY="test-key-123" docker compose run --rm --no-deps mcp-client

# 間違ったAPIキーでクライアント実行（401エラー）
API_KEY="wrong-key" docker compose run --rm --no-deps mcp-client

# APIキーなしでクライアント実行（401エラー）
API_KEY="" docker compose run --rm --no-deps mcp-client
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

- **サーバー側** (`server/server.js:18-39`):
  - `WebSocketServer`の`verifyClient`コールバックで認証
  - `X-API-Key`ヘッダーまたはクエリパラメータ`api_key`を検証
  - 認証失敗時は`401 Unauthorized`を返す
  - `API_KEY`環境変数が未設定の場合は警告を表示して認証を無効化

- **クライアント側** (`client/client.js:10-14`):
  - WebSocket接続時に`X-API-Key`ヘッダーでAPIキーを送信
  - 環境変数`API_KEY`から取得

### セキュリティのベストプラクティス

1. **強力なAPIキーの生成**:
   ```bash
   openssl rand -hex 32
   ```

2. **環境変数ファイル（`.env`）の使用**:
   ```bash
   # .env ファイル（gitで管理しない）
   API_KEY=your-generated-secret-key-here
   ```

3. **本番環境ではWSS（WebSocket Secure）を使用**:
   - リバースプロキシ（Nginx, Traefik等）でTLS終端
   - Let's Encryptで証明書を取得

4. **将来の拡張**:
   - OAuth 2.1への移行（MCP公式仕様に準拠）
   - JWT認証の実装
   - レート制限の追加
   - 監査ログの記録

## トラブルシューティング

- サーバーが起動しない場合: `docker compose logs mcp` でログを確認
- クライアントが接続できない場合（401エラー）:
  - `docker compose logs mcp | grep -i auth` で認証ログを確認
  - サーバーとクライアントで同じ`API_KEY`を使用しているか確認
- クライアントが接続できない場合（その他）: サーバーが起動しているか確認 (`docker compose ps`)
- 依存関係のエラーが出る場合: コンテナを再起動（`docker compose restart mcp`）すると自動的に`npm install`が実行されます

