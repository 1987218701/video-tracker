import sqlite3
import os
from flask import g


def get_database_path():
    """获取数据库路径，确保目录存在"""
    env_path = os.environ.get('DATABASE_PATH')
    if env_path:
        db_path = env_path
    else:
        db_path = os.path.join(os.path.dirname(__file__), '..', 'instance', 'tracker.db')

    db_dir = os.path.dirname(db_path)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)

    return db_path


DATABASE = get_database_path()


def get_db():
    """获取数据库连接"""
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


def close_db(e=None):
    """关闭数据库连接"""
    db = g.pop('db', None)
    if db is not None:
        db.close()


# items 表后续新增的列，用于存量数据库平滑升级
ITEM_MIGRATIONS = {
    'cover_url': "TEXT DEFAULT ''",
    'external_url': "TEXT DEFAULT ''",
    'rewatch_count': 'INTEGER DEFAULT 0',
}


def migrate_items(db):
    """为已存在的 items 表补齐新增列（SQLite 不支持 IF NOT EXISTS 的 ADD COLUMN）"""
    existing = {row['name'] for row in db.execute('PRAGMA table_info(items)').fetchall()}
    added = []
    for column, definition in ITEM_MIGRATIONS.items():
        if column not in existing:
            db.execute(f'ALTER TABLE items ADD COLUMN {column} {definition}')
            added.append(column)
    return added


def init_db():
    """初始化数据库表，并对存量库做无损迁移"""
    db = get_db()

    cursor = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='items'")
    table_exists = cursor.fetchone()

    if not table_exists:
        print("Creating new tables: items, chapters, history...")
        db.execute('''
            CREATE TABLE items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL DEFAULT 'video',
                title TEXT NOT NULL,
                category TEXT DEFAULT '',
                status TEXT DEFAULT '想看',
                total_count INTEGER DEFAULT NULL,
                current_position INTEGER DEFAULT NULL,
                current_minutes INTEGER DEFAULT NULL,
                total_duration_min INTEGER DEFAULT NULL,
                current_duration_min INTEGER DEFAULT NULL,
                total_pages INTEGER DEFAULT NULL,
                current_page INTEGER DEFAULT NULL,
                rating INTEGER DEFAULT NULL,
                note TEXT DEFAULT '',
                cover_color TEXT DEFAULT '',
                cover_url TEXT DEFAULT '',
                external_url TEXT DEFAULT '',
                rewatch_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        ''')

        db.commit()
        print("Tables created successfully.")
    else:
        added = migrate_items(db)
        if added:
            db.commit()
            print(f"Migrated items table, added columns: {', '.join(added)}")
        else:
            print("Database schema is up to date.")

    # 用 IF NOT EXISTS 独立建表：覆盖「items 已存在但 chapters 缺失」的旧库，
    # 否则后面给 chapters 建索引会报 no such table
    db.execute('''
        CREATE TABLE IF NOT EXISTS chapters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL,
            seq INTEGER DEFAULT 0,
            title TEXT NOT NULL DEFAULT '',
            completed INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
        );
    ''')

    # 观看历史表：记录每次进度 / 状态 / 评分变更
    db.execute('''
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL,
            action TEXT NOT NULL DEFAULT 'edited',
            summary TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
        );
    ''')

    db.execute("CREATE INDEX IF NOT EXISTS idx_chapters_item_id ON chapters(item_id)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_items_type ON items(type)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_items_status ON items(status)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_history_item_id ON history(item_id)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at)")

    db.commit()


def add_history(db, item_id, action, summary):
    """写入一条历史记录"""
    db.execute(
        'INSERT INTO history (item_id, action, summary) VALUES (?, ?, ?)',
        (item_id, action, summary),
    )


def progress_snapshot(row):
    """把一条记录的进度转成人类可读的短文本，用于历史 diff"""
    item = dict(row)
    t = item.get('type')
    if t == 'video':
        if item.get('total_duration_min') and not item.get('total_count'):
            cur = item.get('current_duration_min') or 0
            return f"{cur}/{item['total_duration_min']} 分钟"
        if item.get('total_count'):
            return f"{item.get('current_position') or 0}/{item['total_count']} 集"
        if item.get('current_position'):
            return f"第 {item['current_position']} 集"
    elif t == 'tutorial':
        if item.get('total_count'):
            return f"{item.get('current_position') or 0}/{item['total_count']} 节"
        if item.get('current_position'):
            return f"第 {item['current_position']} 节"
    elif t == 'book':
        if item.get('total_pages'):
            return f"{item.get('current_page') or 0}/{item['total_pages']} 页"
        if item.get('current_page'):
            return f"第 {item['current_page']} 页"
    return '未填写'


def diff_item_changes(old_row, new_data):
    """对比新旧值，生成历史摘要；返回 (action, summary) 或 (None, None)"""
    old = dict(old_row)
    changes = []
    action = 'edited'

    if 'status' in new_data and new_data['status'] != old.get('status'):
        changes.append(f"状态：{old.get('status')} → {new_data['status']}")
        action = 'status'

    progress_fields = (
        'total_count', 'current_position', 'current_minutes',
        'total_duration_min', 'current_duration_min',
        'total_pages', 'current_page',
    )
    progress_changed = any(
        k in new_data and (new_data[k] or 0) != (old.get(k) or 0)
        for k in progress_fields
    )
    if progress_changed:
        # 用新值拼一个临时快照，便于给出 "X → Y" 的描述
        merged = dict(old)
        merged.update({k: new_data[k] for k in progress_fields if k in new_data})
        old_text = progress_snapshot(old)
        new_text = progress_snapshot(merged)
        if old_text != new_text:
            changes.append(f"进度：{old_text} → {new_text}")
            if action == 'edited':
                action = 'progress'

    if 'rating' in new_data and (new_data.get('rating') or 0) != (old.get('rating') or 0):
        old_r = old.get('rating') or '未评分'
        new_r = new_data.get('rating') or '未评分'
        changes.append(f"评分：{old_r} → {new_r}")
        if action == 'edited':
            action = 'rating'

    if not changes:
        # 标题 / 分类 / 备注等其它编辑
        for key, label in (('title', '标题'), ('category', '分类'), ('note', '备注')):
            if key in new_data and (new_data[key] or '') != (old.get(key) or ''):
                changes.append(f"修改了{label}")
                break
        if not changes:
            changes.append('编辑了记录')

    return action, '；'.join(changes)


def serialize_item(row, chapters=None):
    """将数据库行序列化为统一的 dict 格式"""
    item = dict(row)
    if chapters is not None:
        item['chapters'] = [dict(ch) for ch in chapters]
    return item
