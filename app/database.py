import sqlite3
import os
from flask import g

DATABASE = os.environ.get('DATABASE_PATH', '/data/videos.db')


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
    db.executescript('''
        CREATE TABLE IF NOT EXISTS videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            category TEXT DEFAULT '电视剧',
            total_episodes INTEGER DEFAULT NULL,
            total_duration_min INTEGER DEFAULT NULL,
            current_episode INTEGER DEFAULT NULL,
            current_duration_min INTEGER DEFAULT NULL,
            status TEXT DEFAULT '在看',
            rating INTEGER DEFAULT NULL,
            note TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    ''')
    db.commit()
