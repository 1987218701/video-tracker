# Media Tracker

个人多媒体观看 / 阅读追踪器，支持**影视、教程、书籍**三类内容的进度管理、评分、变更历史与统计。
前后端分离：Flask 提供 `/api` JSON 接口并托管 Vue 3 单页应用，SQLite 落库，Docker 一体化部署。

## 功能特性

### 内容追踪

- **影视**：剧集模式（总集数 / 当前集 / 本集已看分钟）与电影模式（总时长 / 已看时长）。
  分类采用**可多选标签**：`电影` / `电视剧` 为互斥的「形式标签」，决定进度模式（选中即自动切换并清空互斥字段，
  不会出现让电影填「总集数」的情况）；其余为「类型标签」（动画 / 科幻 / 纪录片…）可任意叠加，
  因此「动漫类型的电影」可以记为 `电影、动画、奇幻`。
- **教程**：章节列表（第几节 + 名称，勾选完成自动统计进度），也支持总节数 / 当前节的简式记录。
- **书籍**：总页数 / 当前页 + 百分比进度。
- **通用**：`想看 / 在看 / 已看完` 三状态、五星评分、子分类选择、封面图与外部链接。
  状态选「已看完」时进度自动记为 100%，表单直接隐藏整块进度填写区（只留一条提示与已有总数摘要），
  不会出现空半行的占位；列表与详情统一显示满进度（未存满进度的历史数据同样按 100% 展示）。
  文本字段按内容类型换名：影视叫**简介**（可由 TMDB 自动填充），教程 / 书籍叫**备注**。
- 「弃置」状态已从界面移除（原先既无快捷入口也无实际使用场景）；后端仍接受该值以兼容历史数据与旧 CSV，
  编辑这类旧记录时会显示「弃置（历史）」，可正常改成上述三种状态之一。
- 顶部导航栏切换内容类型；状态筛选 Chip 显示各状态数量；右下角悬浮加号添加；放大镜点击后展开搜索；
  删除前弹出该条记录完整信息再确认。

### 记录与统计

- 独立 **变更历史表**：创建、编辑（状态 / 进度 / 评分 diff）、章节增删改、CSV 导入均留痕；
  `已看完 → 在看` 自动累计重看次数。详情页展示时间线，统计页展示最近动态。
- **统计页**：四张主题色概览卡（总记录 / 在看在读 / 已完成 / 平均评分，各带语义进度条：
  本月占比、进行中占比、完成率、满分比），状态 / 类型 / 评分三列分布图，
  近 182 天**日历热力图**，最近动态横跨整行；宽屏 4 列、中屏 2 列、手机单列。
- **CSV 导入导出**：UTF-8 BOM（Excel 直接打开不乱码），中文或英文表头均可，
  自动识别 UTF-8 / GBK，按 `(类型, 标题)` 跳过重复项。
- **元数据补全（可选）**：配置 `TMDB_API_KEY` 后，影视添加页搜索并点选结果即可自动填充
  标题、**简介**、封面、外部链接、**多类型标签**，并按类型自动带出进度初始值：
  - 电影 → 从详情接口取 `runtime` 填入「总时长」，「已看时长」默认 `0`；
  - 电视剧 → 取 `number_of_episodes` 填入「总集数」，「当前看到」默认 `1`。

  搜索接口只返回标题与类型 id（含截断简介），片长 / 集数 / 完整简介需再调详情接口；
  详情失败时降级为「截断简介 + 已填基本信息 + 提示手动填写」，TMDB 无简介时不会清空用户已写内容。
  简介存于 `items.note` 列（无需迁移），界面上影视显示为「简介」，教程 / 书籍仍为「备注」。
  TMDB 返回的未知类型会自动加入可选项，中英/复合类型名按别名表归一化。未配置 key 时仍可手动填写。
- **PWA**：可安装到桌面 / 主屏，Service Worker 采用「网络优先、失败回退缓存」，避免旧版 JS/CSS 残留。
- 响应式布局，适配桌面与手机。

## 技术栈

