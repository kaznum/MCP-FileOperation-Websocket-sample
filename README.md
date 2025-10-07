# MCP WebSocket Sample

WebSocketを使用したModel Context Protocol (MCP)のサンプル実装です。Docker Composeで構成されたMCPサーバーとクライアントを提供し、ファイル操作機能を実装しています。

## 機能

- **MCPサーバー**: WebSocketでMCPプロトコルを実装
  - `list-files`: ディレクトリ内のファイル一覧を取得
  - `read-file`: ファイルの内容を読み込み
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
docker compose up mcp -d
```

### サーバーログの確認

```bash
docker compose logs mcp --tail 20
```

### クライアントの実行

```bash
docker compose run --rm mcp-client
```

クライアントは以下のテストを実行します：
1. サーバーへの接続と初期化
2. ルートディレクトリのファイル一覧取得
3. sample1.txtの読み込み
4. sample2.txtの読み込み

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

### クライアント (mcp-client)

- `SERVER_URL`: MCPサーバーのWebSocket URL（デフォルト: ws://mcp:3000）

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

## トラブルシューティング

### サーバーが起動しない

```bash
docker compose logs mcp
```

### クライアントが接続できない

サーバーが起動しているか確認：
```bash
docker compose ps
```

### node_modulesが見つからない

```bash
cd server && npm install
cd ../client && npm install
```

## ライセンス

MIT
