// ===== 全局状态 =====
let editingId = null;
let deletingId = null;
let searchTimer = null;

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    loadVideos();
    loadStats();
});

// ===== Toast 提示 =====
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ===== 防抖搜索 =====
function debounceSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadVideos(), 300);
}

// ===== 加载统计数据 =====
async function loadStats() {
    try {
        const res = await fetch('/api/videos/stats');
        const stats = await res.json();
        document.getElementById('statTotal').textContent = stats.total;
        document.getElementById('statWatching').textContent = stats.watching;
        document.getElementById('statCompleted').textContent = stats.completed;
        document.getElementById('statPlan').textContent = stats.plan;
        document.getElementById('statDropped').textContent = stats.dropped;
    } catch (e) {
        console.error('加载统计失败:', e);
    }
}

// ===== 加载视频列表 =====
async function loadVideos() {
    const keyword = document.getElementById('searchInput').value;
    const category = document.getElementById('filterCategory').value;
    const status = document.getElementById('filterStatus').value;

    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (category) params.set('category', category);
    if (status) params.set('status', status);

    try {
        const res = await fetch(`/api/videos?${params.toString()}`);
        const videos = await res.json();
        renderVideos(videos);
        loadStats();
    } catch (e) {
        console.error('加载失败:', e);
        showToast('加载失败，请重试', 'error');
    }
}

// ===== 渲染视频列表 =====
function renderVideos(videos) {
    const container = document.getElementById('videoList');

    if (videos.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>没有找到记录</p>
            </div>
        `;
        return;
    }

    container.innerHTML = videos.map(v => {
        const progress = getProgressText(v);
        const rating = v.rating ? `⭐ ${v.rating}` : '';
        const note = v.note ? `<span title="${escapeHtml(v.note)}">📝</span>` : '';

        return `
            <div class="video-card">
                <div class="video-info">
                    <div class="video-title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)} ${note}</div>
                    <div class="video-meta">
                        <span class="category-tag">${escapeHtml(v.category)}</span>
                        ${v.note ? `<span>${escapeHtml(truncate(v.note, 30))}</span>` : ''}
                    </div>
                </div>
                <div class="video-progress">
                    <div class="progress-text">${progress.value}</div>
                    <div class="progress-label">${progress.label}</div>
                </div>
                <div class="video-status">
                    <span class="status-badge ${escapeHtml(v.status)}">${escapeHtml(v.status)}</span>
                </div>
                ${rating ? `<div class="video-rating">${rating}</div>` : ''}
                <div class="video-actions">
                    <button class="btn btn-sm btn-secondary" onclick="editVideo(${v.id})">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="confirmDelete(${v.id}, '${escapeHtml(v.title)}')">删除</button>
                </div>
            </div>
        `;
    }).join('');
}

// ===== 获取进度文本 =====
function getProgressText(v) {
    if (v.total_episodes) {
        const current = v.current_episode || 0;
        return {
            value: `${current}/${v.total_episodes}`,
            label: '集数进度'
        };
    }
    if (v.total_duration_min) {
        const current = v.current_duration_min || 0;
        return {
            value: `${current}/${v.total_duration_min}`,
            label: '时长(分钟)'
        };
    }
    return { value: '-', label: '无进度' };
}

// ===== 模态框操作 =====
function openModal(video = null) {
    editingId = video ? video.id : null;
    document.getElementById('modalTitle').textContent = video ? '编辑视频记录' : '添加视频记录';
    document.getElementById('videoId').value = video ? video.id : '';
    document.getElementById('title').value = video ? video.title : '';
    document.getElementById('category').value = video ? video.category : '电视剧';
    document.getElementById('status').value = video ? video.status : '在看';
    document.getElementById('total_episodes').value = video && video.total_episodes ? video.total_episodes : '';
    document.getElementById('current_episode').value = video && video.current_episode ? video.current_episode : '';
    document.getElementById('total_duration_min').value = video && video.total_duration_min ? video.total_duration_min : '';
    document.getElementById('current_duration_min').value = video && video.current_duration_min ? video.current_duration_min : '';
    document.getElementById('rating').value = video && video.rating ? video.rating : '';
    document.getElementById('note').value = video ? (video.note || '') : '';
    document.getElementById('modalOverlay').classList.add('active');
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
    editingId = null;
    document.getElementById('videoForm').reset();
}

function closeModalOutside(e) {
    if (e.target === document.getElementById('modalOverlay')) {
        closeModal();
    }
}

// ===== 保存视频 =====
async function saveVideo(e) {
    e.preventDefault();

    const data = {
        title: document.getElementById('title').value.trim(),
        category: document.getElementById('category').value,
        status: document.getElementById('status').value,
        total_episodes: parseInt(document.getElementById('total_episodes').value) || null,
        current_episode: parseInt(document.getElementById('current_episode').value) || null,
        total_duration_min: parseInt(document.getElementById('total_duration_min').value) || null,
        current_duration_min: parseInt(document.getElementById('current_duration_min').value) || null,
        rating: parseInt(document.getElementById('rating').value) || null,
        note: document.getElementById('note').value.trim()
    };

    try {
        const url = editingId ? `/api/videos/${editingId}` : '/api/videos';
        const method = editingId ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!res.ok) {
            const err = await res.json();
            showToast(err.error || '操作失败', 'error');
            return;
        }

        showToast(editingId ? '更新成功' : '添加成功');
        closeModal();
        loadVideos();
    } catch (e) {
        console.error('保存失败:', e);
        showToast('保存失败，请重试', 'error');
    }
}

// ===== 编辑视频 =====
async function editVideo(id) {
    try {
        const res = await fetch(`/api/videos/${id}`);
        const video = await res.json();
        openModal(video);
    } catch (e) {
        showToast('加载失败', 'error');
    }
}

// ===== 删除视频 =====
function confirmDelete(id, name) {
    deletingId = id;
    document.getElementById('deleteVideoName').textContent = name;
    document.getElementById('deleteOverlay').classList.add('active');
    document.getElementById('confirmDeleteBtn').onclick = async () => {
        try {
            const res = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
            if (!res.ok) {
                showToast('删除失败', 'error');
                return;
            }
            showToast('删除成功');
            closeDeleteModal();
            loadVideos();
        } catch (e) {
            showToast('删除失败', 'error');
        }
    };
}

function closeDeleteModal() {
    document.getElementById('deleteOverlay').classList.remove('active');
    deletingId = null;
}

function closeDeleteOutside(e) {
    if (e.target === document.getElementById('deleteOverlay')) {
        closeDeleteModal();
    }
}

// ===== 工具函数 =====
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
}

// ===== 键盘快捷键 =====
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
        closeDeleteModal();
    }
});