- **后端**：Python + Flask（Blueprint，`/api` 前缀）+ SQLite（WAL、`foreign_keys=ON`）
- **前端**：Vue 3 Composition API（CDN 引入，无需构建）+ 原生 CSS + SVG 图标
- **部署**：Docker Compose + Gunicorn，Flask 同时托管静态资源（单容器，无独立前端服务）
- **可选外部服务**：TMDB 元数据搜索 / 详情（`TMDB_API_KEY` 未配置时全部功能可用，仅不自动补全）

## 数据模型

### items 表（统一存储三类内容）

| 字段 | 说明 |
|------|------|
| id | 主键 |
| type | `video` / `tutorial` / `book` |
| title | 标题 |
| category | 子分类。教程/书籍为单选值；影视存**多标签**，用顿号 `、` 拼接（如 `电影、动画、家庭、奇幻`），沿用原 TEXT 字段无需迁移，也避免与 CSV 逗号分隔冲突 |
| status | `想看` / `在看` / `已看完`；`弃置` 为历史兼容值，界面不再提供 |
| total_count | 总集数 / 总节数 |
| current_position | 当前集 / 节 |
| current_minutes | 本集已看分钟 |
| total_duration_min | 电影总时长（分钟） |
| current_duration_min | 电影已看时长（分钟） |
| total_pages | 总页数 |
| current_page | 当前页码 |
| rating | 0–5 星 |
| note | 文本字段：影视存**简介**（TMDB 自动填充），教程 / 书籍存**备注**；CSV 表头仍为「备注」以兼容旧文件 |
| cover_color | 卡片主题色 |
| cover_url | 封面图链接 |
| external_url | 外部链接（豆瓣 / TMDB / B站等） |
| rewatch_count | 重看次数 |
| created_at / updated_at | 时间戳 |

### chapters 表（教程章节）

| 字段 | 说明 |
|------|------|
| item_id | 关联 `items.id`，级联删除 |
| seq | 序号 |
| title | 章节名称 |
| completed | 0 / 1 |

### history 表（变更历史）

| 字段 | 说明 |
|------|------|
| item_id | 关联 `items.id`，级联删除 |
| action | `created`（新建 / CSV 导入）/ `status` / `progress` / `rating` / `edited`（其它字段）/ `chapter`（章节增删改） |
| summary | 人类可读摘要，例如 `状态：想看 → 在看；进度：3/24 集 → 9/24 集；评分：4 → 5` |
| created_at | 时间戳 |

> **存量库平滑升级**：`init_db()` 通过 `PRAGMA table_info(items)` 检查列，
> 自动 `ALTER TABLE ADD COLUMN` 补齐 `cover_url` / `external_url` / `rewatch_count`，
> 并 `CREATE TABLE IF NOT EXISTS history`；旧数据不会丢失，无需手工执行 SQL。

## API

