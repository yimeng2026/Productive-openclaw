# Sylva Platform 部署文档

> **版本**: 2.6.0  
> **更新日期**: 2026-05-19  
> **适用平台**: Docker / 本地开发 (Windows / macOS / Linux)

---

## 目录

1. [系统要求](#1-系统要求)
2. [快速开始](#2-快速开始)
3. [Docker 部署](#3-docker-部署)
4. [本地开发环境搭建](#4-本地开发环境搭建)
5. [环境变量完整清单](#5-环境变量完整清单)
6. [生产环境配置建议](#6-生产环境配置建议)
7. [SSLTLS 配置](#7-ssltls-配置)
8. [备份策略](#8-备份策略)
9. [升级流程](#9-升级流程)
10. [监控和告警设置](#10-监控和告警设置)
11. [故障排查 FAQ](#11-故障排查-faq)
12. [性能调优建议](#12-性能调优建议)

---

## 1. 系统要求

### 1.1 操作系统

| 操作系统 | 最低版本 | 推荐版本 | 备注 |
|---------|---------|---------|------|
| Windows | Windows 10 (2004) | Windows 11 23H2 | WSL2 推荐用于 Docker |
| macOS | macOS 12 (Monterey) | macOS 14 (Sonoma) | Apple Silicon / Intel 均支持 |
| Linux | Ubuntu 20.04 LTS | Ubuntu 24.04 LTS | 其他发行版经测试可用 |
| 容器平台 | Docker 24.0+ | Docker 25.0+ | Docker Desktop 或 Engine |

### 1.2 硬件要求

#### 最低配置（单用户 / 开发环境）

| 资源 | 最低要求 | 说明 |
|------|---------|------|
| CPU | 2 核 | 支持 AVX 指令集（用于本地 LLM） |
| 内存 | 4 GB | 不含本地 LLM 服务 |
| 存储 | 10 GB SSD | 包含容器镜像、数据库、日志 |
| 网络 | 宽带连接 | 用于下载模型、更新依赖 |

#### 推荐配置（生产环境 / 多用户）

| 资源 | 推荐配置 | 说明 |
|------|---------|------|
| CPU | 4 核+ | 8 核用于并发 AI 推理 |
| 内存 | 16 GB | 含 Ollama 本地模型（7B 参数模型约需 8GB） |
| 存储 | 50 GB+ SSD | 预留模型文件、上传文件、备份 |
| GPU | NVIDIA RTX 3060+ | 可选，用于加速本地 LLM 推理 |
| 网络 | 100 Mbps+ | 公网部署建议绑定域名 |

#### 大规模部署（团队 / 企业）

| 资源 | 建议配置 | 说明 |
|------|---------|------|
| CPU | 8 核+ | Kubernetes 集群节点 |
| 内存 | 32 GB+ | 多实例 + 缓存集群 |
| 存储 | 100 GB+ NVMe SSD | 高性能数据库 + 对象存储 |
| GPU | NVIDIA A100 / H100 | 大规模模型推理（可选） |
| 负载均衡 | Nginx / Traefik | 多实例反向代理 |

### 1.3 网络要求

| 端口 | 协议 | 用途 | 暴露范围 |
|------|------|------|---------|
| 3000 | TCP/HTTP | 主应用端口 | 外部访问必需 |
| 5173 | TCP/HTTP | 前端开发服务器 | 仅开发环境 |
| 5432 | TCP | PostgreSQL 数据库 | 内部网络 / 可选外部 |
| 6379 | TCP | Redis 缓存 | 内部网络 |
| 11434 | TCP/HTTP | Ollama API | 内部网络 / 可选外部 |
| 80 | TCP/HTTP | HTTP 入口（反向代理） | 外部访问 |
| 443 | TCP/HTTPS | HTTPS 入口（反向代理） | 外部访问 |

### 1.4 依赖软件

| 软件 | 最低版本 | 推荐版本 | 用途 |
|------|---------|---------|------|
| Node.js | 18.0.0 | 20 LTS | 运行时 |
| npm | 9.0.0 | 10.x | 包管理 |
| Docker | 24.0.0 | 25.x | 容器化部署 |
| Docker Compose | 2.20.0 | 2.27.x | 多容器编排 |
| Git | 2.30.0 | 2.45.x | 版本控制 |
| PostgreSQL | 15.x | 15.x | 数据持久化（Docker 内置） |
| Redis | 7.x | 7.x | 缓存与会话（Docker 内置） |

---

## 2. 快速开始

### 2.1 三步启动（Docker 模式）

```bash
# Step 1: 克隆仓库
git clone https://github.com/your-org/sylva-platform.git
cd sylva-platform

# Step 2: 一键部署（生产环境）
./scripts/deploy.sh -e prod -p docker

# Step 3: 访问应用
# 打开浏览器 → http://localhost:3000
```

**Windows 用户：**

```powershell
# Step 1: 克隆仓库
git clone https://github.com/your-org/sylva-platform.git
cd sylva-platform

# Step 2: 一键部署（生产环境）
.\scripts\deploy.ps1 -Environment prod -Platform docker

# Step 3: 访问应用
# 打开浏览器 → http://localhost:3000
```

### 2.2 开发模式快速启动

```bash
# Docker 开发模式（含热重载）
./scripts/deploy.sh -e dev -p docker

# 本地开发模式（前后端独立进程）
./scripts/deploy.sh -e dev -p local
```

### 2.3 验证部署

```bash
# 检查服务健康
curl http://localhost:3000/health

# 预期输出:
# {"status":"ok","timestamp":"2026-05-19T14:30:00.000Z","version":"2.6.0"}

# 查看容器状态
docker compose ps

# 查看实时日志
docker compose logs -f
```

---

## 3. Docker 部署

### 3.1 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                      Sylva Platform                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   sylva-app  │  │   sylva-db   │  │  sylva-ollama│       │
│  │   (Node.js)  │  │ (PostgreSQL) │  │   (LLM API)  │       │
│  │   Port 3000  │  │  Port 5432   │  │  Port 11434  │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│  ┌──────────────┐                                            │
│  │  sylva-redis │  sylva-network (Docker Bridge)               │
│  │   (Cache)    │                                            │
│  │  Port 6379   │                                            │
│  └──────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 部署模式选择

| 模式 | 命令 | 包含服务 | 适用场景 |
|------|------|---------|---------|
| 最小模式 | `docker compose up sylva-app db` | 应用 + 数据库 | 资源受限环境 |
| 标准模式 | `./scripts/deploy.sh` | 应用 + 数据库 + Redis + Ollama | 推荐生产环境 |
| 开发模式 | `./scripts/deploy.sh -e dev` | + 前端热重载服务器 | 本地开发 |
| 完整模式 | `docker compose --profile full up` | 所有可选服务 | 功能完整体验 |

### 3.3 详细部署步骤

#### 3.3.1 准备工作

```bash
# 1. 安装 Docker
# Windows: https://docs.docker.com/desktop/install/windows/
# macOS:   https://docs.docker.com/desktop/install/mac/
# Linux:   https://docs.docker.com/engine/install/ubuntu/

# 2. 验证安装
docker --version
docker compose version

# 3. 克隆仓库
git clone <repository-url> sylva-platform
cd sylva-platform
```

#### 3.3.2 配置环境变量

```bash
# 复制示例环境文件
cp .env.example .env.prod

# 编辑关键配置
nano .env.prod
```

必改项：
```env
# 数据库密码（生产环境必须修改）
DB_PASSWORD=your-secure-password-here

# JWT 密钥（用于用户认证）
JWT_SECRET=your-random-secret-key-min-32-chars

# Ollama 配置（如需本地 LLM）
OLLAMA_ENABLED=true
```

#### 3.3.3 构建与启动

```bash
# 方法 A: 使用部署脚本（推荐）
./scripts/deploy.sh -e prod -p docker -o

# 方法 B: 手动 Docker Compose
docker compose -f docker-compose.yml --profile full up -d --build

# 方法 C: 分步执行
docker compose build          # 构建镜像
docker compose up -d db      # 先启动数据库
docker compose up -d         # 启动其余服务
```

#### 3.3.4 初始化数据库

```bash
# 执行数据库迁移（首次部署）
docker compose exec sylva-app npm run db:migrate

# 或进入容器手动执行
docker compose exec sylva-app bash
npm run db:migrate
npm run db:seed    # 可选：填充示例数据
```

#### 3.3.5 验证与访问

```bash
# 健康检查
curl http://localhost:3000/health

# 查看日志
docker compose logs -f sylva-app

# 浏览器访问
# http://localhost:3000
```

### 3.4 Docker Compose Profile 说明

| Profile | 服务 | 启动命令 |
|---------|------|---------|
| (默认) | sylva-app, db | `docker compose up -d` |
| `ollama` | + ollama | `docker compose --profile ollama up -d` |
| `redis` | + redis | `docker compose --profile redis up -d` |
| `dev` | + frontend-dev | `docker compose --profile dev up -d` |
| `full` | 全部服务 | `docker compose --profile full up -d` |

### 3.5 数据持久化

所有数据通过 Docker Volumes 持久化：

| Volume | 路径 | 内容 |
|--------|------|------|
| `postgres_data` | `/var/lib/postgresql/data` | 数据库文件 |
| `ollama_data` | `/root/.ollama` | 下载的模型文件 |
| `redis_data` | `/data` | Redis AOF 持久化 |
| `sylva_uploads` | `/app/uploads` | 用户上传文件 |

**备份 Volume：**

```bash
# 备份所有数据
docker run --rm -v sylva-platform_postgres_data:/source \
  -v $(pwd)/backup:/backup alpine tar czf /backup/postgres-$(date +%Y%m%d).tar.gz -C /source .

# 恢复
docker run --rm -v sylva-platform_postgres_data:/target \
  -v $(pwd)/backup:/backup alpine tar xzf /backup/postgres-20260519.tar.gz -C /target
```

---

## 4. 本地开发环境搭建

### 4.1 前置条件

- Node.js ≥ 18.0.0
- npm ≥ 9.0.0
- Git
- PostgreSQL 15（本地安装或 Docker）
- Redis 7（可选）

### 4.2 安装步骤

```bash
# 1. 克隆仓库
git clone <repository-url>
cd sylva-platform

# 2. 安装根依赖
npm install

# 3. 安装后端依赖
cd backend && npm install && cd ..

# 4. 安装前端依赖
cd frontend && npm install && cd ..

# 5. 配置环境变量
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# 6. 编辑环境变量
nano backend/.env
```

### 4.3 启动开发服务器

```bash
# 方法 A: 使用根脚本（推荐）
npm run dev
# 同时启动前后端（backend:3000, frontend:5173）

# 方法 B: 分别启动
# 终端 1: 后端
cd backend && npm run dev

# 终端 2: 前端
cd frontend && npm run dev

# 方法 C: 使用部署脚本
./scripts/deploy.sh -e dev -p local
```

### 4.4 开发环境数据库

```bash
# 使用 Docker 启动数据库（推荐，不污染本地）
docker compose -f docker-compose.yml up -d db redis

# 或本地安装 PostgreSQL
# macOS: brew install postgresql@15
# Ubuntu: sudo apt install postgresql-15
```

### 4.5 热重载与调试

| 服务 | 热重载 | 调试端口 | 工具 |
|------|--------|---------|------|
| 后端 | nodemon | 9229 | `node --inspect` |
| 前端 | Vite HMR | - | Chrome DevTools |

```bash
# 后端调试模式
cd backend && npm run dev:debug
# 然后在 VS Code 中附加调试器
```

---

## 5. 环境变量完整清单

### 5.1 应用核心配置

| 变量名 | 默认值 | 必需 | 说明 |
|--------|--------|------|------|
| `NODE_ENV` | `production` | 是 | 运行环境: `development` / `production` / `test` |
| `PORT` | `3000` | 否 | 应用监听端口 |
| `HOST` | `0.0.0.0` | 否 | 绑定地址 |
| `LOG_LEVEL` | `info` | 否 | 日志级别: `debug` / `info` / `warn` / `error` |
| `LOG_FORMAT` | `json` | 否 | 日志格式: `json` / `pretty` |

### 5.2 数据库配置

| 变量名 | 默认值 | 必需 | 说明 |
|--------|--------|------|------|
| `DB_HOST` | `db` | 是 | PostgreSQL 主机地址 |
| `DB_PORT` | `5432` | 否 | PostgreSQL 端口 |
| `DB_USER` | `sylva` | 是 | 数据库用户名 |
| `DB_PASSWORD` | `sylva_dev` | 是 | 数据库密码（生产必须修改） |
| `DB_NAME` | `sylva` | 是 | 数据库名称 |
| `DB_SSL` | `false` | 否 | 启用 SSL 连接 |
| `DB_SSL_CA` | - | 否 | SSL CA 证书路径 |
| `DB_POOL_MIN` | `2` | 否 | 连接池最小连接数 |
| `DB_POOL_MAX` | `10` | 否 | 连接池最大连接数 |
| `DB_TIMEOUT` | `30000` | 否 | 查询超时（毫秒） |

### 5.3 JWT 与认证

| 变量名 | 默认值 | 必需 | 说明 |
|--------|--------|------|------|
| `JWT_SECRET` | `change-me-in-production` | 是 | JWT 签名密钥（≥32 字符） |
| `JWT_EXPIRES_IN` | `7d` | 否 | Token 有效期 |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | 否 | Refresh Token 有效期 |
| `BCRYPT_ROUNDS` | `12` | 否 | 密码哈希轮数 |
| `COOKIE_SECURE` | `true` | 否 | 仅 HTTPS 传输 Cookie |
| `COOKIE_SAME_SITE` | `strict` | 否 | Cookie SameSite 策略 |

### 5.4 Ollama（本地 LLM）

| 变量名 | 默认值 | 必需 | 说明 |
|--------|--------|------|------|
| `OLLAMA_ENABLED` | `true` | 否 | 启用 Ollama 集成 |
| `OLLAMA_HOST` | `http://ollama:11434` | 否 | Ollama API 地址 |
| `OLLAMA_MODEL` | `llama3` | 否 | 默认模型 |
| `OLLAMA_TIMEOUT` | `120000` | 否 | 请求超时（毫秒） |
| `OLLAMA_KEEP_ALIVE` | `5m` | 否 | 模型保持加载时间 |

### 5.5 Redis 缓存

| 变量名 | 默认值 | 必需 | 说明 |
|--------|--------|------|------|
| `REDIS_ENABLED` | `true` | 否 | 启用 Redis |
| `REDIS_HOST` | `redis` | 否 | Redis 主机 |
| `REDIS_PORT` | `6379` | 否 | Redis 端口 |
| `REDIS_PASSWORD` | - | 否 | Redis 密码 |
| `REDIS_DB` | `0` | 否 | Redis 数据库索引 |
| `REDIS_PREFIX` | `sylva:` | 否 | Key 前缀 |
| `REDIS_TTL` | `3600` | 否 | 默认缓存时间（秒） |

### 5.6 前端配置

| 变量名 | 默认值 | 必需 | 说明 |
|--------|--------|------|------|
| `VITE_API_URL` | `http://localhost:3000` | 是 | 后端 API 地址 |
| `VITE_WS_URL` | `ws://localhost:3000` | 否 | WebSocket 地址 |
| `VITE_APP_TITLE` | `Sylva Platform` | 否 | 应用标题 |
| `VITE_ENABLE_AI` | `true` | 否 | 启用 AI 功能 |

### 5.7 对象存储（可选）

| 变量名 | 默认值 | 必需 | 说明 |
|--------|--------|------|------|
| `STORAGE_TYPE` | `local` | 否 | 存储类型: `local` / `s3` / `minio` |
| `S3_ENDPOINT` | - | 条件 | S3 兼容端点 |
| `S3_BUCKET` | - | 条件 | Bucket 名称 |
| `S3_ACCESS_KEY` | - | 条件 | Access Key |
| `S3_SECRET_KEY` | - | 条件 | Secret Key |
| `S3_REGION` | `us-east-1` | 否 | S3 区域 |

### 5.8 邮件通知（可选）

| 变量名 | 默认值 | 必需 | 说明 |
|--------|--------|------|------|
| `SMTP_HOST` | - | 否 | SMTP 服务器 |
| `SMTP_PORT` | `587` | 否 | SMTP 端口 |
| `SMTP_USER` | - | 否 | SMTP 用户名 |
| `SMTP_PASS` | - | 否 | SMTP 密码 |
| `SMTP_SECURE` | `false` | 否 | 使用 TLS |
| `FROM_EMAIL` | `noreply@sylva.local` | 否 | 发件人地址 |

### 5.9 监控与追踪（可选）

| 变量名 | 默认值 | 必需 | 说明 |
|--------|--------|------|------|
| `SENTRY_DSN` | - | 否 | Sentry 错误追踪 DSN |
| `SENTRY_ENV` | `production` | 否 | Sentry 环境标签 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | - | 否 | OpenTelemetry 端点 |
| `METRICS_PORT` | `9090` | 否 | Prometheus metrics 端口 |
| `ENABLE_PROFILING` | `false` | 否 | 启用 CPU/Memory 分析 |

---

## 6. 生产环境配置建议

### 6.1 安全加固

```bash
# 1. 修改所有默认密码
# .env.prod
DB_PASSWORD=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 64)
REDIS_PASSWORD=$(openssl rand -base64 32)

# 2. 禁用 root 登录（Docker 已使用非 root 用户）
# Dockerfile 中: USER sylva

# 3. 启用 HTTPS（见第 7 节）

# 4. 配置防火墙
# Ubuntu UFW
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 3000/tcp    # 仅内部访问
sudo ufw deny 5432/tcp    # 仅内部访问
sudo ufw enable
```

### 6.2 Docker 生产优化

```yaml
# docker-compose.override.prod.yml
services:
  sylva-app:
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
    restart: always
    read_only: true
    tmpfs:
      - /tmp:noexec,nosuid,size=100m

  db:
    deploy:
      resources:
        limits:
          memory: 1G
    restart: always
    command: >
      postgres
      -c shared_buffers=256MB
      -c effective_cache_size=768MB
      -c max_connections=100
```

### 6.3 进程管理（非 Docker 部署）

```bash
# 使用 PM2 管理 Node.js 进程
npm install -g pm2

# 配置 ecosystem.config.js
module.exports = {
  apps: [{
    name: 'sylva-backend',
    script: './backend/dist/index.js',
    instances: 'max',        # 使用所有 CPU 核心
    exec_mode: 'cluster',
    env: { NODE_ENV: 'production' },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: './logs/backend-error.log',
    out_file: './logs/backend-out.log',
    merge_logs: true,
    max_memory_restart: '512M',
    watch: false,
    kill_timeout: 5000,
  }]
};

# 启动
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 6.4 环境隔离

```bash
# 使用不同 Compose 文件区分环境
# 开发
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# 生产
docker compose -f docker-compose.yml -f docker-compose.prod.yml up

# 测试
docker compose -f docker-compose.yml -f docker-compose.test.yml up
```

---

## 7. SSL/TLS 配置

### 7.1 使用反向代理（推荐）

#### Nginx

```nginx
# /etc/nginx/sites-available/sylva
server {
    listen 80;
    server_name sylva.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name sylva.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/sylva.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sylva.yourdomain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

#### Traefik（Docker 原生）

```yaml
# docker-compose.traefik.yml
services:
  traefik:
    image: traefik:v3.0
    command:
      - "--api.insecure=true"
      - "--providers.docker=true"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.tlschallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.email=admin@yourdomain.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./letsencrypt:/letsencrypt

  sylva-app:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.sylva.rule=Host(`sylva.yourdomain.com`)"
      - "traefik.http.routers.sylva.entrypoints=websecure"
      - "traefik.http.routers.sylva.tls.certresolver=letsencrypt"
      - "traefik.http.services.sylva.loadbalancer.server.port=3000"
```

### 7.2 Let's Encrypt 自动证书

```bash
# 使用 Certbot
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d sylva.yourdomain.com

# 自动续期（已内置 cron）
sudo certbot renew --dry-run
```

### 7.3 自签名证书（内部测试）

```bash
# 生成自签名证书
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ./ssl/server.key -out ./ssl/server.crt \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

# Docker Compose 中挂载
docker compose -f docker-compose.yml -f docker-compose.ssl.yml up
```

---

## 8. 备份策略

### 8.1 备份内容

| 数据类型 | 位置 | 备份频率 | 保留周期 |
|---------|------|---------|---------|
| 数据库 | PostgreSQL Volume | 每日 | 30 天 |
| 上传文件 | sylva_uploads Volume | 每日 | 30 天 |
| 模型文件 | ollama_data Volume | 每周 | 7 天 |
| 配置文件 | .env, docker-compose | 每次修改 | 版本控制 |
| 日志 | logs/ | 实时 | 7 天 |

### 8.2 自动化备份脚本

```bash
#!/bin/bash
# scripts/backup.sh

BACKUP_DIR="/backup/sylva"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

# 1. 数据库备份
docker compose exec -T db pg_dump -U sylva sylva | gzip > "$BACKUP_DIR/db_${DATE}.sql.gz"

# 2. 上传文件备份
tar czf "$BACKUP_DIR/uploads_${DATE}.tar.gz" -C /var/lib/docker/volumes/sylva-platform_sylva_uploads/_data .

# 3. 模型文件备份（可选，较大）
tar czf "$BACKUP_DIR/ollama_${DATE}.tar.gz" -C /var/lib/docker/volumes/sylva-platform_ollama_data/_data .

# 4. 清理旧备份
find "$BACKUP_DIR" -name "*.gz" -mtime +$RETENTION_DAYS -delete

echo "备份完成: $BACKUP_DIR"
```

### 8.3 定时备份（Cron）

```bash
# crontab -e
# 每日凌晨 3 点备份
0 3 * * * /path/to/sylva-platform/scripts/backup.sh >> /var/log/sylva-backup.log 2>&1

# 每周日备份模型文件
0 4 * * 0 /path/to/sylva-platform/scripts/backup-ollama.sh
```

### 8.4 云存储同步

```bash
# 使用 rclone 同步到 S3/阿里云 OSS
rclone sync /backup/sylva remote:sylva-backups

# 或使用 AWS CLI
aws s3 sync /backup/sylva s3://your-bucket/sylva-backups/ --delete
```

### 8.5 恢复流程

```bash
# 1. 停止服务
docker compose down

# 2. 恢复数据库
zcat backup/db_20260519_030000.sql.gz | docker compose exec -T db psql -U sylva

# 3. 恢复上传文件
docker run --rm -v sylva-platform_sylva_uploads:/target \
  -v $(pwd)/backup:/backup alpine \
  tar xzf /backup/uploads_20260519.tar.gz -C /target

# 4. 重启服务
docker compose up -d

# 5. 验证
curl http://localhost:3000/health
```

---

## 9. 升级流程

### 9.1 标准升级流程

```bash
# 1. 备份当前数据
./scripts/backup.sh

# 2. 拉取最新代码
git fetch origin
git checkout v2.7.0  # 或最新 tag

# 3. 查看更新日志
cat CHANGELOG.md

# 4. 更新依赖
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# 5. 执行数据库迁移（如有）
docker compose exec sylva-app npm run db:migrate

# 6. 重新构建并部署
./scripts/deploy.sh -e prod -p docker

# 7. 验证升级
curl http://localhost:3000/health
curl http://localhost:3000/api/version
```

### 9.2 零停机升级（蓝绿部署）

```bash
# 1. 启动新版本（绿色环境）
COMPOSE_PROJECT_NAME=sylva-green docker compose -f docker-compose.yml up -d

# 2. 等待健康检查
sleep 30
curl http://localhost:3001/health  # 绿色环境端口

# 3. 切换流量（修改反向代理配置）
# Nginx: proxy_pass http://localhost:3001;
# 或 DNS 切换

# 4. 验证稳定后关闭旧版本（蓝色环境）
COMPOSE_PROJECT_NAME=sylva-blue docker compose down
```

### 9.3 数据库迁移策略

```bash
# 向前兼容迁移（先改代码，后改库）
# 适用于: 添加新字段/表

# 1. 部署兼容新旧代码的版本
# 2. 执行迁移
docker compose exec sylva-app npm run db:migrate
# 3. 部署完整新版本

# 向后兼容迁移（先改库，后改代码）
# 适用于: 删除字段/表

# 1. 执行迁移（字段标记废弃但保留）
docker compose exec sylva-app npm run db:migrate
# 2. 部署新版本
# 3. 下一个版本清理废弃字段
```

### 9.4 回滚方案

```bash
# 快速回滚到上一版本
git checkout HEAD~1
./scripts/deploy.sh -e prod -p docker -s

# 或回滚到特定 tag
git checkout v2.6.0
./scripts/deploy.sh -e prod -p docker

# 数据库回滚（需提前准备 down 迁移）
docker compose exec sylva-app npm run db:migrate:down
```

---

## 10. 监控和告警设置

### 10.1 健康检查端点

| 端点 | 说明 | 预期响应 |
|------|------|---------|
| `GET /health` | 基础健康检查 | `{ "status": "ok" }` |
| `GET /health/live` | 存活探针 | HTTP 200 |
| `GET /health/ready` | 就绪探针 | HTTP 200（依赖就绪） |
| `GET /metrics` | Prometheus 指标 | 文本格式 |

### 10.2 Prometheus 配置

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'sylva-app'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'

  - job_name: 'postgres-exporter'
    static_configs:
      - targets: ['localhost:9187']

  - job_name: 'redis-exporter'
    static_configs:
      - targets: ['localhost:9121']
```

### 10.3 Grafana 仪表盘

导入 dashboards：

- **Sylva Overview**: 请求量、响应时间、错误率
- **Node.js Runtime**: 内存、CPU、事件循环延迟
- **PostgreSQL**: 连接数、查询性能、锁等待
- **Redis**: 命中率、内存使用、命令速率
- **Docker**: 容器资源使用、重启次数

### 10.4 告警规则

```yaml
# alert-rules.yml
groups:
  - name: sylva-alerts
    rules:
      - alert: SylvaHighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Sylva 错误率过高"

      - alert: SylvaHighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Sylva P95 延迟超过 2 秒"

      - alert: DatabaseConnectionsHigh
        expr: pg_stat_activity_count > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "PostgreSQL 连接数接近上限"

      - alert: DiskSpaceLow
        expr: (node_filesystem_avail_bytes / node_filesystem_size_bytes) < 0.1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "磁盘空间不足 10%"
```

### 10.5 告警通知

| 渠道 | 配置方式 | 适用场景 |
|------|---------|---------|
| 邮件 | SMTP 环境变量 | 一般告警 |
| Slack | Webhook | 团队通知 |
| PagerDuty | 集成密钥 | 严重告警 |
| 短信 | 第三方 API | 紧急故障 |

---

## 11. 故障排查 FAQ

### Q1: 部署脚本报错 "Docker 未安装"

**症状**: `Docker 未安装或不在 PATH 中`

**排查步骤**:
1. 确认 Docker Desktop / Engine 已安装并运行
2. 检查 PATH 环境变量包含 Docker 路径
3. 尝试 `docker --version` 手动验证
4. Windows: 确保在 PowerShell 中运行，而非 CMD
5. Linux: 确认当前用户已加入 `docker` 组: `sudo usermod -aG docker $USER`

**解决**:
```bash
# Linux 用户组问题
sudo systemctl restart docker
newgrp docker  # 或重新登录
```

---

### Q2: 端口 3000 已被占用

**症状**: `端口 3000 已被占用 (PID: xxxx)`

**排查步骤**:
```bash
# 查找占用进程
lsof -i :3000        # macOS/Linux
netstat -ano | findstr :3000   # Windows

# 查看进程详情
ps -p <PID> -o pid,comm,args
```

**解决**:
```bash
# 方法 A: 终止占用进程
kill -9 <PID>        # Linux/macOS
Stop-Process -Id <PID> -Force  # PowerShell

# 方法 B: 修改 Sylva 端口
# .env: PORT=3001
# 然后重新部署
```

---

### Q3: 数据库连接失败

**症状**: `ECONNREFUSED 127.0.0.1:5432` 或 `password authentication failed`

**排查步骤**:
1. 检查数据库容器是否运行: `docker compose ps db`
2. 检查数据库日志: `docker compose logs db`
3. 验证环境变量中的 DB_PASSWORD 与数据库一致
4. 检查网络连通性: `docker compose exec sylva-app ping db`

**解决**:
```bash
# 重置数据库（数据丢失警告！）
docker compose down -v   # 删除 volume
docker compose up -d db    # 重新初始化

# 或修改密码
docker compose exec db psql -U postgres -c "ALTER USER sylva WITH PASSWORD 'newpass';"
```

---

### Q4: Docker 镜像构建失败

**症状**: `npm ERR! code ECONNRESET` 或 `failed to solve: executor failed`

**排查步骤**:
1. 检查网络连接（国内需配置镜像源）
2. 查看详细构建日志: `docker compose build --progress=plain`
3. 确认 frontend/backend package.json 完整
4. 检查 Docker 磁盘空间: `docker system df`

**解决**:
```bash
# 配置国内 npm 镜像
echo "registry=https://registry.npmmirror.com" >> .npmrc

# 清理 Docker 缓存
docker system prune -a
docker builder prune -f

# 重试构建
./scripts/deploy.sh -e prod -p docker
```

---

### Q5: 健康检查超时

**症状**: `健康检查超时，服务可能未正常启动`

**排查步骤**:
1. 查看应用日志: `docker compose logs -f sylva-app`
2. 检查端口映射: `docker compose port sylva-app 3000`
3. 检查容器资源限制: `docker stats`
4. 确认数据库迁移已完成

**解决**:
```bash
# 增加启动等待时间（脚本参数或环境变量）
export STARTUP_TIMEOUT=120
./scripts/deploy.sh

# 手动检查服务
curl -v http://localhost:3000/health

# 检查应用内部错误
docker compose exec sylva-app cat logs/error.log
```

---

### Q6: Ollama 模型下载失败

**症状**: `Error: could not connect to ollama server` 或模型下载卡住

**排查步骤**:
1. 检查 Ollama 容器状态: `docker compose ps ollama`
2. 检查 Ollama 日志: `docker compose logs ollama`
3. 确认模型名称正确: `llama3` vs `llama3:8b`
4. 检查磁盘空间（模型文件通常 4GB+）

**解决**:
```bash
# 手动拉取模型
docker compose exec ollama ollama pull llama3

# 使用国内镜像源（如可用）
# 或预先下载模型文件到 volume

# 禁用 Ollama（如不需要）
# .env: OLLAMA_ENABLED=false
```

---

### Q7: 前端页面空白或 404

**症状**: 浏览器打开 `http://localhost:3000` 显示空白页或 404

**排查步骤**:
1. 检查前端是否正确构建: `ls frontend/dist/`
2. 检查 Docker 中静态文件: `docker compose exec sylva-app ls /app/public/`
3. 查看浏览器开发者工具 Console/Network
4. 确认 VITE_API_URL 配置正确

**解决**:
```bash
# 重新构建前端
cd frontend && npm run build && cd ..

# 重新构建 Docker 镜像
./scripts/deploy.sh -e prod -p docker

# 或使用开发模式查看详细错误
./scripts/deploy.sh -e dev -p local
```

---

### Q8: JWT 认证失败 / 无法登录

**症状**: `401 Unauthorized` 或 `jwt expired`

**排查步骤**:
1. 检查 JWT_SECRET 是否一致（多实例部署时）
2. 确认系统时间同步: `date`
3. 检查 Token 有效期设置
4. 查看认证日志

**解决**:
```bash
# 重新生成密钥
openssl rand -base64 64

# 更新 .env 后重启
./scripts/deploy.sh -e prod -p docker

# 清除浏览器 LocalStorage / Cookie
```

---

### Q9: 内存占用过高 / OOM

**症状**: 容器被 Kill，系统响应缓慢

**排查步骤**:
1. 查看内存使用: `docker stats` / `free -h`
2. 检查 Node.js 堆内存: `docker compose exec sylva-app node -e "console.log(process.memoryUsage())"`
3. 检查是否有内存泄漏（持续增长的内存曲线）
4. 检查 Ollama 模型加载数量

**解决**:
```bash
# 限制容器内存
docker compose -f docker-compose.yml -f docker-compose.prod.yml up

# 或修改 docker-compose.yml:
# deploy.resources.limits.memory: 2G

# Node.js 堆内存限制
NODE_OPTIONS="--max-old-space-size=1536"

# Ollama 保持模型时间缩短
OLLAMA_KEEP_ALIVE=1m
```

---

### Q10: 日志文件过大占满磁盘

**症状**: 磁盘空间告警，日志目录体积庞大

**排查步骤**:
1. 检查日志大小: `du -sh logs/` / `du -sh /var/lib/docker/containers/`
2. 查看日志轮转配置
3. 检查是否有异常高频错误日志

**解决**:
```bash
# 配置 Docker 日志轮转
# /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}

# 手动清理日志
docker compose logs --tail=100  # 限制日志保留
truncate -s 0 /var/lib/docker/containers/*/*.log  # 清空容器日志

# 使用 logrotate
# /etc/logrotate.d/sylva
/path/to/sylva/logs/*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
}
```

---

### Q11: 部署后 CSS/JS 文件 404（缓存问题）

**症状**: 页面加载但样式缺失，控制台显示静态资源 404

**排查步骤**:
1. 确认构建产物存在: `ls frontend/dist/assets/`
2. 检查文件名是否包含 hash（缓存破坏）
3. 查看 Nginx/反向代理的静态文件配置

**解决**:
```bash
# 强制刷新浏览器缓存: Ctrl+Shift+R

# 确认构建包含 hash
# vite.config.ts 中:
# build.rollupOptions.output.entryFileNames = 'assets/[name]-[hash].js'

# Nginx 缓存头配置
location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

---

### Q12: Windows 下 PowerShell 执行策略阻止

**症状**: `无法加载文件 deploy.ps1，因为在此系统上禁止运行脚本`

**解决**:
```powershell
# 临时允许当前会话
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process

# 或永久允许本地脚本（推荐）
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 然后运行脚本
.\scripts\deploy.ps1
```

---

## 12. 性能调优建议

### 12.1 数据库优化

```sql
-- 常用查询索引
CREATE INDEX CONCURRENTLY idx_documents_user_id ON documents(user_id);
CREATE INDEX CONCURRENTLY idx_documents_created_at ON documents(created_at DESC);
CREATE INDEX CONCURRENTLY idx_conversations_session ON conversations(session_id, updated_at DESC);

-- 配置优化（postgresql.conf）
shared_buffers = 256MB          # 25% 内存
effective_cache_size = 768MB    # 75% 内存
work_mem = 4MB                  # 每连接
maintenance_work_mem = 64MB
max_connections = 100
```

### 12.2 Node.js 优化

```bash
# 环境变量
UV_THREADPOOL_SIZE=128          # libuv 线程池
NODE_OPTIONS="--max-old-space-size=2048"

# Cluster 模式（多核利用）
# 已通过 Docker / PM2 配置
```

### 12.3 前端优化

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          ui: ['@mui/material', '@emotion/react'],
          ai: ['openai', 'ollama'],
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
});
```

### 12.4 Docker 性能

```yaml
# docker-compose.prod.yml
services:
  sylva-app:
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
    healthcheck:
      interval: 30s        # 生产环境降低频率
      timeout: 10s

  db:
    sysctls:
      - net.core.somaxconn=1024
    ulimits:
      nofile:
        soft: 65536
        hard: 65536
```

### 12.5 缓存策略

| 层级 | 工具 | TTL | 适用数据 |
|------|------|-----|---------|
| 浏览器 | Service Worker | 长期 | 静态资源 |
| CDN | CloudFlare / 阿里云 | 1h-24h | 公共 API |
| 应用 | Redis | 1m-1h | 会话、热点数据 |
| 数据库 | PostgreSQL Cache | 自动 | 查询结果 |

### 12.6 负载测试

```bash
# 使用 k6 进行压力测试
k6 run --vus 50 --duration 5m script.js

# 示例脚本
import http from 'k6/http';
export default function () {
  http.get('http://localhost:3000/health');
  http.post('http://localhost:3000/api/chat', {
    message: 'Hello',
    model: 'llama3'
  });
}
```

---

## 附录

### A. 常用命令速查

```bash
# 部署
./scripts/deploy.sh -e prod -p docker    # 生产 Docker
./scripts/deploy.sh -e dev -p local      # 开发本地

# 日志
docker compose logs -f sylva-app
docker compose logs -f --tail=100 db

# 管理
docker compose ps
docker compose down
docker compose down -v    # 含 volume
docker compose exec sylva-app sh

# 构建
docker compose build --no-cache
docker compose up -d --build

# 数据库
docker compose exec db psql -U sylva
docker compose exec sylva-app npm run db:migrate
```

### B. 支持矩阵

| 功能 | Docker | 本地 | 说明 |
|------|--------|------|------|
| 一键部署 | ✅ | ✅ | 均支持脚本 |
| 热重载 | ✅ | ✅ | Dev profile / Vite |
| 自动 HTTPS | ⚠️ | ❌ | 需反向代理 |
| 数据库持久化 | ✅ | 需手动 | Volume vs 本地安装 |
| GPU 加速 | ✅ | ✅ | NVIDIA Container Toolkit |
| 多实例 | ✅ | ❌ | Docker / K8s |

### C. 相关文档

- [CONTRIBUTING.md](./CONTRIBUTING.md) - 贡献者指南
- [API 文档](./api.md) - RESTful API 参考
- [架构设计](./architecture.md) - 系统架构说明

---

*本文档由 Sylva Platform CI/CD 系统自动生成，版本 2.6.0*
