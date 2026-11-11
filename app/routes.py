import csv
import io
import os
import json
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
from flask import Blueprint, request, jsonify, Response

from .database import (
    get_db, serialize_item, add_history, diff_item_changes,
)

bp = Blueprint('api', __name__, url_prefix='/api')


# ---------------------------------------------------------------------------
# Items CRUD
# ---------------------------------------------------------------------------

VALID_TYPES = {'video', 'tutorial', 'book'}
# 前端只提供前三种状态；'弃置' 仅作为历史数据兼容值保留，
# 避免旧记录被打开编辑后保存失败、或旧 CSV 无法导入。
VALID_STATUSES = {'在看', '已看完', '想看', '弃置'}


def _clean_int(value):
    """把前端传来的值规范成 int 或 None"""
    if value is None or value == '':
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _item_payload(data, base=None):
    """从请求体提取写入数据库的字段；base 为现有行（用于 PUT 保留未传字段）"""
    def pick(key, default=None):
        if key in data:
            return data[key]
        if base is not None:
            return base[key]
        return default

    return {
        'type': pick('type', 'video'),
        'title': (pick('title') or '').strip(),
        'category': pick('category', '') or '',
        'status': pick('status', '想看'),
        'total_count': _clean_int(pick('total_count')),
        'current_position': _clean_int(pick('current_position')),
        'current_minutes': _clean_int(pick('current_minutes')),
        'total_duration_min': _clean_int(pick('total_duration_min')),
        'current_duration_min': _clean_int(pick('current_duration_min')),
        'total_pages': _clean_int(pick('total_pages')),
        'current_page': _clean_int(pick('current_page')),
        'rating': _clean_int(pick('rating')),
        'note': pick('note', '') or '',
        'cover_color': pick('cover_color', '') or '',
        'cover_url': pick('cover_url', '') or '',
        'external_url': pick('external_url', '') or '',
    }


INSERT_SQL = '''
    INSERT INTO items (
        type, title, category, status,
        total_count, current_position, current_minutes,
        total_duration_min, current_duration_min,
        total_pages, current_page,
        rating, note, cover_color, cover_url, external_url
    ) VALUES (
        :type, :title, :category, :status,
        :total_count, :current_position, :current_minutes,
        :total_duration_min, :current_duration_min,
        :total_pages, :current_page,
        :rating, :note, :cover_color, :cover_url, :external_url
    )
'''

UPDATE_SQL = '''
    UPDATE items SET
        type = :type, title = :title, category = :category, status = :status,
        total_count = :total_count, current_position = :current_position,
        current_minutes = :current_minutes,
        total_duration_min = :total_duration_min,
        current_duration_min = :current_duration_min,
        total_pages = :total_pages, current_page = :current_page,
        rating = :rating, note = :note, cover_color = :cover_color,
        cover_url = :cover_url, external_url = :external_url,
        rewatch_count = :rewatch_count,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = :item_id
'''


@bp.route('/items', methods=['GET'])
def list_items():
    """获取记录列表，支持按类型/状态/关键词筛选 + 分页"""
    try:
        db = get_db()
        item_type = request.args.get('type', '').strip()
        status = request.args.get('status', '').strip()
        keyword = request.args.get('keyword', '').strip()
        sort = request.args.get('sort', 'updated').strip()
        page = max(int(request.args.get('page', '1')), 1)
        per_page = min(max(int(request.args.get('per_page', '20')), 1), 100)

        query = 'SELECT * FROM items WHERE 1=1'
        params = []

        if item_type:
            query += ' AND type = ?'
            params.append(item_type)
        if status:
            query += ' AND status = ?'
            params.append(status)
        if keyword:
            query += ' AND (title LIKE ? OR note LIKE ? OR category LIKE ?)'
            kw = f'%{keyword}%'
            params.extend([kw, kw, kw])

        sort_map = {
            'updated': 'updated_at DESC',
            'created': 'created_at DESC',
            'rating': 'rating DESC',
            'title': 'title ASC',
        }
        query += ' ORDER BY ' + sort_map.get(sort, sort_map['updated'])

        count_query = query.replace('SELECT *', 'SELECT COUNT(*)')
        total = db.execute(count_query, params).fetchone()[0]
        query += ' LIMIT ? OFFSET ?'
        params.extend([per_page, (page - 1) * per_page])

        rows = db.execute(query, params).fetchall()
        items = [serialize_item(row) for row in rows]
        return jsonify({'items': items, 'total': total, 'page': page, 'per_page': per_page})
    except Exception as e:
        print(f"Error in list_items: {e}")
        return jsonify({'error': 'Internal error'}), 500


