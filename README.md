# MCP WebSocket Sample

WebSocketを使用したModel Context Protocol (MCP)のサンプル実装です。Docker Composeで構成されたMCPサーバーとクライアントを提供し、ファイル操作機能を実装しています。

## 機能

- **MCPサーバー**: WebSocketでMCPプロトコルを実装
  - `list-files`: ディレクトリ内のファイル一覧を取得
  - `read-file`: ファイルの内容を読み込み
  - **APIキー認証**: X-API-Keyヘッダーによる認証機能
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

### サーバーの起動

```bash
# APIキーを指定してサーバーを起動
API_KEY="your-secret-key" docker compose up mcp -d

# または環境変数をエクスポート
export API_KEY="your-secret-key"
docker compose up mcp -d
```

> **注意**: 本番環境では必ず強力なAPIキーを設定してください。APIキーが未設定の場合、認証が無効化され、警告が表示されます。

### サーバーログの確認

```bash
docker compose logs mcp --tail 20
```

### クライアントの実行

```bash
# サーバーと同じAPIキーを指定
API_KEY="your-secret-key" docker compose run --rm mcp-client

# または環境変数を使用
export API_KEY="your-secret-key"
docker compose run --rm mcp-client
```

クライアントは以下のテストを実行します：
1. サーバーへの接続と初期化（APIキー認証）
2. ルートディレクトリのファイル一覧取得
3. sample1.txtの読み込み
4. sample2.txtの読み込み

> **注意**: クライアントとサーバーで同じAPIキーを使用する必要があります。APIキーが一致しない場合、`401 Unauthorized`エラーが返されます。

### サーバーの停止

```bash
docker compose down
```

## アーキテクチャ

```
┌─────────────────┐         WebSocket         ┌─────────────────┐
│   MCP Client    │ ◄────────────────────────► │   MCP Server    │
│  (Node.js 24)   │     ws://mcp:3000          │  (Node.js 24)   │
└─────────────────┘                            └─────────────────┘
                                                        │
                                                        ▼
                                                  ┌──────────┐
                                                  │  /data   │
                                                  │ (volume) │
                                                  └──────────┘
```

### ディレクトリ構成

```
.
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
- `API_KEY`: 認証用のAPIキー（**必須推奨**。未設定の場合は認証が無効化されます）

### クライアント (mcp-client)

- `SERVER_URL`: MCPサーバーのWebSocket URL（デフォルト: ws://mcp:3000）
- `API_KEY`: サーバー接続用のAPIキー（サーバーと同じ値を設定）

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

このサンプルはAPIキー認証を実装しています：

- **ヘッダー認証**: クライアントは`X-API-Key`ヘッダーでAPIキーを送信
- **検証**: サーバーはWebSocketハンドシェイク時に認証を実行
- **エラー処理**: 認証失敗時は`401 Unauthorized`を返す

### セキュリティのベストプラクティス

1. **強力なAPIキーを使用**: 推測困難なランダムな文字列を生成
   ```bash
   # 例: opensslで生成
   openssl rand -hex 32
   ```

2. **環境変数で管理**: APIキーをコードに直接書き込まない

3. **本番環境ではHTTPS/WSSを使用**:
   - 現在の実装は`ws://`（非暗号化）
   - 本番環境ではリバースプロキシ（Nginx, Traefik等）でTLS終端を実装

4. **APIキーのローテーション**: 定期的にAPIキーを変更

### 将来の拡張

- OAuth 2.1対応
- JWT（JSON Web Token）認証
- レート制限
- アクセスログの記録

## トラブルシューティング

### サーバーが起動しない

```bash
docker compose logs mcp
```

### クライアントが接続できない（401 Unauthorized）

APIキーが一致しているか確認：
```bash
# サーバーのログを確認
docker compose logs mcp | grep -i auth

# 同じAPIキーを使用しているか確認
echo $API_KEY
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
