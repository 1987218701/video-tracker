import sqlite3
import os
from flask import g

def get_database_path():
    """获取数据库路径，确保目录存在"""
    env_path = os.environ.get('DATABASE_PATH')
    if env_path:
        db_path = env_path
    else:
        db_path = os.path.join(os.path.dirname(__file__), '..', 'instance', 'videos.db')
    
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


def init_db():
    """初始化数据库表"""
    db = get_db()
    
    cursor = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='videos'")
    table_exists = cursor.fetchone()
    
    if not table_exists:
        print("Creating new videos table...")
        db.execute('''
            CREATE TABLE videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                category TEXT DEFAULT '电视剧',
                total_episodes INTEGER DEFAULT NULL,
                total_duration_min INTEGER DEFAULT NULL,
                current_episode INTEGER DEFAULT NULL,
                current_duration_min INTEGER DEFAULT NULL,
                current_episode_minutes INTEGER DEFAULT NULL,
                status TEXT DEFAULT '在看',
                note TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        ''')
    else:
        print("Updating existing videos table...")
        cursor = db.execute("PRAGMA table_info(videos)")
        columns = [row['name'] for row in cursor.fetchall()]
        
        if 'current_episode_minutes' not in columns:
            try:
                db.execute("ALTER TABLE videos ADD COLUMN current_episode_minutes INTEGER DEFAULT NULL")
                print("Added current_episode_minutes column.")
            except Exception as e:
                print(f"Could not add column: {e}")
        
        if 'rating' in columns:
            try:
                db.execute('''
                    CREATE TABLE videos_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT NOT NULL,
                        category TEXT DEFAULT '电视剧',
                        total_episodes INTEGER DEFAULT NULL,
                        total_duration_min INTEGER DEFAULT NULL,
                        current_episode INTEGER DEFAULT NULL,
                        current_duration_min INTEGER DEFAULT NULL,
                        current_episode_minutes INTEGER DEFAULT NULL,
                        status TEXT DEFAULT '在看',
                        note TEXT DEFAULT '',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                ''')
                db.execute('''
                    INSERT INTO videos_new 
                    (id, title, category, total_episodes, total_duration_min, 
                     current_episode, current_duration_min, status, note, created_at, updated_at)
                    SELECT id, title, category, total_episodes, total_duration_min, 
                           current_episode, current_duration_min, status, note, created_at, updated_at
                    FROM videos;
                ''')
                db.execute("DROP TABLE videos;")
                db.execute("ALTER TABLE videos_new RENAME TO videos;")
                print("Removed rating column successfully.")
            except Exception as e:
                print(f"Could not remove rating column: {e}")
    
    db.commit()