@bp.route('/items/<int:item_id>', methods=['GET'])
def get_item(item_id):
    """获取单条记录，教程类型附带章节列表"""
    try:
        db = get_db()
        row = db.execute('SELECT * FROM items WHERE id = ?', (item_id,)).fetchone()
        if row is None:
            return jsonify({'error': 'not found'}), 404

        chapters = []
        if row['type'] == 'tutorial':
            ch_rows = db.execute(
                'SELECT * FROM chapters WHERE item_id = ? ORDER BY seq ASC', (item_id,)
            ).fetchall()
            chapters = [dict(ch) for ch in ch_rows]

        return jsonify(serialize_item(row, chapters))
    except Exception as e:
        print(f"Error in get_item: {e}")
        return jsonify({'error': 'Internal error'}), 500


@bp.route('/items', methods=['POST'])
def create_item():
    """创建记录，并写入一条初始历史"""
    try:
        db = get_db()
        data = request.get_json()
        if not data:
            return jsonify({'error': 'body is empty'}), 400

        payload = _item_payload(data)
        if not payload['title']:
            return jsonify({'error': 'title is required'}), 400
        if payload['type'] not in VALID_TYPES:
            return jsonify({'error': f"invalid type: {payload['type']}"}), 400
        if payload['status'] not in VALID_STATUSES:
            return jsonify({'error': f"invalid status: {payload['status']}"}), 400
        if payload['rating'] is not None:
            payload['rating'] = max(0, min(5, payload['rating']))

        cur = db.execute(INSERT_SQL, payload)
        item_id = cur.lastrowid
        add_history(db, item_id, 'created', f"添加了记录（{payload['status']}）")
        db.commit()

        row = db.execute('SELECT * FROM items WHERE id = ?', (item_id,)).fetchone()
        return jsonify(serialize_item(row)), 201
    except Exception as e:
        print(f"Error in create_item: {e}")
        return jsonify({'error': 'Internal error'}), 500


@bp.route('/items/<int:item_id>', methods=['PUT'])
def update_item(item_id):
    """更新记录；自动 diff 出进度/状态/评分变化并写入历史"""
    try:
        db = get_db()
        row = db.execute('SELECT * FROM items WHERE id = ?', (item_id,)).fetchone()
        if row is None:
            return jsonify({'error': 'not found'}), 404

        data = request.get_json()
        if not data:
            return jsonify({'error': 'body is empty'}), 400

        payload = _item_payload(data, base=row)
        if not payload['title']:
            return jsonify({'error': 'title is required'}), 400
        if payload['type'] not in VALID_TYPES:
            return jsonify({'error': f"invalid type: {payload['type']}"}), 400
        if payload['status'] not in VALID_STATUSES:
            return jsonify({'error': f"invalid status: {payload['status']}"}), 400
        if payload['rating'] is not None:
            payload['rating'] = max(0, min(5, payload['rating']))

        # 「已看完 → 在看」视为一次重看
        rewatch = row['rewatch_count'] or 0
        if row['status'] == '已看完' and payload['status'] == '在看':
            rewatch += 1
        payload['rewatch_count'] = rewatch
        payload['item_id'] = item_id

        action, summary = diff_item_changes(row, payload)
        db.execute(UPDATE_SQL, payload)
        add_history(db, item_id, action, summary)
        db.commit()

        row = db.execute('SELECT * FROM items WHERE id = ?', (item_id,)).fetchone()
        return jsonify(serialize_item(row))
    except Exception as e:
        print(f"Error in update_item: {e}")
        return jsonify({'error': 'Internal error'}), 500


@bp.route('/items/<int:item_id>', methods=['DELETE'])
def delete_item(item_id):
    """删除记录（级联删除章节与历史）"""
    try:
        db = get_db()
        row = db.execute('SELECT * FROM items WHERE id = ?', (item_id,)).fetchone()
        if row is None:
            return jsonify({'error': 'not found'}), 404

        db.execute('DELETE FROM items WHERE id = ?', (item_id,))
        db.commit()
        return jsonify({'message': 'deleted'})
    except Exception as e:
        print(f"Error in delete_item: {e}")
        return jsonify({'error': 'Internal error'}), 500


