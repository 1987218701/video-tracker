
from flask import Blueprint, request, jsonify
from .database import get_db

bp = Blueprint('api', __name__, url_prefix='/api/videos')


@bp.route('', methods=['GET'])
def list_videos():
    """获取所有视频记录，支持搜索和筛选"""
    try:
        db = get_db()
        keyword = request.args.get('keyword', '').strip()
        category = request.args.get('category', '').strip()
        status = request.args.get('status', '').strip()

        query = 'SELECT * FROM videos WHERE 1=1'
        params = []

        if keyword:
            query += ' AND title LIKE ?'
            params.append(f'%{keyword}%')
        if category:
            query += ' AND category = ?'
            params.append(category)
        if status:
            query += ' AND status = ?'
            params.append(status)

        query += ' ORDER BY updated_at DESC'

        rows = db.execute(query, params).fetchall()
        videos = []
        for row in rows:
            video_dict = dict(row)
            for key in ['total_episodes', 'current_episode', 'total_duration_min', 'current_duration_min', 'current_episode_minutes']:
                if key in video_dict and video_dict[key] is None:
                    video_dict[key] = None
            videos.append(video_dict)
        return jsonify(videos)
    except Exception as e:
        print(f"Error in list_videos: {e}")
        return jsonify({'error': str(e)}), 500


@bp.route('/<int:video_id>', methods=['GET'])
def get_video(video_id):
    """获取单个视频记录"""
    try:
        db = get_db()
        row = db.execute('SELECT * FROM videos WHERE id = ?', (video_id,)).fetchone()
        if row is None:
            return jsonify({'error': '视频记录不存在'}), 404
        video_dict = dict(row)
        for key in ['total_episodes', 'current_episode', 'total_duration_min', 'current_duration_min', 'current_episode_minutes']:
            if key in video_dict and video_dict[key] is None:
                video_dict[key] = None
        return jsonify(video_dict)
    except Exception as e:
        print(f"Error in get_video: {e}")
        return jsonify({'error': str(e)}), 500


@bp.route('', methods=['POST'])
def create_video():
    """创建视频记录"""
    try:
        db = get_db()
        data = request.get_json()

        if not data:
            return jsonify({'error': '请求体不能为空'}), 400

        title = data.get('title', '').strip()
        if not title:
            return jsonify({'error': '标题不能为空'}), 400

        db.execute('''
            INSERT INTO videos (title, category, total_episodes, total_duration_min,
                               current_episode, current_duration_min, current_episode_minutes, status, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            title,
            data.get('category', '电视剧'),
            data.get('total_episodes'),
            data.get('total_duration_min'),
            data.get('current_episode'),
            data.get('current_duration_min'),
            data.get('current_episode_minutes'),
            data.get('status', '在看'),
            data.get('note', '')
        ))
        db.commit()

        video_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
        row = db.execute('SELECT * FROM videos WHERE id = ?', (video_id,)).fetchone()
        video_dict = dict(row)
        for key in ['total_episodes', 'current_episode', 'total_duration_min', 'current_duration_min', 'current_episode_minutes']:
            if key in video_dict and video_dict[key] is None:
                video_dict[key] = None
        return jsonify(video_dict), 201
    except Exception as e:
        print(f"Error in create_video: {e}")
        return jsonify({'error': str(e)}), 500


@bp.route('/<int:video_id>', methods=['PUT'])
def update_video(video_id):
    """更新视频记录"""
    try:
        db = get_db()
        row = db.execute('SELECT * FROM videos WHERE id = ?', (video_id,)).fetchone()
        if row is None:
            return jsonify({'error': '视频记录不存在'}), 404

        data = request.get_json()

        if not data:
            return jsonify({'error': '请求体不能为空'}), 400

        title = data.get('title', '').strip()
        if not title:
            return jsonify({'error': '标题不能为空'}), 400

        db.execute('''
            UPDATE videos SET
                title = ?, category = ?, total_episodes = ?, total_duration_min = ?,
                current_episode = ?, current_duration_min = ?, current_episode_minutes = ?,
                status = ?, note = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        ''', (
            title,
            data.get('category', row['category']),
            data.get('total_episodes'),
            data.get('total_duration_min'),
            data.get('current_episode'),
            data.get('current_duration_min'),
            data.get('current_episode_minutes'),
            data.get('status', row['status']),
            data.get('note', ''),
            video_id
        ))
        db.commit()

        row = db.execute('SELECT * FROM videos WHERE id = ?', (video_id,)).fetchone()
        video_dict = dict(row)
        for key in ['total_episodes', 'current_episode', 'total_duration_min', 'current_duration_min', 'current_episode_minutes']:
            if key in video_dict and video_dict[key] is None:
                video_dict[key] = None
        return jsonify(video_dict)
    except Exception as e:
        print(f"Error in update_video: {e}")
        return jsonify({'error': str(e)}), 500


@bp.route('/<int:video_id>', methods=['DELETE'])
def delete_video(video_id):
    """删除视频记录"""
    try:
        db = get_db()
        row = db.execute('SELECT * FROM videos WHERE id = ?', (video_id,)).fetchone()
        if row is None:
            return jsonify({'error': '视频记录不存在'}), 404

        db.execute('DELETE FROM videos WHERE id = ?', (video_id,))
        db.commit()
        return jsonify({'message': '删除成功'})
    except Exception as e:
        print(f"Error in delete_video: {e}")
        return jsonify({'error': str(e)}), 500


@bp.route('/stats', methods=['GET'])
def get_stats():
    """获取统计信息"""
    try:
        db = get_db()
        total = db.execute('SELECT COUNT(*) FROM videos').fetchone()[0]
        watching = db.execute("SELECT COUNT(*) FROM videos WHERE status = '在看'").fetchone()[0]
        completed = db.execute("SELECT COUNT(*) FROM videos WHERE status = '已看完'").fetchone()[0]
        plan = db.execute("SELECT COUNT(*) FROM videos WHERE status = '想看'").fetchone()[0]
        dropped = db.execute("SELECT COUNT(*) FROM videos WHERE status = '弃剧'").fetchone()[0]

        return jsonify({
            'total': total,
            'watching': watching,
            'completed': completed,
            'plan': plan,
            'dropped': dropped
        })
    except Exception as e:
        print(f"Error in get_stats: {e}")
        return jsonify({'error': str(e)}), 500
