const { createApp, ref, reactive, computed, watch, onMounted } = Vue;
const { ElMessage, ElMessageBox } = ElementPlus;

const StatCard = {
    props: ['label', 'value', 'color'],
    template: `
        <div class="stat-card" :style="{ borderColor: color }">
            <div class="stat-value" :style="{ color: color }">{{ value }}</div>
            <div class="stat-label">{{ label }}</div>
        </div>
    `
};

const VideoCard = {
    props: ['video'],
    emits: ['edit', 'delete'],
    setup(props, { emit }) {
        const getProgress = (v) => {
            if (v.total_episodes) {
                const current = v.current_episode || 0;
                return { value: `${current}/${v.total_episodes}`, label: '集数' };
            }
            if (v.total_duration_min) {
                const current = v.current_duration_min || 0;
                return { value: `${current}/${v.total_duration_min}`, label: '分钟' };
            }
            return { value: '-', label: '无进度' };
        };

        const progress = computed(() => getProgress(props.video));

        const getStatusType = (status) => {
            const map = {
                '在看': 'primary',
                '已看完': 'success',
                '想看': 'warning',
                '弃剧': 'danger'
            };
            return map[status] || 'info';
        };

        const getCategoryIcon = (category) => {
            const map = {
                '电视剧': 'VideoCamera',
                '电影': 'Film',
                '动漫': 'Monitor',
                '综艺': 'Tickets',
                '纪录片': 'Document'
            };
            return map[category] || 'VideoPlay';
        };

        return {
            progress,
            getStatusType,
            getCategoryIcon
        };
    },
    template: `
        <el-card shadow="hover" class="video-card" :body-style="{ padding: '20px' }">
            <div class="card-header">
                <div class="card-title">
                    <el-icon class="category-icon" style="color: #409EFF; margin-right: 8px;">
                        <component :is="getCategoryIcon(video.category)"></component>
                    </el-icon>
                    <span class="title-text" :title="video.title">{{ video.title }}</span>
                </div>
                <el-tag :type="getStatusType(video.status)" effect="dark" size="small">
                    {{ video.status }}
                </el-tag>
            </div>
            <div class="card-content">
                <div class="meta-line">
                    <el-tag size="small" type="info">{{ video.category }}</el-tag>
                    <span v-if="video.note" class="note-text" :title="video.note">
                        📝 {{ video.note.length > 15 ? video.note.slice(0, 15) + '...' : video.note }}
                    </span>
                </div>
                <div class="progress-line">
                    <span class="progress-value">{{ progress.value }}</span>
                    <span class="progress-label">{{ progress.label }}</span>
                </div>
                <div v-if="video.rating" class="rating-line">
                    <el-rate
                        v-model="video.rating"
                        disabled
                        :max="10"
                        show-score
                        text-color="#ff9900"
                        score-template="{value}"
                    ></el-rate>
                </div>
            </div>
            <div class="card-actions">
                <el-button type="primary" size="small" @click="$emit('edit', video)" plain>
                    <el-icon><Edit /></el-icon> 编辑
                </el-button>
                <el-button type="danger" size="small" @click="$emit('delete', video)" plain>
                    <el-icon><Delete /></el-icon> 删除
                </el-button>
            </div>
        </el-card>
    `
};

const app = createApp({
    components: {
        StatCard,
        VideoCard
    },
    setup() {
        const videos = ref([]);
        const stats = ref({ total: 0, watching: 0, completed: 0, plan: 0, dropped: 0 });
        const loading = ref(false);
        const saving = ref(false);
        const deleting = ref(false);
        const dialogVisible = ref(false);
        const deleteDialogVisible = ref(false);
        const editingVideo = ref(null);
        const deletingVideo = ref(null);
        const formRef = ref(null);
        let searchTimer = null;

        const filters = reactive({
            keyword: '',
            category: '',
            status: ''
        });

        const form = reactive({
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

        const rules = {
            title: [
                { required: true, message: '请输入标题', trigger: 'blur' }
            ]
        };

        const loadStats = async () => {
            try {
                const res = await fetch('/api/videos/stats');
                stats.value = await res.json();
            } catch (e) {
                console.error('加载统计失败:', e);
            }
        };

        const loadVideos = async () => {
            loading.value = true;
            const params = new URLSearchParams();
            if (filters.keyword) params.set('keyword', filters.keyword);
            if (filters.category) params.set('category', filters.category);
            if (filters.status) params.set('status', filters.status);

            try {
                const res = await fetch(`/api/videos?${params.toString()}`);
                videos.value = await res.json();
                loadStats();
            } catch (e) {
                console.error('加载失败:', e);
                ElMessage.error('加载失败，请重试');
            } finally {
                loading.value = false;
            }
        };

        const debounceLoadVideos = () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(loadVideos, 300);
        };

        const openModal = (video = null) => {
            editingVideo.value = video;
            if (video) {
                Object.assign(form, {
                    title: video.title,
                    category: video.category,
                    status: video.status,
                    total_episodes: video.total_episodes,
                    current_episode: video.current_episode,
                    total_duration_min: video.total_duration_min,
                    current_duration_min: video.current_duration_min,
                    rating: video.rating,
                    note: video.note || ''
                });
            } else {
                Object.assign(form, {
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
            }
            dialogVisible.value = true;
        };

        const saveVideo = async () => {
            if (!formRef.value) return;
            await formRef.value.validate(async (valid) => {
                if (valid) {
                    saving.value = true;
                    try {
                        const data = {
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

                        const url = editingVideo.value ? `/api/videos/${editingVideo.value.id}` : '/api/videos';
                        const method = editingVideo.value ? 'PUT' : 'POST';
                        const res = await fetch(url, {
                            method,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(data)
                        });

                        if (!res.ok) {
                            const err = await res.json();
                            ElMessage.error(err.error || '操作失败');
                            return;
                        }

                        ElMessage.success(editingVideo.value ? '更新成功' : '添加成功');
                        dialogVisible.value = false;
                        loadVideos();
                    } catch (e) {
                        console.error('保存失败:', e);
                        ElMessage.error('保存失败，请重试');
                    } finally {
                        saving.value = false;
                    }
                }
            });
        };

        const editVideo = async (video) => {
            openModal(video);
        };

        const confirmDelete = (video) => {
            deletingVideo.value = video;
            deleteDialogVisible.value = true;
        };

        const deleteVideo = async () => {
            if (!deletingVideo.value) return;
            deleting.value = true;
            try {
                const res = await fetch(`/api/videos/${deletingVideo.value.id}`, { method: 'DELETE' });
                if (!res.ok) {
                    ElMessage.error('删除失败');
                    return;
                }
                ElMessage.success('删除成功');
                deleteDialogVisible.value = false;
                loadVideos();
            } catch (e) {
                ElMessage.error('删除失败');
            } finally {
                deleting.value = false;
            }
        };

        onMounted(() => {
            loadVideos();
        });

        return {
            videos,
            stats,
            loading,
            saving,
            deleting,
            dialogVisible,
            deleteDialogVisible,
            editingVideo,
            deletingVideo,
            form,
            formRef,
            rules,
            filters,
            debounceLoadVideos,
            loadVideos,
            openModal,
            saveVideo,
            editVideo,
            confirmDelete,
            deleteVideo
        };
    }
});

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component);
}

app.use(ElementPlus);
app.mount('#app');