@bp.route('/items/<int:item_id>/history', methods=['GET'])
def item_history(item_id):
    """某条记录的变更时间线"""
    try:
        db = get_db()
        row = db.execute('SELECT id FROM items WHERE id = ?', (item_id,)).fetchone()
        if row is None:
            return jsonify({'error': 'not found'}), 404
        limit = min(max(int(request.args.get('limit', '50')), 1), 200)
        rows = db.execute(
            'SELECT * FROM history WHERE item_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
            (item_id, limit),
        ).fetchall()
        return jsonify([dict(r) for r in rows])
    except Exception as e:
        print(f"Error in item_history: {e}")
        return jsonify({'error': 'Internal error'}), 500


@bp.route('/activity', methods=['GET'])
def activity():
    """日历热力图数据：按配置时区统计每天的添加 + 变更次数"""
    try:
        db = get_db()
        days = min(max(int(request.args.get('days', '182')), 7), 366)
        item_type = request.args.get('type', '').strip()

        offset_hours = int(os.environ.get('TZ_OFFSET_HOURS', '8'))
        today = datetime.now(timezone.utc).astimezone(
            timezone(timedelta(hours=offset_hours))
        ).date()
        modifier = f"{offset_hours:+d} hours"

        counts = {}
        item_rows = db.execute(
            "SELECT date(created_at, ?) AS d, COUNT(*) AS c FROM items GROUP BY d",
            (modifier,),
        ).fetchall()
        for r in item_rows:
            if r['d']:
                counts[r['d']] = counts.get(r['d'], 0) + r['c']

        if item_type:
            hist_rows = db.execute(
                "SELECT date(h.created_at, ?) AS d, COUNT(*) AS c FROM history h "
                "JOIN items i ON i.id = h.item_id WHERE i.type = ? AND h.action != 'created' "
                "GROUP BY d", (modifier, item_type)
            ).fetchall()
        else:
            hist_rows = db.execute(
                "SELECT date(created_at, ?) AS d, COUNT(*) AS c FROM history "
                "WHERE action != 'created' GROUP BY d", (modifier,)
            ).fetchall()
        for r in hist_rows:
            if r['d']:
                counts[r['d']] = counts.get(r['d'], 0) + r['c']

        series = []
        for i in range(days - 1, -1, -1):
            d = (today - timedelta(days=i)).isoformat()
            series.append({'date': d, 'count': counts.get(d, 0)})

        return jsonify({
            'days': days,
            'today': today.isoformat(),
            'total': sum(x['count'] for x in series),
            'active_days': sum(1 for x in series if x['count'] > 0),
            'series': series,
        })
    except Exception as e:
        print(f"Error in activity: {e}")
        return jsonify({'error': 'Internal error'}), 500


@bp.route('/recent-activity', methods=['GET'])
def recent_activity():
    """最近动态：把 history 和 items 拼成可读的列表"""
    try:
        db = get_db()
        limit = min(max(int(request.args.get('limit', '12')), 1), 50)
        rows = db.execute(
            'SELECT h.id, h.item_id, h.action, h.summary, h.created_at, '
            'i.title, i.type, i.status '
            'FROM history h JOIN items i ON i.id = h.item_id '
            'ORDER BY h.created_at DESC, h.id DESC LIMIT ?', (limit,)
        ).fetchall()
        return jsonify([dict(r) for r in rows])
    except Exception as e:
        print(f"Error in recent_activity: {e}")
        return jsonify({'error': 'Internal error'}), 500


# ---------------------------------------------------------------------------
# Chapters CRUD (tutorial only)
# ---------------------------------------------------------------------------

@bp.route('/items/<int:item_id>/chapters', methods=['GET'])
def list_chapters(item_id):
    try:
        db = get_db()
        row = db.execute('SELECT * FROM items WHERE id = ?', (item_id,)).fetchone()
        if row is None:
            return jsonify({'error': 'not found'}), 404
        rows = db.execute(
            'SELECT * FROM chapters WHERE item_id = ? ORDER BY seq ASC', (item_id,)
        ).fetchall()
        return jsonify([dict(ch) for ch in rows])
    except Exception as e:
        print(f"Error in list_chapters: {e}")
        return jsonify({'error': 'Internal error'}), 500