所有接口统一挂在 `/api` 下。

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/items?type=&status=&keyword=&sort=&page=&per_page=` | 列表查询（分页） |
| GET | `/api/items/:id` | 单条详情 |
| POST | `/api/items` | 创建 |
| PUT | `/api/items/:id` | 更新（自动写历史 diff / 重看计数） |
| DELETE | `/api/items/:id` | 删除（级联删章节与历史） |
| GET | `/api/items/:id/history?limit=50` | 某条记录的变更时间线 |
| GET | `/api/items/:id/chapters` | 章节列表 |
| POST | `/api/items/:id/chapters` | 添加章节 |
| PUT | `/api/items/:id/chapters/:ch_id` | 更新章节 |
| DELETE | `/api/items/:id/chapters/:ch_id` | 删除章节 |
| GET | `/api/stats?type=` | 统计：状态数、类型/评分分布、平均分、重看数、本月新增、历史总数 |
| GET | `/api/activity?days=182&type=` | 日历热力图（按 `TZ_OFFSET_HOURS` 时区聚合，7–366 天） |
| GET | `/api/recent-activity?limit=12` | 最近动态（历史 join 标题） |
| GET | `/api/export?type=` | 导出 CSV（UTF-8 BOM，中文表头） |
| POST | `/api/import` | 导入 CSV，`multipart/form-data` 字段名 `file` |
| GET | `/api/metadata/config` | 返回 `{enabled}`，前端据此显示「搜索补全」 |
| GET | `/api/metadata/search?q=` | TMDB 搜索 `/3/search/multi`（未配置 key 返回 503） |
| GET | `/api/metadata/detail?media_type=movie\|tv&id=` | TMDB 详情：电影返回 `runtime` / `total_duration_min` / `current_duration_min=0`；剧集返回 `number_of_episodes` / `total_count` / `current_position=1`；两者均返回 `genres[]` 与完整 `overview`（未配置 key 返回 503，参数非法返回 400） |
| GET | `/health` | 健康检查 |
| GET | `/manifest.json` `/sw.js` `/icon.svg` | PWA 资源（`/sw.js` 返回 `no-cache`） |

导入返回示例：

```json
{"created": 2, "skipped": 0, "error_count": 0, "errors": []}
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_PATH` | `instance/tracker.db` | SQLite 文件路径；Docker 中为 `/data/tracker.db` |
| `SECRET_KEY` | 开发用占位值 | 生产务必修改 |
| `PORT` | 自动寻找 5001–5005 | 本地开发端口（显式设置后不再自动寻找） |
| `DEBUG` | 本地 `True` / 生产 `False` | Flask debug 与 reloader 开关 |
| `TMDB_API_KEY` | 空 | 配置后启用影视元数据搜索补全（须为 **API Key (v3 auth)**） |
| `TMDB_API_BASE` | 空 | 可选，覆盖首选 TMDB API 地址；留空时依次尝试 `api.tmdb.org/3`、`api.themoviedb.org/3` |
| `TMDB_IMAGE_BASE` | `https://image.tmdb.org/t/p/w500` | 海报 CDN 前缀，可改成自建反代 |
| `TMDB_TIMEOUT` | `5` | 单个 API 地址的请求超时秒数 |
| `TZ_OFFSET_HOURS` | `8` | 热力图 / 动态按该 UTC 偏移统计「今天」，例如东八区为 8 |

## 快速部署

```bash
# 1. 生成密钥（可选：启用 TMDB 元数据补全）
echo "SECRET_KEY=$(openssl rand -hex 32)" > .env
# echo "TMDB_API_KEY=your_tmdb_api_key" >> .env

# 2. 拉取预构建镜像并启动（推荐）
docker compose pull && docker compose up -d
# 若需要从源码本地构建，改用：docker compose up -d --build

# 3. 访问
# http://your-server-ip:5000
```

`docker-compose.yml` 已预置 `TMDB_API_KEY` 及 `TMDB_API_BASE` / `TMDB_IMAGE_BASE` / `TMDB_TIMEOUT`
（未设置时为空，等同使用默认值），只需在 `.env` 中填值即可。
Docker 生产端口为容器内 5000，与宿主机上占用 5000 的程序互不影响（容器独立网络空间，可通过 `ports` 映射修改）。

### 使用预构建镜像（服务器推荐）

每次 push 到 `main`，`.github/workflows/docker-publish.yml` 会自动构建
`linux/amd64` + `linux/arm64` 镜像并推送到 GHCR：`ghcr.io/1987218701/video-tracker:latest`
（同时打 `sha-<短提交号>` 标签，便于固定版本或回滚）。

首次使用需先让服务器有权拉取该镜像，二选一：

- **设为公开**：GitHub 仓库 → 右侧 `Packages` → `video-tracker` → `Package settings` →
  `Change visibility` → Public。
- **保持私有**：在服务器登录（PAT 需 `read:packages` 权限）：
  ```bash
  echo '<PAT>' | docker login ghcr.io -u <GitHub用户名> --password-stdin
  ```

服务器上首次切换（需要 `git pull` 取得含 `image` 字段的新 compose）：

```bash
cd ~/video-tracker
git pull
docker compose pull
docker compose up -d
```

之后的日常更新只需两条命令，服务器**不再需要本地编译、也不必 `git pull`**（代码已打包进镜像）：

```bash
docker compose pull && docker compose up -d
```

