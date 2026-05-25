# 🎬 视频追剧记录 - Video Tracker

一个轻量级的视频观看记录管理工具，支持记录观看进度（集数/时长），提供增删改查功能，可通过 Docker 一键部署。

## 功能特性

- ✅ 添加/编辑/删除视频记录
- ✅ 记录观看进度（集数或时长）
- ✅ 分类管理（电视剧、电影、动漫、综艺、纪录片等）
- ✅ 状态标记（在看、已看完、想看、弃剧）
- ✅ 评分和备注
- ✅ 搜索和筛选
- ✅ 统计概览
- ✅ 响应式设计，支持手机访问
- ✅ Docker 一键部署

## 快速部署（Docker）

### 1. 上传项目到服务器

```bash
# 将整个 video-tracker 目录上传到服务器
scp -r video-tracker/ user@your-server:/opt/video-tracker/
```

### 2. 修改密钥

```bash
cd /opt/video-tracker
# 编辑 .env 文件，修改 SECRET_KEY 为随机字符串
echo "SECRET_KEY=$(openssl rand -hex 32)" > .env
```

### 3. 启动服务

```bash
docker compose up -d --build
```

### 4. 访问

浏览器打开 `http://your-server-ip:5000`

## 自定义端口

编辑 `docker-compose.yml`，修改端口映射：

```yaml
ports:
  - "8080:5000"  # 将 8080 改为你想要的端口
```

然后重新启动：

```bash
docker compose down && docker compose up -d --build
```

## 数据备份

数据存储在 Docker volume `tracker-data` 中，备份方法：

```bash
# 备份
docker cp video-tracker:/data/videos.db ./backup-$(date +%Y%m%d).db

# 恢复
docker cp ./backup-20260101.db video-tracker:/data/videos.db
docker compose restart
```

## 常用命令

```bash
# 查看日志
docker compose logs -f

# 重启服务
docker compose restart

# 停止服务
docker compose down

# 更新代码后重新构建
docker compose up -d --build
```

## 技术栈

- **后端**: Python + Flask + SQLite
- **前端**: 原生 HTML/CSS/JavaScript
- **部署**: Docker + Gunicorn