@bp.route('/items/<int:item_id>/chapters', methods=['POST'])
def add_chapter(item_id):
    try:
        db = get_db()
        row = db.execute('SELECT * FROM items WHERE id = ?', (item_id,)).fetchone()
        if row is None:
            return jsonify({'error': 'not found'}), 404
        data = request.get_json()
        if not data:
            return jsonify({'error': 'body is empty'}), 400
        title = (data.get('title') or '').strip()
        if not title:
            return jsonify({'error': 'chapter title is required'}), 400

        max_seq = db.execute(
            'SELECT MAX(seq) FROM chapters WHERE item_id = ?', (item_id,)
        ).fetchone()[0]
        seq = (max_seq or 0) + 1
        completed = 1 if data.get('completed') else 0

        # 必须用本章节 INSERT 的 lastrowid：后面还会写 history，
        # 否则 last_insert_rowid() 会返回 history 行的 id，导致查不到章节
        cur = db.execute(
            'INSERT INTO chapters (item_id, seq, title, completed) VALUES (?, ?, ?, ?)',
            (item_id, seq, title, completed),
        )
        ch_id = cur.lastrowid
        add_history(db, item_id, 'chapter', f"添加章节「{title}」")
        db.commit()

        ch = db.execute('SELECT * FROM chapters WHERE id = ?', (ch_id,)).fetchone()
        return jsonify(dict(ch)), 201
    except Exception as e:
        print(f"Error in add_chapter: {e}")
        return jsonify({'error': 'Internal error'}), 500


@bp.route('/items/<int:item_id>/chapters/<int:ch_id>', methods=['PUT'])
def update_chapter(item_id, ch_id):
    try:
        db = get_db()
        ch = db.execute(
            'SELECT * FROM chapters WHERE id = ? AND item_id = ?', (ch_id, item_id)
        ).fetchone()
        if ch is None:
            return jsonify({'error': 'not found'}), 404
        data = request.get_json()
        if not data:
            return jsonify({'error': 'body is empty'}), 400

        title = data.get('title', ch['title'])
        completed = 1 if data.get('completed') else 0
        seq = data.get('seq', ch['seq'])
        db.execute(
            'UPDATE chapters SET title = ?, completed = ?, seq = ? WHERE id = ?',
            (title, completed, seq, ch_id),
        )
        if completed != ch['completed']:
            label = '完成' if completed else '取消完成'
            add_history(db, item_id, 'chapter', f"{label}章节「{ch['title']}」")
        db.commit()

        ch = db.execute('SELECT * FROM chapters WHERE id = ?', (ch_id,)).fetchone()
        return jsonify(dict(ch))
    except Exception as e:
        print(f"Error in update_chapter: {e}")
        return jsonify({'error': 'Internal error'}), 500