- 想一条命令完成：`docker compose up -d --pull always`。
- 固定版本或回滚：在 `.env` 写 `IMAGE_TAG=sha-xxxxxxx` 后再 pull。
- 只有改了 `docker-compose.yml` / `Dockerfile` 等部署配置时才需要 `git pull`。
- `docker compose up -d` 默认不主动检查远端新镜像，所以 `pull` 不能省。
- 服务器访问 `ghcr.io` 不通时，可退回源码构建 `docker compose up -d --build`（compose 保留了 `build: .`）。

数据在命名卷 `tracker-data` 中，切换构建方式不会丢数据；切勿执行 `docker compose down -v`。

### 服务器一键部署（无域名 / 仅自己使用）

已安装 Docker 的 Linux 服务器，把代码放到 `/opt/video-tracker` 后执行：

```bash
bash deploy.sh
```

脚本会生成含随机 `SECRET_KEY` 的 `.env`、把服务**只绑定到 `127.0.0.1`**、构建启动并等待 `/health` 就绪。
应用本身没有登录鉴权，请勿把 5000 端口直接暴露公网。在自己电脑上建立 SSH 隧道后访问
`http://127.0.0.1:5000`：

```bash
ssh -L 5000:127.0.0.1:5000 <用户名>@<服务器IP>
```

可用 `HOST_PORT=8080 bash deploy.sh` 改宿主机端口（隧道端口同步改为 8080）。
脚本不会改动已有的 `.env` 和数据卷，可重复执行；数据不迁移时启动后即为全新空库。

### 配置 TMDB 元数据补全（可选）

1. 在 `themoviedb.org` 登录 → Settings → API → Request an API Key → 以 **Developer** 身份申请。
2. `Type of Use` 选 `Personal`；`Application Summary` 用**英文**写 100–200 词，说明应用用途、
   调用哪些接口、保存哪些字段、非商业单人使用；不要写中文、不要放 URL 或特殊符号，
   否则会报 `Application summary please elaborate on how you plan to use our API`。
3. 申请通过后复制 **API Key (v3 auth)**（32 位十六进制字符串）。
   **不要**用 `API Read Access Token (v4 auth)`——本项目通过 `?api_key=` 查询参数调用 v3 接口。
4. 写入 `.env`，重启服务；访问 `/api/metadata/config` 返回 `{"enabled":true}` 即生效。
   本地开发由 `load_dotenv()` 自动读取 `.env`，无需改 compose。

项目已在添加/编辑弹窗中展示 TMDB 要求的归因声明
（`This product uses the TMDB API but is not endorsed or certified by TMDB.`）及来源链接；
按 TMDB 条款使用时还应展示其官方 Logo。未配置 key 时所有功能不受影响，可手动填写封面与外部链接。

**网络说明**：`api.themoviedb.org` 在部分网络下会被 DNS 污染导致连接超时，
因此后端默认先请求 `https://api.tmdb.org/3`，失败后自动回退到 `https://api.themoviedb.org/3`，
也可用 `TMDB_API_BASE` 指向自建反代。若 `image.tmdb.org` 同样不可达，补全出的封面图会显示不出来
（元数据文字正常），此时可把 `TMDB_IMAGE_BASE` 指向可用的图片反代，或手动填写封面链接。

## 本地开发

```bash
pip install -r requirements.txt
python -m app.main
# http://127.0.0.1:5001
```

默认从 **5001** 起自动寻找可用端口（最多试到 5005），用于避开 PyCharm 等工具占用的 5000；
全部被占用时打印明确提示并退出。也可显式指定：

```bash
PORT=8080 python -m app.main
```

> 前端 JS/CSS 无构建步骤，修改后刷新即可。若浏览器仍显示旧界面，请硬刷新
> （Ctrl+Shift+R）或在开发者工具中清空站点缓存；Service Worker 已设为网络优先。

## 数据备份与迁移

```bash
# 直接备份 SQLite（含 items / chapters / history 全量数据）
docker cp video-tracker:/data/tracker.db ./backup-$(date +%Y%m%d).db
```

也可在「统计」页点击**导出 CSV** 生成可移植文件，再用**导入 CSV** 在另一实例恢复
（注意：CSV 不包含章节列表与历史时间线，完整备份请用上面的 `.db` 文件）。
