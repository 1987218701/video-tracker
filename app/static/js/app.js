const { createApp, ref, reactive, computed, onMounted, nextTick } = Vue;

createApp({
    setup() {
        const items = ref([]);
        const loading = ref(false);
        const saving = ref(false);
        const deleting = ref(false);
        const page = ref(1);
        const total = ref(0);
        const perPage = ref(20);
        const activeTab = ref('video');
        const searchVisible = ref(false);
        const videoMode = ref('tv');

        const dialogVisible = ref(false);
        const detailVisible = ref(false);
        const deleteVisible = ref(false);
        const editingItem = ref(null);
        const detailItem = ref(null);
        const deletingItem = ref(null);
        const showAddChapter = ref(false);
        const newChapterTitle = ref('');
        const detailChapters = ref([]);
        const detailHistory = ref([]);
        const searchInput = ref(null);
        const csvInput = ref(null);

        let searchTimer = null;
        let toastTimer = null;

        const toast = reactive({ show: false, message: '', type: 'success', icon: '' });

        const tabs = [
            { key: 'video', label: '影视', icon: '\u{1F3AC}' },
            { key: 'tutorial', label: '教程', icon: '\u{1F4F9}' },
            { key: 'book', label: '书籍', icon: '\u{1F4D6}' },
            { key: 'stats', label: '统计', icon: '\u{1F4CA}' },
        ];

        const typeOptions = [
            { value: 'video', label: '影视', icon: '\u{1F3AC}' },
            { value: 'tutorial', label: '教程', icon: '\u{1F4F9}' },
            { value: 'book', label: '书籍', icon: '\u{1F4D6}' },
        ];

        const categoryOptionsMap = {
            tutorial: ['编程', '设计', '语言', '音乐', '其他'],
            book: ['小说', '技术', '历史', '哲学', '传记', '其他'],
        };

        // 影视分类：形式标签（电影/电视剧，互斥，决定进度模式）+ 可选的类型标签（可多选）
        // 覆盖 TMDB 常见 genre，避免补全回来的类型找不到对应分类
        const VIDEO_FORMAT_TAGS = ['电影', '电视剧'];
        const videoCategoryOptions = ref([
            '电影', '电视剧',
            '动画', '动作', '冒险', '科幻', '奇幻', '剧情', '喜剧',
            '悬疑', '惊悚', '恐怖', '犯罪', '爱情', '家庭', '音乐',
            '历史', '战争', '纪录片', '综艺', '真人秀', '儿童',
            '短片', '动漫', '其他',
        ]);

        // TMDB 中文 genre 名与本地标签略有差异时做归一化
        const GENRE_ALIAS = {
            '动作冒险': '动作', '科幻奇幻': '科幻', '战争政治': '战争',
            '脱口秀': '综艺', '新闻': '纪录片', '肥皂剧': '剧情',
            '电视电影': '其他', '西部': '其他',
        };
        const normalizeGenre = (name) => GENRE_ALIAS[name] || name;

        const ensureCategoryOptions = (tags) => {
            tags.forEach(t => {
                if (t && !videoCategoryOptions.value.includes(t)) videoCategoryOptions.value.push(t);
            });
        };
        const splitCategoryTags = (value) => {
            const tags = String(value || '')
                .split(/[、,，\/|]/).map(t => t.trim()).filter(Boolean);
            ensureCategoryOptions(tags);
            return tags.length ? tags : ['电视剧'];
        };

        // 三个可用状态；'弃置' 已从 UI 移除，仅后端兼容历史数据
        const statusOptions = [
            { value: '在看', label: '在看', icon: '\u{1F440}', cls: 'chip-watching' },
            { value: '已看完', label: '已看完', icon: '\u2705', cls: 'chip-completed' },
            { value: '想看', label: '想看', icon: '\u{1F4AD}', cls: 'chip-plan' },
        ];

        const emptyStats = () => ({
            total: 0, watching: 0, completed: 0, plan: 0, dropped: 0,
            by_type: {}, by_type_status: {}, rating_distribution: {},
            avg_rating: 0, rewatches: 0, added_this_month: 0, history_count: 0,
        });
        const stats = reactive(emptyStats());
        const tabStats = reactive({
            total: 0, watching: 0, completed: 0, plan: 0, dropped: 0
        });

        const activityDays = ref(182);
        const activity = reactive({ days: 182, total: 0, active_days: 0, today: '', series: [] });
        const recentActivity = ref([]);

        const metadataEnabled = ref(false);
        const metadataLoading = ref(false);
        const metadataResults = ref([]);
        const metadataHint = ref('');

        const filters = reactive({ keyword: '', status: '', sort: 'updated' });

        const defaultForm = () => ({
            type: 'video', title: '', category: '其他', categories: ['电视剧'], status: '想看',
            total_count: '', current_position: '', current_minutes: '',
            total_duration_min: '', current_duration_min: '',
            total_pages: '', current_page: '',
            rating: 0, note: '', cover_url: '', external_url: '',
        });
        const form = reactive(defaultForm());

        const currentTabLabel = computed(() => {
            const t = tabs.find(t => t.key === activeTab.value);
            return t ? t.label : '';
        });
        const currentTabIcon = computed(() => {
            const t = tabs.find(t => t.key === activeTab.value);
            return t ? t.icon : '';
        });
        const totalPages = computed(() => Math.ceil(total.value / perPage.value) || 1);
        const categoryOptions = computed(() => (
            form.type === 'video' ? videoCategoryOptions.value : (categoryOptionsMap[form.type] || [])
        ));
        const categoryText = computed(() => (
            form.type === 'video' ? (form.categories.join('、') || '未选择') : form.category
        ));

        // ---- helpers ----
        const showToast = (message, type = 'success') => {
            if (toastTimer) clearTimeout(toastTimer);
            toast.message = message;
            toast.type = type;
            toast.icon = type === 'success' ? '\u2713' : type === 'error' ? '\u2717' : 'i';
            toast.show = true;
            toastTimer = setTimeout(() => { toast.show = false; }, 2600);
        };

        const typeColor = (t) => ({ video: '#534AB7', tutorial: '#0F6E56', book: '#854F0B' }[t] || '#5F5E5A');
        const typeLabel = (t) => ({ video: '影视', tutorial: '教程', book: '书籍' }[t] || t);
        const typeClass = (t) => 'card-' + t;
        const statusClass = (s) => ({
            '在看': 'status-watching', '已看完': 'status-completed',
            '想看': 'status-plan', '弃置': 'status-dropped',
        }[s] || 'status-default');
        const statusIcon = (s) => ({
            '在看': '\u{1F441}', '已看完': '\u2705',
            '想看': '\u{1F4AD}', '弃置': '\u{1F6AB}',
        }[s] || '');

        const historyColor = (a) => ({
            created: '#16a34a', status: '#378ADD', progress: '#8b5cf6',
            rating: '#f59e0b', chapter: '#0F6E56', edited: '#9ca3af',
        }[a] || '#9ca3af');

        // 数据库里的时间是 UTC 字符串，展示时换算为北京时间 (UTC+8)
        const formatTime = (s) => {
            if (!s) return '';
            const d = new Date(String(s).replace(' ', 'T') + 'Z');
            if (isNaN(d.getTime())) return s;
            const bj = new Date(d.getTime() + 8 * 3600 * 1000);
            const p = (n) => String(n).padStart(2, '0');
            return `${p(bj.getUTCMonth() + 1)}-${p(bj.getUTCDate())} ${p(bj.getUTCHours())}:${p(bj.getUTCMinutes())}`;
        };

        const getProgressText = (item) => {
            if (item.type === 'video') {
                if (item.total_duration_min && !item.total_count) {
                    let t = '\u{1F3AC} ' + item.total_duration_min + ' 分钟';
                    if (item.current_duration_min) t += ' （已看 ' + item.current_duration_min + ' 分钟）';
                    return t;
                }
                if (item.total_count) {
                    let t = (item.current_position || 0) + '/' + item.total_count + ' 集';
                    if (item.current_minutes) t += ' (' + item.current_minutes + '分)';
                    return t;
                }
                if (item.current_position) {
                    let t = '已看 ' + item.current_position + ' 集';
                    if (item.current_minutes) t += ' (' + item.current_minutes + '分)';
                    return t;
                }
                return '';
            }
            if (item.type === 'tutorial') {
                if (item.total_count) return (item.current_position || 0) + '/' + item.total_count + ' 节';
                if (item.current_position) return '第 ' + item.current_position + ' 节';
                return '';
            }
            if (item.type === 'book') {
                if (item.total_pages) return '第 ' + (item.current_page || 0) + '/' + item.total_pages + ' 页';
                if (item.current_page) return '第 ' + item.current_page + ' 页';
                return '';
            }
            return '';
        };

        const getProgressPercent = (item) => {
            if (item.type === 'video') {
                if (item.total_count) {
                    return Math.min(100, Math.round((item.current_position || 0) / item.total_count * 100));
                }
                if (item.total_duration_min) {
                    return Math.min(100, Math.round((item.current_duration_min || 0) / item.total_duration_min * 100));
                }
            }
            if (item.type === 'tutorial' && item.total_count) {
                return Math.min(100, Math.round((item.current_position || 0) / item.total_count * 100));
            }
            if (item.type === 'book' && item.total_pages) {
                return Math.min(100, Math.round((item.current_page || 0) / item.total_pages * 100));
            }
            return null;
        };

        // ---- Search ----
        const toggleSearch = async () => {
            searchVisible.value = !searchVisible.value;
            if (searchVisible.value) {
                await nextTick();
                if (searchInput.value) searchInput.value.focus();
            } else if (filters.keyword) {
                filters.keyword = '';
                loadItems();
            }
        };

        const closeSearch = () => {
            searchVisible.value = false;
            if (filters.keyword) { filters.keyword = ''; loadItems(); }
        };

        const clearSearch = () => {
            filters.keyword = '';
            loadItems();
            if (searchInput.value) searchInput.value.focus();
        };

        // ---- API ----
        const loadItems = async () => {
            loading.value = true;
            try {
                const params = new URLSearchParams();
                if (activeTab.value !== 'stats') params.set('type', activeTab.value);
                if (filters.keyword) params.set('keyword', filters.keyword);
                if (filters.status) params.set('status', filters.status);
                params.set('sort', filters.sort);
                params.set('page', page.value);
                params.set('per_page', perPage.value);

                const resp = await fetch('/api/items?' + params.toString());
                const data = await resp.json();
                items.value = data.items || [];
                total.value = data.total || 0;
            } catch (e) {
                console.error('load error:', e);
                showToast('加载失败', 'error');
            } finally {
                loading.value = false;
            }
        };

        const loadStats = async () => {
            try {
                const resp = await fetch('/api/stats');
                Object.assign(stats, await resp.json());
            } catch (e) { console.error('stats error:', e); }
        };

        const loadTabStats = async (type) => {
            try {
                const resp = await fetch('/api/stats?type=' + type);
                Object.assign(tabStats, await resp.json());
            } catch (e) { console.error('tabStats error:', e); }
        };

        const loadActivity = async () => {
            try {
                const resp = await fetch('/api/activity?days=' + activityDays.value);
                Object.assign(activity, await resp.json());
            } catch (e) { console.error('activity error:', e); }
        };

        const loadRecentActivity = async () => {
            try {
                const resp = await fetch('/api/recent-activity?limit=12');
                recentActivity.value = await resp.json();
            } catch (e) { recentActivity.value = []; }
        };

        const loadDetailHistory = async (itemId) => {
            try {
                const resp = await fetch('/api/items/' + itemId + '/history?limit=30');
                detailHistory.value = await resp.json();
            } catch (e) { detailHistory.value = []; }
        };

        const loadMetadataConfig = async () => {
            try {
                const resp = await fetch('/api/metadata/config');
                metadataEnabled.value = (await resp.json()).enabled === true;
            } catch (e) { metadataEnabled.value = false; }
        };

        const loadStatsPage = async () => {
            await Promise.all([loadStats(), loadActivity(), loadRecentActivity()]);
        };

        const debounceLoad = () => {
            if (searchTimer) clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { page.value = 1; loadItems(); }, 300);
        };

        const switchTab = (key) => {
            activeTab.value = key;
            page.value = 1;
            filters.status = '';
            filters.keyword = '';
            searchVisible.value = false;
            if (key === 'stats') {
                items.value = [];
                loadStatsPage();
            } else {
                loadItems();
                loadTabStats(key);
            }
        };

        const setStatus = (val) => {
            filters.status = val;
            page.value = 1;
            loadItems();
        };

        const changePage = (delta) => {
            const newPage = page.value + delta;
            if (newPage >= 1 && newPage <= totalPages.value) {
                page.value = newPage;
                loadItems();
            }
        };

        // ---- Form ----
        const selectType = (type) => {
            form.type = type;
            form.total_count = '';
            form.current_position = '';
            form.current_minutes = '';
            form.total_duration_min = '';
            form.current_duration_min = '';
            form.total_pages = '';
            form.current_page = '';
            form.category = type === 'video' ? '其他' : (categoryOptionsMap[type] || [''])[0];
            form.categories = type === 'video' ? ['电视剧'] : [];
            metadataResults.value = [];
            metadataHint.value = '';
            if (type === 'video') videoMode.value = 'tv';
        };

        const switchVideoMode = (mode) => {
            if (videoMode.value === mode) return;
            videoMode.value = mode;
            if (mode === 'movie') {
                form.total_count = '';
                form.current_position = '';
                form.current_minutes = '';
            } else {
                form.total_duration_min = '';
                form.current_duration_min = '';
            }
            // 手动切换模式时同步形式标签，保留已选的类型标签
            if (form.type === 'video') {
                const format = mode === 'movie' ? '电影' : '电视剧';
                const genres = form.categories.filter(t => t !== '电影' && t !== '电视剧');
                form.categories = [format, ...genres];
            }
        };

        // 形式标签驱动进度模式：勾「电影」→ 时长模式，勾「电视剧」→ 集数模式
        const syncVideoModeFromCategories = () => {
            if (form.type !== 'video') return;
            if (form.categories.includes('电影')) switchVideoMode('movie');
            else if (form.categories.includes('电视剧')) switchVideoMode('tv');
        };

        const isFormatTag = (tag) => VIDEO_FORMAT_TAGS.includes(tag);

        // 影视分类多选；电影/电视剧为互斥的形式标签，其余为可叠加的类型标签
        const toggleCategory = (tag) => {
            if (form.type !== 'video') return;
            const idx = form.categories.indexOf(tag);
            if (idx >= 0) {
                // 至少保留一个形式标签，否则进度模式没有依据
                if (isFormatTag(tag) && form.categories.filter(t => isFormatTag(t)).length <= 1) return;
                form.categories.splice(idx, 1);
            } else {
                if (tag === '电影') {
                    form.categories = form.categories.filter(t => t !== '电视剧');
                } else if (tag === '电视剧') {
                    form.categories = form.categories.filter(t => t !== '电影');
                }
                form.categories.push(tag);
            }
            syncVideoModeFromCategories();
        };

        const onCategoryChange = () => { syncVideoModeFromCategories(); };

        const openAddDialog = () => {
            editingItem.value = null;
            Object.assign(form, defaultForm());
            const t = activeTab.value !== 'stats' ? activeTab.value : 'video';
            form.type = t;
            form.category = t === 'video' ? '其他' : (categoryOptionsMap[t] || [''])[0];
            form.categories = t === 'video' ? ['电视剧'] : [];
            videoMode.value = 'tv';
            metadataResults.value = [];
            metadataHint.value = '';
            dialogVisible.value = true;
        };

        const openEditDialog = (item) => {
            editingItem.value = item;
            const opts = categoryOptionsMap[item.type] || [''];
            Object.assign(form, {
                type: item.type, title: item.title,
                category: item.type === 'video'
                    ? '其他'
                    : (opts.includes(item.category) ? item.category : opts[0]),
                categories: item.type === 'video' ? splitCategoryTags(item.category) : [],
                status: item.status,
                // 用 ?? 保留 0（补全电影时已看时长默认 0）
                total_count: item.total_count ?? '', current_position: item.current_position ?? '',
                current_minutes: item.current_minutes ?? '',
                total_duration_min: item.total_duration_min ?? '',
                current_duration_min: item.current_duration_min ?? '',
                total_pages: item.total_pages ?? '', current_page: item.current_page ?? '',
                rating: item.rating ?? 0, note: item.note ?? '',
                cover_url: item.cover_url ?? '', external_url: item.external_url ?? '',
            });
            if (item.type === 'video') {
                // 形式标签是进度模式的唯一依据；纯按进度字段推断会在电影片长缺失时
                // 误判为剧集模式，导致电影再次出现「总集数」输入框
                if (!form.categories.some(t => isFormatTag(t))) {
                    form.categories = ['电视剧', ...form.categories];
                }
                videoMode.value = form.categories.includes('电影') ? 'movie' : 'tv';
            }
            metadataResults.value = [];
            metadataHint.value = '';
            dialogVisible.value = true;
        };

        const saveItem = async () => {
            if (!form.title.trim()) { showToast('请输入标题', 'error'); return; }
            saving.value = true;
            try {
                const toNum = (v) => (v === '' || v === null || v === undefined) ? null : Number(v);

                if (form.type === 'video') {
                    if (videoMode.value === 'tv') {
                        form.total_duration_min = '';
                        form.current_duration_min = '';
                    } else {
                        form.total_count = '';
                        form.current_position = '';
                        form.current_minutes = '';
                    }
                }

                const payload = {
                    type: form.type, title: form.title.trim(),
                    // 影视多选标签用顿号拼成字符串存储，兼容原有 TEXT 字段与 CSV
                    category: form.type === 'video'
                        ? form.categories.join('、')
                        : form.category,
                    status: form.status,
                    total_count: toNum(form.total_count),
                    current_position: toNum(form.current_position),
                    current_minutes: toNum(form.current_minutes),
                    total_duration_min: toNum(form.total_duration_min),
                    current_duration_min: toNum(form.current_duration_min),
                    total_pages: toNum(form.total_pages),
                    current_page: toNum(form.current_page),
                    rating: form.rating || null,
                    note: form.note.trim(),
                    cover_url: form.cover_url.trim(),
                    external_url: form.external_url.trim(),
                };

                let resp;
                if (editingItem.value) {
                    resp = await fetch('/api/items/' + editingItem.value.id, {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                } else {
                    resp = await fetch('/api/items', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                }
                if (!resp.ok) throw new Error('save failed');

                showToast(editingItem.value ? '更新成功' : '添加成功');
                dialogVisible.value = false;
                loadItems();
                loadStats();
                loadTabStats(activeTab.value === 'stats' ? 'video' : activeTab.value);
                loadRecentActivity();
                loadActivity();
            } catch (e) {
                console.error('save error:', e);
                showToast('保存失败', 'error');
            } finally {
                saving.value = false;
            }
        };

        // ---- Metadata lookup (optional TMDB) ----
        const searchMetadata = async () => {
            metadataResults.value = [];
            metadataHint.value = '';
            if (!form.title.trim()) {
                metadataHint.value = '请先输入标题再搜索';
                return;
            }
            if (!metadataEnabled.value) {
                metadataHint.value = '自动补全需配置 TMDB_API_KEY（写在 .env 或 docker-compose.yml 中）；也可以直接填下方的封面图链接与外部链接。';
                return;
            }
            metadataLoading.value = true;
            try {
                const resp = await fetch('/api/metadata/search?q=' + encodeURIComponent(form.title.trim()));
                const data = await resp.json();
                if (!resp.ok) { metadataHint.value = data.error || '搜索失败'; return; }
                metadataResults.value = data.results || [];
                if (!metadataResults.value.length) metadataHint.value = '没有找到匹配结果';
            } catch (e) {
                metadataHint.value = '搜索失败，请检查网络连接';
            } finally {
                metadataLoading.value = false;
            }
        };

        const applyMetadata = async (r) => {
            form.title = r.title;
            form.cover_url = r.cover_url || '';
            form.external_url = r.external_url || '';
            // 影视的「简介」字段复用 note 列；先填搜索结果的截断简介，
            // 详情请求成功后再换成完整版，失败时至少保留这一版
            // 无简介时保留用户已写内容，不要清空
            if (form.type === 'video' && r.overview) form.note = r.overview;
            metadataResults.value = [];

            const isMovie = r.media_type === 'movie';
            const formatTag = isMovie ? '电影' : '电视剧';
            if (form.type === 'video') {
                // media_type 决定形式标签与进度模式，并先清空两组进度字段
                form.categories = [formatTag];
                videoMode.value = isMovie ? 'movie' : 'tv';
                form.total_count = ''; form.current_position = ''; form.current_minutes = '';
                form.total_duration_min = ''; form.current_duration_min = '';
            }

            metadataLoading.value = true;
            metadataHint.value = '正在获取片长 / 集数与类型标签...';
            try {
                const resp = await fetch(
                    '/api/metadata/detail?media_type=' + encodeURIComponent(r.media_type)
                    + '&id=' + encodeURIComponent(r.id)
                );
                const d = await resp.json();
                if (!resp.ok) throw new Error(d.error || '详情获取失败');

                if (form.type === 'video') {
                    const tags = [formatTag];
                    (d.genres || []).forEach(g => {
                        const name = normalizeGenre(g);
                        if (name && !tags.includes(name)) tags.push(name);
                    });
                    // TMDB 返回未知类型时动态加入选项，保证一定有对应分类
                    ensureCategoryOptions(tags);
                    form.categories = tags;
                    if (d.overview) form.note = d.overview;

                    if (isMovie) {
                        form.total_duration_min = d.total_duration_min || '';
                        form.current_duration_min = 0;
                    } else {
                        form.total_count = d.total_count || '';
                        form.current_position = 1;
                    }
                }
                metadataHint.value = isMovie
                    ? '已填充标题、类型、简介、片长（已看 0 分钟）、封面与链接'
                    : '已填充标题、类型、简介、总集数（当前第 1 集）、封面与链接';
            } catch (e) {
                metadataHint.value = '基本信息已填充，但详情获取失败，请手动填写'
                    + (isMovie ? '片长' : '总集数') + '：' + (e.message || '网络错误');
            } finally {
                metadataLoading.value = false;
            }
        };

        // ---- CSV ----
        const exportCsv = async () => {
            try {
                const resp = await fetch('/api/export');
                if (!resp.ok) throw new Error('export failed');
                const blob = await resp.blob();
                const url = URL.createObjectURL(blob);
                const cd = resp.headers.get('Content-Disposition') || '';
                const m = cd.match(/filename=([^;]+)/);
                const a = document.createElement('a');
                a.href = url;
                a.download = m ? m[1] : 'media-tracker.csv';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast('CSV 已导出');
            } catch (e) {
                showToast('导出失败', 'error');
            }
        };

        const importCsv = async (event) => {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            const fd = new FormData();
            fd.append('file', file);
            try {
                const resp = await fetch('/api/import', { method: 'POST', body: fd });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error || '导入失败');
                let msg = `导入完成：新增 ${data.created}，跳过 ${data.skipped}`;
                if (data.error_count) msg += `，${data.error_count} 行出错`;
                showToast(msg, data.error_count ? 'error' : 'success');
                loadItems();
                loadStatsPage();
                loadTabStats(activeTab.value === 'stats' ? 'video' : activeTab.value);
            } catch (e) {
                showToast('导入失败：' + (e.message || ''), 'error');
            } finally {
                event.target.value = '';
            }
        };

        // ---- Detail / chapters / history ----
        const openDetail = async (item) => {
            detailItem.value = item;
            detailVisible.value = true;
            showAddChapter.value = false;
            newChapterTitle.value = '';
            detailHistory.value = [];
            if (item.type === 'tutorial') await loadChapters(item.id);
            await loadDetailHistory(item.id);
        };

        const loadChapters = async (itemId) => {
            try {
                const resp = await fetch('/api/items/' + itemId + '/chapters');
                detailChapters.value = await resp.json();
            } catch (e) { detailChapters.value = []; }
        };

        const refreshChapterSideEffects = async () => {
            await loadChapters(detailItem.value.id);
            await loadDetailHistory(detailItem.value.id);
            loadRecentActivity();
            loadActivity();
        };

        const addChapter = async () => {
            const title = newChapterTitle.value.trim();
            if (!title) { showToast('请输入章节名称', 'error'); return; }
            try {
                const resp = await fetch('/api/items/' + detailItem.value.id + '/chapters', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title }),
                });
                if (!resp.ok) throw new Error('add failed');
                newChapterTitle.value = '';
                await refreshChapterSideEffects();
                showToast('已添加章节');
            } catch (e) { showToast('添加失败', 'error'); }
        };

        const toggleChapter = async (ch) => {
            try {
                const resp = await fetch(
                    '/api/items/' + detailItem.value.id + '/chapters/' + ch.id, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ completed: ch.completed === 1 ? 0 : 1 }),
                });
                if (!resp.ok) throw new Error('update failed');
                await refreshChapterSideEffects();
            } catch (e) { showToast('更新失败', 'error'); }
        };

        const deleteChapter = async (ch) => {
            try {
                const resp = await fetch(
                    '/api/items/' + detailItem.value.id + '/chapters/' + ch.id,
                    { method: 'DELETE' }
                );
                if (!resp.ok) throw new Error('delete failed');
                await refreshChapterSideEffects();
                showToast('已删除');
            } catch (e) { showToast('删除失败', 'error'); }
        };

        const confirmDelete = (item) => {
            deletingItem.value = item;
            deleteVisible.value = true;
        };

        const deleteItem = async () => {
            if (!deletingItem.value) return;
            deleting.value = true;
            try {
                const resp = await fetch('/api/items/' + deletingItem.value.id, { method: 'DELETE' });
                if (!resp.ok) throw new Error('delete failed');
                showToast('已删除');
                deleteVisible.value = false;
                loadItems();
                loadStats();
                loadTabStats(activeTab.value === 'stats' ? 'video' : activeTab.value);
                loadRecentActivity();
                loadActivity();
            } catch (e) {
                showToast('删除失败', 'error');
            } finally {
                deleting.value = false;
            }
        };

        // ---- Stats computed ----
        const levelOf = (count) => {
            if (!count) return 0;
            if (count <= 2) return 1;
            if (count <= 5) return 2;
            if (count <= 9) return 3;
            return 4;
        };

        const heatmapWeeks = computed(() => {
            const series = activity.series || [];
            if (!series.length) return [];
            const first = new Date(series[0].date + 'T00:00:00Z');
            const offset = first.getUTCDay(); // 0 = 周日
            const cells = Array(offset).fill(null).concat(series.map(x => ({
                date: x.date, count: x.count, level: levelOf(x.count)
            })));
            while (cells.length % 7 !== 0) cells.push(null);
            const weeks = [];
            for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
            return weeks;
        });

        // 统计页概览卡：每张卡的进度条都有明确语义（占比 / 完成率 / 满分比）
        const overviewCards = computed(() => {
            const total = stats.total || 0;
            const share = (n) => total ? Math.min(100, Math.round((n || 0) / total * 100)) : 0;
            const rated = Object.values(stats.rating_distribution || {})
                .reduce((sum, n) => sum + (Number(n) || 0), 0);
            const completion = share(stats.completed);
            const avg = stats.avg_rating || 0;
            return [
                {
                    label: '总记录', icon: '\u25A4', tone: 'blue',
                    value: total, unit: '条',
                    percent: share(stats.added_this_month),
                    foot: `本月新增 ${stats.added_this_month || 0} 条 · 共 ${stats.history_count || 0} 条变更`,
                },
                {
                    label: '在看 / 在读', icon: '\u25C9', tone: 'violet',
                    value: stats.watching || 0, unit: '条',
                    percent: share(stats.watching),
                    foot: `想看 ${stats.plan || 0} 条待开始 · 占比 ${share(stats.watching)}%`,
                },
                {
                    label: '已完成', icon: '\u2713', tone: 'green',
                    value: stats.completed || 0, unit: '条',
                    percent: completion,
                    foot: `完成率 ${completion}% · 重看 ${stats.rewatches || 0} 次`,
                },
                {
                    label: '平均评分', icon: '\u2605', tone: 'amber',
                    value: avg || '\u2014', unit: avg ? '分' : '',
                    percent: Math.round(avg / 5 * 100),
                    foot: `已评分 ${rated} 条 · 满分 5 分`,
                },
            ];
        });

        const statusBars = computed(() => {
            const defs = [
                { label: '在看', key: 'watching', color: '#378ADD' },
                { label: '已看完', key: 'completed', color: '#16a34a' },
                { label: '想看', key: 'plan', color: '#d97706' },
            ];
            const max = Math.max(1, ...defs.map(d => stats[d.key] || 0));
            return defs.map(d => ({
                label: d.label, value: stats[d.key] || 0, color: d.color,
                percent: Math.round((stats[d.key] || 0) / max * 100),
            }));
        });

        const typeBars = computed(() => {
            const defs = [
                { label: '影视', key: 'video', color: '#534AB7' },
                { label: '教程', key: 'tutorial', color: '#0F6E56' },
                { label: '书籍', key: 'book', color: '#854F0B' },
            ];
            const dist = stats.by_type || {};
            const max = Math.max(1, ...defs.map(d => dist[d.key] || 0));
            return defs.map(d => ({
                label: d.label, value: dist[d.key] || 0, color: d.color,
                percent: Math.round((dist[d.key] || 0) / max * 100),
            }));
        });

        const ratingBarHeight = (count) => {
            const dist = stats.rating_distribution || {};
            const max = Math.max(1, ...Object.values(dist));
            return Math.round((count || 0) / max * 100);
        };

        onMounted(() => {
            loadItems();
            loadStats();
            loadTabStats(activeTab.value);
            loadActivity();
            loadRecentActivity();
            loadMetadataConfig();
        });

        return {
            items, loading, saving, deleting, page, total, totalPages, activeTab, tabs,
            dialogVisible, detailVisible, deleteVisible,
            editingItem, detailItem, deletingItem,
            form, filters, stats, tabStats, toast,
            typeOptions, statusOptions, categoryOptions, categoryText,
            videoCategoryOptions, isFormatTag,
            videoMode, searchVisible, searchInput, csvInput,
            currentTabLabel, currentTabIcon,
            showAddChapter, newChapterTitle, detailChapters, detailHistory,
            activity, activityDays, recentActivity,
            heatmapWeeks, statusBars, typeBars, ratingBarHeight, overviewCards,
            metadataEnabled, metadataLoading, metadataResults, metadataHint,
            switchTab, setStatus, debounceLoad, loadItems, changePage,
            selectType, switchVideoMode, onCategoryChange, toggleCategory,
            toggleSearch, closeSearch, clearSearch,
            openAddDialog, openEditDialog, openDetail, saveItem,
            confirmDelete, deleteItem,
            addChapter, toggleChapter, deleteChapter,
            loadRecentActivity, loadStatsPage, exportCsv, importCsv,
            searchMetadata, applyMetadata,
            formatTime, historyColor,
            typeColor, typeLabel, typeClass, statusClass, statusIcon,
            getProgressText, getProgressPercent,
        };
    }
}).mount('#app');