@bp.route('/items/<int:item_id>/chapters/<int:ch_id>', methods=['DELETE'])
def delete_chapter(item_id, ch_id):
    try:
        db = get_db()
        ch = db.execute(
            'SELECT * FROM chapters WHERE id = ? AND item_id = ?', (ch_id, item_id)
        ).fetchone()
        if ch is None:
            return jsonify({'error': 'not found'}), 404
        db.execute('DELETE FROM chapters WHERE id = ?', (ch_id,))
        add_history(db, item_id, 'chapter', f"删除章节「{ch['title']}」")
        db.commit()
        return jsonify({'message': 'deleted'})
    except Exception as e:
        print(f"Error in delete_chapter: {e}")
        return jsonify({'error': 'Internal error'}), 500


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@bp.route('/stats', methods=['GET'])
def get_stats():
    """统计：状态数量、类型分布、评分分布、平均分、重看次数"""
    try:
        db = get_db()
        item_type = request.args.get('type', '').strip()

        where = ''
        params = []
        if item_type:
            where = ' WHERE type = ?'
            params.append(item_type)

        def count_by_status(status_val):
            if where:
                return db.execute(
                    'SELECT COUNT(*) FROM items WHERE type = ? AND status = ?',
                    params + [status_val],
                ).fetchone()[0]
            return db.execute(
                'SELECT COUNT(*) FROM items WHERE status = ?', (status_val,)
            ).fetchone()[0]

        total = db.execute(f'SELECT COUNT(*) FROM items{where}', params).fetchone()[0]
        result = {
            'total': total,
            'watching': count_by_status('在看'),
            'completed': count_by_status('已看完'),
            'plan': count_by_status('想看'),
            'dropped': count_by_status('弃置'),
        }

        type_rows = db.execute(
            'SELECT type, status, COUNT(*) AS cnt FROM items GROUP BY type, status'
        ).fetchall()
        by_type = {}
        by_type_status = {}
        for r in type_rows:
            by_type[r['type']] = by_type.get(r['type'], 0) + r['cnt']
            by_type_status.setdefault(r['type'], {})[r['status']] = r['cnt']
        result['by_type'] = by_type
        result['by_type_status'] = by_type_status

        rating_clause = 'WHERE rating IS NOT NULL AND rating > 0'
        rating_params = []
        if item_type:
            rating_clause += ' AND type = ?'
            rating_params.append(item_type)
        rating_rows = db.execute(
            f'SELECT rating, COUNT(*) AS cnt FROM items {rating_clause} GROUP BY rating',
            rating_params,
        ).fetchall()
        result['rating_distribution'] = {str(r['rating']): r['cnt'] for r in rating_rows}
        agg = db.execute(
            f'SELECT AVG(rating) AS avg, SUM(rewatch_count) AS rewatches FROM items {rating_clause}',
            rating_params,
        ).fetchone()
        result['avg_rating'] = round(agg['avg'], 2) if agg['avg'] else 0
        result['rewatches'] = agg['rewatches'] or 0
        result['added_this_month'] = db.execute(
            "SELECT COUNT(*) FROM items WHERE substr(created_at, 1, 7) = ?",
            (datetime.now().strftime('%Y-%m'),),
        ).fetchone()[0]
        result['history_count'] = db.execute('SELECT COUNT(*) FROM history').fetchone()[0]

        return jsonify(result)
    except Exception as e:
        print(f"Error in get_stats: {e}")
        return jsonify({'error': 'Internal error'}), 500


# ---------------------------------------------------------------------------
# CSV import / export
# ---------------------------------------------------------------------------

CSV_FIELDS = [
    'type', 'title', 'category', 'status',
    'total_count', 'current_position', 'current_minutes',
    'total_duration_min', 'current_duration_min',
    'total_pages', 'current_page',
    'rating', 'note', 'cover_url', 'external_url',
]

CSV_HEADERS = {
    'type': '类型', 'title': '标题', 'category': '分类', 'status': '状态',
    'total_count': '总集数', 'current_position': '当前集', 'current_minutes': '本集已看分钟',
    'total_duration_min': '总时长分钟', 'current_duration_min': '已看时长分钟',
    'total_pages': '总页数', 'current_page': '当前页',
    'rating': '评分', 'note': '备注', 'cover_url': '封面链接', 'external_url': '外部链接',
}


@bp.route('/export', methods=['GET'])
def export_csv():
    """导出全部记录为 CSV（UTF-8 BOM，Excel 直接打开不乱码）"""
    try:
        db = get_db()
        item_type = request.args.get('type', '').strip()
        sql = 'SELECT * FROM items'
        params = []
        if item_type:
            sql += ' WHERE type = ?'
            params.append(item_type)
        sql += ' ORDER BY id ASC'
        rows = db.execute(sql, params).fetchall()

        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([CSV_HEADERS[f] for f in CSV_FIELDS])
        for row in rows:
            writer.writerow([row[f] if row[f] is not None else '' for f in CSV_FIELDS])

        data = '\ufeff' + buf.getvalue()
        filename = f"media-tracker-{datetime.now().strftime('%Y%m%d')}.csv"
        return Response(
            data.encode('utf-8'),
            mimetype='text/csv; charset=utf-8',
            headers={'Content-Disposition': f"attachment; filename={filename}"},
        )
    except Exception as e:
        print(f"Error in export_csv: {e}")
        return jsonify({'error': 'Internal error'}), 500


