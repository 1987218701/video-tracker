
document.addEventListener('DOMContentLoaded', function() {
    if (typeof Vue === 'undefined' || typeof ElementPlus === 'undefined') {
        console.error('Vue or ElementPlus not loaded');
        return;
    }

    var VueCreateApp = Vue.createApp;
    var VueRef = Vue.ref;
    var VueReactive = Vue.reactive;
    var VueComputed = Vue.computed;
    var VueOnMounted = Vue.onMounted;

    var ElMsg = ElementPlus.ElMessage;

    var StatCard = {
        props: ['label', 'value', 'color'],
        template: '\n        <div class="stat-card" :style="{ \'--stat-color\': color }">\n            <div class="stat-value" :style="{ color: color }">{{ value }}</div>\n            <div class="stat-label">{{ label }}</div>\n        </div>\n    '
    };

    var VideoCard = {
        props: ['video', 'index'],
        emits: ['edit', 'delete'],
        setup: function(props, context) {
            var emit = context.emit;

            var getProgress = function(v) {
                if (v.total_episodes) {
                    var current = v.current_episode || 0;
                    return { value: current + '/' + v.total_episodes, label: '集数' };
                }
                if (v.total_duration_min) {
                    var current = v.current_duration_min || 0;
                    return { value: current + '/' + v.total_duration_min, label: '分钟' };
                }
                return { value: '-', label: '无进度' };
            };

            var progress = VueComputed(function() {
                return getProgress(props.video);
            });

            var getStatusType = function(status) {
                var map = {
                    '在看': 'primary',
                    '已看完': 'success',
                    '想看': 'warning',
                    '弃剧': 'danger'
                };
                return map[status] || 'info';
            };

            return {
                progress: progress,
                getStatusType: getStatusType
            };
        },
        template: '\n        <el-card shadow="hover" class="video-card fade-in" :style="{ animationDelay: (index * 0.1) + \'s\' }">\n            <div class="card-header">\n                <div class="card-title">\n                    <span class="category-icon" style="color: #409EFF; margin-right: 8px; font-size: 1.2rem;">\n                        {{ video.category === \'电视剧\' ? \'📺\' : video.category === \'电影\' ? \'🎬\' : video.category === \'动漫\' ? \'🎮\' : video.category === \'综艺\' ? \'🎤\' : video.category === \'纪录片\' ? \'📄\' : \'📹\' }}\n                    </span>\n                    <span class="title-text" :title="video.title">{{ video.title }}</span>\n                </div>\n                <el-tag :type="getStatusType(video.status)" effect="dark" size="small">\n                    {{ video.status }}\n                </el-tag>\n            </div>\n            <div class="card-content">\n                <div class="meta-line">\n                    <el-tag size="small" type="info">{{ video.category }}</el-tag>\n                    <span v-if="video.note" class="note-text" :title="video.note">\n                        📝 {{ video.note.length > 15 ? video.note.slice(0, 15) + \'...\' : video.note }}\n                    </span>\n                </div>\n                <div class="progress-line">\n                    <span class="progress-value">{{ progress.value }}</span>\n                    <span class="progress-label">{{ progress.label }}</span>\n                </div>\n            </div>\n            <div class="card-actions">\n                <el-button type="primary" size="small" @click="$emit(\'edit\', video)" plain>\n                    ✏️ 编辑\n                </el-button>\n                <el-button type="danger" size="small" @click="$emit(\'delete\', video)" plain>\n                    🗑️ 删除\n                </el-button>\n            </div>\n        </el-card>\n    '
    };

    var app = VueCreateApp({
        components: {
            StatCard: StatCard,
            VideoCard: VideoCard
        },
        setup: function() {
            var videos = VueRef([]);
            var stats = VueRef({ total: 0, watching: 0, completed: 0, plan: 0, dropped: 0 });
            var loading = VueRef(false);
            var saving = VueRef(false);
            var deleting = VueRef(false);
            var dialogVisible = VueRef(false);
            var deleteDialogVisible = VueRef(false);
            var editingVideo = VueRef(null);
            var deletingVideo = VueRef(null);
            var searchTimer = null;

            var filters = VueReactive({
                keyword: '',
                category: '',
                status: ''
            });

            var form = VueReactive({
                title: '',
                category: '电视剧',
                status: '在看',
                total_episodes: null,
                current_episode: null,
                total_duration_min: null,
                current_duration_min: null,
                rating: null,
                note: ''
            });

            var loadStats = function() {
                return new Promise(function(resolve, reject) {
                    fetch('/api/videos/stats')
                        .then(function(res) { return res.json(); })
                        .then(function(data) {
                            stats.value = data;
                            resolve();
                        })
                        .catch(function(e) {
                            console.error('加载统计失败:', e);
                            resolve();
                        });
                });
            };

            var loadVideos = function() {
                loading.value = true;
                var params = new URLSearchParams();
                if (filters.keyword) params.set('keyword', filters.keyword);
                if (filters.category) params.set('category', filters.category);
                if (filters.status) params.set('status', filters.status);

                fetch('/api/videos?' + params.toString())
                    .then(function(res) { return res.json(); })
                    .then(function(data) {
                        videos.value = data;
                        return loadStats();
                    })
                    .catch(function(e) {
                        console.error('加载失败:', e);
                        if (ElMsg) ElMsg.error('加载失败，请重试');
                    })
                    .finally(function() {
                        loading.value = false;
                    });
            };

            var debounceLoadVideos = function() {
                if (searchTimer) clearTimeout(searchTimer);
                searchTimer = setTimeout(loadVideos, 300);
            };

            var openModal = function(video) {
                editingVideo.value = video || null;
                if (video) {
                    form.title = video.title;
                    form.category = video.category;
                    form.status = video.status;
                    form.total_episodes = video.total_episodes;
                    form.current_episode = video.current_episode;
                    form.total_duration_min = video.total_duration_min;
                    form.current_duration_min = video.current_duration_min;
                    form.rating = video.rating;
                    form.note = video.note || '';
                } else {
                    form.title = '';
                    form.category = '电视剧';
                    form.status = '在看';
                    form.total_episodes = null;
                    form.current_episode = null;
                    form.total_duration_min = null;
                    form.current_duration_min = null;
                    form.rating = null;
                    form.note = '';
                }
                dialogVisible.value = true;
            };

            var validateForm = function() {
                if (!form.title || form.title.trim() === '') {
                    if (ElMsg) ElMsg.error('请输入标题');
                    return false;
                }
                return true;
            };

            var saveVideo = function() {
                if (!validateForm()) return;

                saving.value = true;
                var data = {
                    title: form.title.trim(),
                    category: form.category,
                    status: form.status,
                    total_episodes: form.total_episodes,
                    current_episode: form.current_episode,
                    total_duration_min: form.total_duration_min,
                    current_duration_min: form.current_duration_min,
                    rating: form.rating,
                    note: form.note.trim()
                };

                var url = editingVideo.value ? '/api/videos/' + editingVideo.value.id : '/api/videos';
                var method = editingVideo.value ? 'PUT' : 'POST';

                fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                })
                    .then(function(res) {
                        if (!res.ok) {
                            return res.json().then(function(err) {
                                throw new Error(err.error || '操作失败');
                            });
                        }
                        if (ElMsg) ElMsg.success(editingVideo.value ? '更新成功' : '添加成功');
                        dialogVisible.value = false;
                        loadVideos();
                    })
                    .catch(function(e) {
                        console.error('保存失败:', e);
                        if (ElMsg) ElMsg.error('保存失败，请重试');
                    })
                    .finally(function() {
                        saving.value = false;
                    });
            };

            var editVideo = function(video) {
                openModal(video);
            };

            var confirmDelete = function(video) {
                deletingVideo.value = video;
                deleteDialogVisible.value = true;
            };

            var deleteVideo = function() {
                if (!deletingVideo.value) return;
                deleting.value = true;

                fetch('/api/videos/' + deletingVideo.value.id, { method: 'DELETE' })
                    .then(function(res) {
                        if (!res.ok) throw new Error('删除失败');
                        if (ElMsg) ElMsg.success('删除成功');
                        deleteDialogVisible.value = false;
                        loadVideos();
                    })
                    .catch(function(e) {
                        if (ElMsg) ElMsg.error('删除失败');
                    })
                    .finally(function() {
                        deleting.value = false;
                    });
            };

            VueOnMounted(function() {
                loadVideos();
            });

            return {
                videos: videos,
                stats: stats,
                loading: loading,
                saving: saving,
                deleting: deleting,
                dialogVisible: dialogVisible,
                deleteDialogVisible: deleteDialogVisible,
                editingVideo: editingVideo,
                deletingVideo: deletingVideo,
                form: form,
                filters: filters,
                debounceLoadVideos: debounceLoadVideos,
                loadVideos: loadVideos,
                openModal: openModal,
                saveVideo: saveVideo,
                editVideo: editVideo,
                confirmDelete: confirmDelete,
                deleteVideo: deleteVideo
            };
        }
    });

    app.use(ElementPlus);
    app.mount('#app');
});