@bp.route('/import', methods=['POST'])
def import_csv():
    """从 CSV 导入记录；支持中文表头或英文字段名，自动跳过重复标题"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': '缺少 file 字段'}), 400
        raw = request.files['file'].read()
        if not raw:
            return jsonify({'error': '文件为空'}), 400
        try:
            text = raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            try:
                text = raw.decode('gbk')
            except UnicodeDecodeError:
                return jsonify({'error': '无法识别文件编码（需 UTF-8 或 GBK）'}), 400

        reverse_headers = {v: k for k, v in CSV_HEADERS.items()}
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            return jsonify({'error': 'CSV 缺少表头'}), 400

        normalized = []
        for name in reader.fieldnames:
            key = name.strip().lstrip('\ufeff')
            normalized.append(reverse_headers.get(key, key))

        db = get_db()
        existing = {
            (r['type'], r['title']) for r in
            db.execute('SELECT type, title FROM items').fetchall()
        }
        created, skipped, errors = 0, 0, []

        for line_no, row in enumerate(reader, start=2):
            try:
                data = {}
                for original, key in zip(reader.fieldnames, normalized):
                    if key in CSV_FIELDS:
                        data[key] = (row.get(original) or '').strip()

                title = data.get('title', '')
                if not title:
                    skipped += 1
                    continue
                item_type = data.get('type') or 'video'
                if item_type not in VALID_TYPES:
                    errors.append(f"第 {line_no} 行：未知类型 {item_type}")
                    continue
                status = data.get('status') or '想看'
                if status not in VALID_STATUSES:
                    status = '想看'
                if (item_type, title) in existing:
                    skipped += 1
                    continue

                payload = {
                    'type': item_type, 'title': title,
                    'category': data.get('category', ''), 'status': status,
                    'total_count': _clean_int(data.get('total_count')),
                    'current_position': _clean_int(data.get('current_position')),
                    'current_minutes': _clean_int(data.get('current_minutes')),
                    'total_duration_min': _clean_int(data.get('total_duration_min')),
                    'current_duration_min': _clean_int(data.get('current_duration_min')),
                    'total_pages': _clean_int(data.get('total_pages')),
                    'current_page': _clean_int(data.get('current_page')),
                    'rating': _clean_int(data.get('rating')),
                    'note': data.get('note', ''),
                    'cover_color': '',
                    'cover_url': data.get('cover_url', ''),
                    'external_url': data.get('external_url', ''),
                }
                if payload['rating'] is not None:
                    payload['rating'] = max(0, min(5, payload['rating']))

                cur = db.execute(INSERT_SQL, payload)
                item_id = cur.lastrowid
                add_history(db, item_id, 'created', '从 CSV 导入')
                existing.add((item_type, title))
                created += 1
            except Exception as row_err:
                errors.append(f"第 {line_no} 行：{row_err}")

        db.commit()
        return jsonify({
            'created': created, 'skipped': skipped,
            'errors': errors[:20], 'error_count': len(errors),
        })
    except Exception as e:
        print(f"Error in import_csv: {e}")
        return jsonify({'error': 'Internal error'}), 500


# ---------------------------------------------------------------------------
# Optional metadata lookup (TMDB)
# ---------------------------------------------------------------------------

# 部分地区 api.themoviedb.org 存在 DNS 污染/不可达，api.tmdb.org 通常可用。
# 按顺序尝试，可用 TMDB_API_BASE 覆盖首选地址。
DEFAULT_TMDB_API_BASES = (
    'https://api.tmdb.org/3',
    'https://api.themoviedb.org/3',
)


def tmdb_api_bases():
    configured = (os.environ.get('TMDB_API_BASE') or '').strip().rstrip('/')
    bases = ([configured] if configured else []) + list(DEFAULT_TMDB_API_BASES)
    seen, result = set(), []
    for base in bases:
        if base and base not in seen:
            seen.add(base)
            result.append(base)
    return result


def tmdb_image_base():
    return (os.environ.get('TMDB_IMAGE_BASE') or 'https://image.tmdb.org/t/p/w500').rstrip('/')


class TmdbAuthError(Exception):
    """TMDB 返回 401/403：密钥无效或未被授权"""


def tmdb_fetch(path, params):
    """调用 TMDB v3 接口，按可用域名顺序回退；返回解析后的 JSON。"""
    api_key = os.environ.get('TMDB_API_KEY')
    query_params = dict(params or {})
    query_params['api_key'] = api_key
    query = urllib.parse.urlencode(query_params)
    try:
        timeout = float(os.environ.get('TMDB_TIMEOUT') or 5)
    except ValueError:
        timeout = 5

    last_error = None
    for base in tmdb_api_bases():
        url = f'{base}{path}?{query}'
        req = urllib.request.Request(
            url, headers={'Accept': 'application/json', 'User-Agent': 'MediaTracker/1.0'}
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise TmdbAuthError()
            last_error = e
        except Exception as e:
            last_error = e
    raise last_error or RuntimeError('TMDB unavailable')


def tmdb_error_response(e):
    if isinstance(e, TmdbAuthError):
        return jsonify({'error': 'TMDB 密钥无效或未被授权，请检查是否为 API Key (v3 auth)'}), 502
    print(f"Error in TMDB request: {e}")
    return jsonify({'error': '无法连接 TMDB（网络超时或被屏蔽），可手动填写相关信息'}), 502


@bp.route('/metadata/config', methods=['GET'])
def metadata_config():
    """前端据此决定是否显示「搜索补全」入口"""
    return jsonify({'enabled': bool(os.environ.get('TMDB_API_KEY'))})


@bp.route('/metadata/search', methods=['GET'])
def metadata_search():
    """可选：通过 TMDB 搜索影视元数据。未配置 TMDB_API_KEY 时返回 503。"""
    if not os.environ.get('TMDB_API_KEY'):
        return jsonify({'error': '未配置 TMDB_API_KEY，可手动填写封面与外部链接'}), 503
    keyword = request.args.get('q', '').strip()
    if not keyword:
        return jsonify({'error': '请输入关键词'}), 400

    try:
        payload = tmdb_fetch('/search/multi', {
            'query': keyword, 'language': 'zh-CN', 'include_adult': 'false',
        })
    except Exception as e:
        return tmdb_error_response(e)

    image_base = tmdb_image_base()
    results = []
    for entry in payload.get('results', [])[:10]:
        media = entry.get('media_type')
        if media not in ('movie', 'tv'):
            continue
        date = entry.get('release_date') or entry.get('first_air_date') or ''
        poster = entry.get('poster_path') or ''
        results.append({
            'id': entry.get('id'),
            'media_type': media,
            'title': entry.get('title') or entry.get('name') or '',
            'year': date[:4] if date else '',
            'overview': (entry.get('overview') or '')[:160],
            'cover_url': f'{image_base}{poster}' if poster else '',
            'external_url': f"https://www.themoviedb.org/{'movie' if media == 'movie' else 'tv'}/{entry.get('id')}",
            'category': '电影' if media == 'movie' else '电视剧',
        })
    return jsonify({'results': results})


@bp.route('/metadata/detail', methods=['GET'])
def metadata_detail():
    """取单条详情：电影片长 / 剧集总集数 / 多类型标签（search/multi 不含这些字段）"""
    if not os.environ.get('TMDB_API_KEY'):
        return jsonify({'error': '未配置 TMDB_API_KEY'}), 503
    media_type = request.args.get('media_type', '').strip()
    if media_type not in ('movie', 'tv'):
        return jsonify({'error': 'media_type 需为 movie 或 tv'}), 400
    try:
        item_id = int(request.args.get('id', '0'))
    except (TypeError, ValueError):
        return jsonify({'error': 'id 无效'}), 400
    if item_id <= 0:
        return jsonify({'error': 'id 无效'}), 400

    try:
        data = tmdb_fetch(f'/{media_type}/{item_id}', {'language': 'zh-CN'})
    except Exception as e:
        return tmdb_error_response(e)

    result = {
        'media_type': media_type,
        'genres': [g['name'] for g in data.get('genres', []) if g.get('name')],
        # 详情接口的简介是完整文本；search/multi 只给了截断版，供前端失败时兜底
        'overview': (data.get('overview') or '').strip(),
    }
    if media_type == 'movie':
        result['runtime'] = data.get('runtime') or 0
        result['total_duration_min'] = result['runtime']
        result['current_duration_min'] = 0
    else:
        result['number_of_episodes'] = data.get('number_of_episodes') or 0
        result['total_count'] = result['number_of_episodes']
        result['current_position'] = 1 if result['number_of_episodes'] else 0
    return jsonify(result)
