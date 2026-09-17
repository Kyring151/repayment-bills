/* ============================================
 * 还款账单工作台 - 核心逻辑
 * 数据存储：LocalStorage
 * 架构：原生 JavaScript，无框架
 * 交互：9 个预设平台单行内联录入 + 自定义项目
 * 模型：每个平台只记录「当月实际还款金额」
 * ============================================ */

(function () {
    'use strict';

    // ---------- 常量配置 ----------
    const STORAGE_KEY = 'repayment_bills_v1';

    // 固定平台列表（9 个，含颜色与图标）
    const DEFAULT_PLATFORMS = [
        { name: '微信分付', color: '#07C160', icon: '💬' },
        { name: '信用卡',   color: '#165DFF', icon: '💳' },
        { name: '车贷',     color: '#722ED1', icon: '🚗' },
        { name: '保险',     color: '#F53F3F', icon: '🛡️' },
        { name: '花呗',     color: '#FF7D00', icon: '😊' },
        { name: '拿去花',   color: '#FF9A2E', icon: '✈️' },
        { name: '白条',     color: '#D4A017', icon: '🧾' },
        { name: '美团月付', color: '#F5A623', icon: '🍔' },
        { name: '抖音月付', color: '#1D2129', icon: '🎵' }
    ];

    // 自定义项目自动分配的颜色盘
    const CHART_COLORS = [
        '#0FC6C2', '#F7BA1E', '#14C9C9', '#F5319D', '#3491FA',
        '#722ED1', '#FF7D00', '#00B42A', '#F53F3F', '#86909C'
    ];

    // ---------- 状态 ----------
    let state = {
        currentYear: new Date().getFullYear(),
        currentMonth: new Date().getMonth() + 1, // 1-12
        bills: {}, // 结构：{ '2026-09': [ {id, platform, amount, custom, color}, ... ] }
        customPlatforms: [] // 兼容旧版本数据
    };

    // 图表实例
    let monthPieChart = null;
    let yearPieChart = null;
    let trendChart = null;

    // 录入自动保存防抖
    let saveTimer = null;

    // ---------- 工具函数 ----------

    function genId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function fmtMoney(num) {
        const n = Number(num) || 0;
        return '¥' + n.toFixed(2);
    }

    function monthKey(year, month) {
        return year + '-' + String(month).padStart(2, '0');
    }

    function getMonthBills(year, month) {
        return state.bills[monthKey(year, month)] || [];
    }

    function setMonthBills(year, month, bills) {
        const key = monthKey(year, month);
        if (!bills || bills.length === 0) {
            delete state.bills[key];
        } else {
            state.bills[key] = bills;
        }
        saveStorage();
    }

    function loadStorage() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            const data = JSON.parse(raw);
            if (data && typeof data === 'object') {
                state.bills = data.bills || {};
                state.customPlatforms = data.customPlatforms || [];
                migrateData();
                return true;
            }
        } catch (e) {
            console.warn('读取本地数据失败:', e);
        }
        return false;
    }

    /**
     * 旧数据迁移：旧版每条有 amount(应还)/paid(已还)/dueDate，
     * 新版只保留「实际还款金额」——优先取 paid，否则取 amount。
     */
    function migrateData() {
        let changed = false;
        Object.keys(state.bills).forEach(function (key) {
            const migrated = [];
            state.bills[key].forEach(function (b) {
                let amount = Number(b.amount) || 0;
                const paid = Number(b.paid) || 0;
                if (paid > 0) amount = paid;
                if ('paid' in b || 'dueDate' in b) changed = true;
                if (amount === 0 && !b.custom) return; // 空账单丢弃
                migrated.push({
                    id: b.id || genId(),
                    platform: b.platform,
                    amount: amount,
                    custom: !!b.custom,
                    color: b.color,
                    remark: b.remark || ''
                });
            });
            if (migrated.length === 0) {
                delete state.bills[key];
            } else {
                state.bills[key] = migrated;
            }
        });
        if (changed) saveStorage();
    }

    function saveStorage() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                bills: state.bills,
                customPlatforms: state.customPlatforms,
                updatedAt: new Date().toISOString()
            }));
        } catch (e) {
            console.warn('保存数据失败:', e);
            showToast('保存失败，存储空间可能已满', 'error');
        }
    }

    /** 平台颜色：预设平台取固定色，自定义项目取记录中保存的颜色 */
    function getPlatformColor(name) {
        const p = DEFAULT_PLATFORMS.find(p => p.name === name);
        if (p) return p.color;
        const months = Object.keys(state.bills);
        for (let i = 0; i < months.length; i++) {
            const bill = state.bills[months[i]].find(b => b.platform === name && b.color);
            if (bill) return bill.color;
        }
        return '#86909C';
    }

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ---------- Toast & 确认弹窗 ----------

    let toastTimer = null;
    function showToast(msg, type) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = msg;
        toast.className = 'fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-white text-sm shadow-lg pointer-events-none toast-show';
        toast.classList.add(type === 'error' ? 'bg-danger/90'
            : type === 'warning' ? 'bg-warning/90'
            : 'bg-gray-800/90');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            toast.classList.remove('toast-show');
            toast.classList.add('toast-hide');
        }, 2000);
    }

    function showConfirm(title, msg, onOk) {
        const modal = document.getElementById('confirmModal');
        const content = modal.querySelector('.modal-content');
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMsg').textContent = msg;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        content.classList.remove('modal-leave');
        content.classList.add('modal-enter');

        const okBtn = document.getElementById('btnConfirmOk');
        const cancelBtn = document.getElementById('btnConfirmCancel');

        function close() {
            content.classList.remove('modal-enter');
            content.classList.add('modal-leave');
            setTimeout(function () {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }, 180);
        }
        function okHandler() {
            okBtn.removeEventListener('click', okHandler);
            cancelBtn.removeEventListener('click', cancelHandler);
            close();
            onOk && onOk();
        }
        function cancelHandler() {
            okBtn.removeEventListener('click', okHandler);
            cancelBtn.removeEventListener('click', cancelHandler);
            close();
        }
        okBtn.addEventListener('click', okHandler);
        cancelBtn.addEventListener('click', cancelHandler);
    }

    // ---------- 年月选择 ----------

    function renderYearMonthSelectors() {
        const yearSel = document.getElementById('yearSelect');
        const monthSel = document.getElementById('monthSelect');
        const now = new Date().getFullYear();
        let html = '';
        for (let y = now - 5; y <= now + 5; y++) {
            html += '<option value="' + y + '"' + (y === state.currentYear ? ' selected' : '') + '>' + y + ' 年</option>';
        }
        yearSel.innerHTML = html;

        let mhtml = '';
        for (let m = 1; m <= 12; m++) {
            mhtml += '<option value="' + m + '"' + (m === state.currentMonth ? ' selected' : '') + '>' + m + ' 月</option>';
        }
        monthSel.innerHTML = mhtml;
    }

    // ---------- 平台录入网格（紧凑单行卡片） ----------

    /**
     * 渲染当月录入网格：
     * 9 个预设平台始终显示；当月的自定义账单追加在后面
     * 仅在切换月份 / 增删自定义项目时整体重绘，输入过程中不重绘以免丢失焦点
     */
    function renderPlatformGrid() {
        const grid = document.getElementById('platformGrid');
        const bills = getMonthBills(state.currentYear, state.currentMonth);
        const findBill = function (name) { return bills.find(b => b.platform === name); };

        let html = '';
        DEFAULT_PLATFORMS.forEach(function (p) {
            html += buildCardHtml(p.name, p.color, p.icon, findBill(p.name), false);
        });
        bills.filter(b => b.custom).forEach(function (b) {
            html += buildCardHtml(b.platform, b.color || '#86909C', '🏷️', b, true);
        });
        grid.innerHTML = html;

        grid.querySelectorAll('.platform-card').forEach(updateCardState);
    }

    function buildCardHtml(platform, color, icon, bill, isCustom) {
        const amount = bill && Number(bill.amount) ? String(bill.amount) : '';

        let html = '<div class="platform-card flex items-center gap-2.5 bg-gray-card rounded-xl shadow-sm border border-gray-border px-3 py-2" '
            + 'data-platform="' + escapeHtml(platform) + '"' + (isCustom ? ' data-custom="1"' : '') + '>';

        // 图标
        html += '<span class="platform-icon flex-shrink-0" style="background-color:' + hexToRgba(color, 0.12) + ';">' + icon + '</span>';

        // 平台名称
        html += '<span class="text-sm font-medium text-gray-800 truncate">' + escapeHtml(platform) + '</span>';

        // 金额输入（单行唯一输入项）
        html += '<div class="ml-auto flex items-center gap-1 flex-shrink-0">';
        html += '<span class="text-sm text-gray-text">¥</span>';
        html += '<input type="number" inputmode="decimal" step="0.01" min="0" data-field="amount" value="' + amount + '" placeholder="0.00" '
            + 'class="money-input w-24 sm:w-28 bg-gray-bg border border-gray-border rounded-lg px-2 py-1.5 text-sm font-semibold text-right text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all">';

        if (isCustom) {
            html += '<button type="button" data-action="delete-custom" class="w-6 h-6 flex-shrink-0 rounded-lg text-gray-text hover:text-danger hover:bg-danger/10 transition-colors flex items-center justify-center" title="删除该项目">';
            html += '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
            html += '</button>';
        }
        html += '</div></div>';
        return html;
    }

    /** 根据输入值切换高亮（不重绘、不丢焦点） */
    function updateCardState(card) {
        const amount = parseFloat(card.querySelector('[data-field="amount"]').value) || 0;
        if (amount > 0) {
            card.classList.add('has-data');
        } else {
            card.classList.remove('has-data');
        }
    }

    function countFilled(bills) {
        return bills.filter(b => (Number(b.amount) || 0) > 0).length;
    }

    /**
     * 序列化整个录入网格并保存：
     * 有金额的卡片生成/更新账单记录，空的预设卡片删除记录，空的自定义项目保留
     */
    function saveGrid() {
        const grid = document.getElementById('platformGrid');
        const cards = grid.querySelectorAll('.platform-card');
        const oldBills = getMonthBills(state.currentYear, state.currentMonth);
        const newBills = [];

        cards.forEach(function (card) {
            const platform = card.dataset.platform;
            const isCustom = card.dataset.custom === '1';
            const amount = parseFloat(card.querySelector('[data-field="amount"]').value) || 0;
            const old = oldBills.find(b => b.platform === platform);

            if (amount === 0 && !isCustom) return;

            newBills.push({
                id: old ? old.id : genId(),
                platform: platform,
                amount: amount,
                custom: isCustom || (old && old.custom) || false,
                color: old ? (old.color || getPlatformColor(platform)) : getPlatformColor(platform),
                remark: old ? (old.remark || '') : ''
            });
        });

        setMonthBills(state.currentYear, state.currentMonth, newBills);
        renderStatsAndCharts();
    }

    function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(saveGrid, 400);
    }

    // ---------- 自定义项目 ----------

    function openCustomModal() {
        const modal = document.getElementById('customModal');
        const content = modal.querySelector('.modal-content');
        document.getElementById('customForm').reset();
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        content.classList.remove('modal-leave');
        content.classList.add('modal-enter');
        setTimeout(function () { document.getElementById('customName').focus(); }, 200);
    }

    function hideCustomModal() {
        const modal = document.getElementById('customModal');
        const content = modal.querySelector('.modal-content');
        content.classList.remove('modal-enter');
        content.classList.add('modal-leave');
        setTimeout(function () {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 180);
    }

    function addCustomItem(name) {
        name = name.trim();
        if (!name) {
            showToast('请输入项目名称', 'warning');
            return false;
        }
        if (DEFAULT_PLATFORMS.some(p => p.name === name)) {
            showToast('该平台已在预设列表中', 'warning');
            return false;
        }
        const bills = getMonthBills(state.currentYear, state.currentMonth);
        if (bills.some(b => b.platform === name)) {
            showToast('当月已存在同名项目', 'warning');
            return false;
        }

        const usedColors = DEFAULT_PLATFORMS.map(p => p.color)
            .concat(bills.filter(b => b.custom).map(b => b.color));
        const color = CHART_COLORS.find(c => usedColors.indexOf(c) === -1)
            || CHART_COLORS[bills.length % CHART_COLORS.length];

        bills.push({
            id: genId(),
            platform: name,
            amount: 0,
            custom: true,
            color: color
        });
        setMonthBills(state.currentYear, state.currentMonth, bills);
        renderPlatformGrid();
        renderStatsAndCharts();
        showToast('已添加「' + name + '」');
        return true;
    }

    function deleteCustomItem(platform) {
        const bills = getMonthBills(state.currentYear, state.currentMonth);
        const bill = bills.find(b => b.platform === platform && b.custom);
        if (!bill) return;
        const hasData = (Number(bill.amount) || 0) > 0;
        showConfirm(
            '删除自定义项目',
            '确定要删除当月的「' + platform + '」吗？' + (hasData ? '其中已填写的金额也会一并删除。' : ''),
            function () {
                setMonthBills(state.currentYear, state.currentMonth, bills.filter(b => b.id !== bill.id));
                renderPlatformGrid();
                renderStatsAndCharts();
                showToast('已删除');
            }
        );
    }

    // ---------- 清空当月 ----------

    function clearMonthBills() {
        const bills = getMonthBills(state.currentYear, state.currentMonth);
        if (bills.length === 0) {
            showToast('当月暂无数据', 'warning');
            return;
        }
        showConfirm(
            '清空当月数据',
            '确定要清空 ' + state.currentYear + ' 年 ' + state.currentMonth + ' 月的所有金额吗？自定义项目也会被删除，此操作不可撤销。',
            function () {
                setMonthBills(state.currentYear, state.currentMonth, []);
                renderPlatformGrid();
                renderStatsAndCharts();
                showToast('当月数据已清空');
            }
        );
    }

    // ---------- 统计 ----------

    function sumBills(bills) {
        let total = 0;
        bills.forEach(function (b) { total += Number(b.amount) || 0; });
        return total;
    }

    function collectYearBills(year) {
        const all = [];
        for (let m = 1; m <= 12; m++) {
            getMonthBills(year, m).forEach(b => all.push(b));
        }
        return all;
    }

    function renderMonthStats() {
        const bills = getMonthBills(state.currentYear, state.currentMonth);
        document.getElementById('monthTotal').textContent = fmtMoney(sumBills(bills));
        document.getElementById('monthCount').textContent = countFilled(bills) + ' 个';
        document.getElementById('monthPieLabel').textContent = state.currentMonth + ' 月';
    }

    function renderYearStats() {
        document.getElementById('yearLabel').textContent = state.currentYear;
        const total = sumBills(collectYearBills(state.currentYear));
        document.getElementById('yearTotal').textContent = fmtMoney(total);
        document.getElementById('yearAvg').textContent = fmtMoney(total / 12);
    }

    // ---------- 图表 ----------

    /** 聚合各平台还款金额，返回 {labels, data, colors} */
    function aggregatePlatforms(bills) {
        const map = {};
        bills.forEach(function (b) {
            const amount = Number(b.amount) || 0;
            if (amount <= 0) return;
            if (!map[b.platform]) map[b.platform] = 0;
            map[b.platform] += amount;
        });
        const labels = Object.keys(map);
        return {
            labels: labels,
            data: labels.map(l => map[l]),
            colors: labels.map(l => getPlatformColor(l))
        };
    }

    function renderDoughnut(chart, canvasId, agg) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return chart;

        let labels, data, colors, isEmpty = false;
        if (agg.labels.length === 0) {
            isEmpty = true;
            labels = ['暂无数据'];
            data = [1];
            colors = ['#E5E6EB'];
        } else {
            labels = agg.labels;
            data = agg.data;
            colors = agg.colors;
        }

        const legendPos = window.innerWidth < 640 ? 'bottom' : 'right';

        if (chart) {
            chart.data.labels = labels;
            chart.data.datasets[0].data = data;
            chart.data.datasets[0].backgroundColor = colors;
            chart.options.plugins.legend.position = legendPos;
            chart.options.plugins.tooltip.enabled = !isEmpty;
            chart.update();
            return chart;
        }

        return new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors,
                    borderWidth: 2,
                    borderColor: '#ffffff',
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: legendPos,
                        labels: { boxWidth: 12, padding: 10, font: { size: 11 } }
                    },
                    tooltip: {
                        enabled: !isEmpty,
                        callbacks: {
                            label: function (c) {
                                const total = c.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? (c.raw / total * 100).toFixed(1) : '0.0';
                                return ' ' + c.label + '：¥' + Number(c.raw).toFixed(2) + ' (' + pct + '%)';
                            }
                        }
                    }
                },
                cutout: '58%'
            }
        });
    }

    function renderMonthPie() {
        const agg = aggregatePlatforms(getMonthBills(state.currentYear, state.currentMonth));
        monthPieChart = renderDoughnut(monthPieChart, 'monthPieChart', agg);
    }

    function renderYearPie() {
        const agg = aggregatePlatforms(collectYearBills(state.currentYear));
        yearPieChart = renderDoughnut(yearPieChart, 'yearPieChart', agg);
    }

    function renderTrendChart() {
        const ctx = document.getElementById('trendChart');
        if (!ctx) return;

        const labels = [];
        const data = [];
        for (let m = 1; m <= 12; m++) {
            labels.push(m + '月');
            data.push(sumBills(getMonthBills(state.currentYear, m)));
        }

        if (trendChart) {
            trendChart.data.labels = labels;
            trendChart.data.datasets[0].data = data;
            trendChart.update();
            return;
        }

        trendChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: '还款金额',
                    data: data,
                    backgroundColor: 'rgba(22, 93, 255, 0.7)',
                    borderRadius: 4,
                    barPercentage: 0.6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (c) {
                                return ' 还款：¥' + Number(c.raw).toFixed(2);
                            }
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.05)' },
                        ticks: {
                            font: { size: 10 },
                            callback: function (v) { return '¥' + v; }
                        }
                    }
                }
            }
        });
    }

    function renderStatsAndCharts() {
        renderMonthStats();
        renderYearStats();
        renderMonthPie();
        renderYearPie();
        renderTrendChart();
    }

    function hexToRgba(hex, alpha) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) return 'rgba(134,144,156,' + alpha + ')';
        return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + alpha + ')';
    }

    // ---------- 导入 / 导出 ----------

    function exportJSON() {
        const data = {
            version: 2,
            exportedAt: new Date().toISOString(),
            bills: state.bills,
            customPlatforms: state.customPlatforms
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '还款账单_' + state.currentYear + '年备份_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('已导出备份文件');
    }

    function importJSON(file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.bills || typeof data.bills !== 'object') {
                    throw new Error('文件格式无效');
                }
                showConfirm(
                    '导入备份',
                    '导入将合并到现有数据中，相同月份的账单会追加（不会覆盖）。确定导入吗？',
                    function () {
                        Object.keys(data.bills).forEach(function (key) {
                            if (!state.bills[key]) state.bills[key] = [];
                            const existingIds = new Set(state.bills[key].map(b => b.id));
                            data.bills[key].forEach(function (b) {
                                const nb = {
                                    id: genId(),
                                    platform: b.platform,
                                    amount: Number(b.paid) > 0 ? Number(b.paid) : (Number(b.amount) || 0),
                                    custom: !!b.custom,
                                    color: b.color,
                                    remark: b.remark || ''
                                };
                                if (!existingIds.has(b.id)) {
                                    nb.id = b.id;
                                    existingIds.add(b.id);
                                }
                                state.bills[key].push(nb);
                            });
                        });
                        if (Array.isArray(data.customPlatforms)) {
                            data.customPlatforms.forEach(function (p) {
                                if (!state.customPlatforms.find(cp => cp.name === p.name)) {
                                    state.customPlatforms.push(p);
                                }
                            });
                        }
                        saveStorage();
                        renderPlatformGrid();
                        renderStatsAndCharts();
                        showToast('导入成功');
                    }
                );
            } catch (err) {
                showToast('导入失败：' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    }

    // ---------- 事件绑定 ----------

    function bindEvents() {
        document.getElementById('yearSelect').addEventListener('change', function (e) {
            state.currentYear = parseInt(e.target.value, 10);
            renderPlatformGrid();
            renderStatsAndCharts();
        });
        document.getElementById('monthSelect').addEventListener('change', function (e) {
            state.currentMonth = parseInt(e.target.value, 10);
            renderPlatformGrid();
            renderStatsAndCharts();
        });

        const grid = document.getElementById('platformGrid');

        // 文本输入：即时高亮 + 防抖保存
        grid.addEventListener('input', function (e) {
            const field = e.target.dataset && e.target.dataset.field;
            if (!field) return;
            const card = e.target.closest('.platform-card');
            if (card) updateCardState(card);
            scheduleSave();
        });

        // 失焦：立即保存
        grid.addEventListener('change', function (e) {
            const field = e.target.dataset && e.target.dataset.field;
            if (!field) return;
            const card = e.target.closest('.platform-card');
            if (card) updateCardState(card);
            if (saveTimer) clearTimeout(saveTimer);
            saveGrid();
        });

        // 删除自定义项目
        grid.addEventListener('click', function (e) {
            const btn = e.target.closest('[data-action="delete-custom"]');
            if (!btn) return;
            const card = btn.closest('.platform-card');
            if (card) deleteCustomItem(card.dataset.platform);
        });

        // 添加自定义项目：虚线按钮 + 悬浮 + 按钮
        document.getElementById('btnAddCustom').addEventListener('click', openCustomModal);
        document.getElementById('btnAdd').addEventListener('click', openCustomModal);
        document.getElementById('btnCustomCancel').addEventListener('click', hideCustomModal);
        document.getElementById('customModal').addEventListener('click', function (e) {
            if (e.target.id === 'customModal') hideCustomModal();
        });
        document.getElementById('customForm').addEventListener('submit', function (e) {
            e.preventDefault();
            const nameInput = document.getElementById('customName');
            if (addCustomItem(nameInput.value)) {
                hideCustomModal();
            } else {
                nameInput.focus();
            }
        });

        document.getElementById('btnClearMonth').addEventListener('click', clearMonthBills);

        document.getElementById('btnExport').addEventListener('click', exportJSON);
        document.getElementById('btnImport').addEventListener('click', function () {
            document.getElementById('fileImport').click();
        });
        document.getElementById('fileImport').addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (file) importJSON(file);
            e.target.value = '';
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (!document.getElementById('customModal').classList.contains('hidden')) {
                    hideCustomModal();
                } else if (!document.getElementById('confirmModal').classList.contains('hidden')) {
                    document.getElementById('btnConfirmCancel').click();
                }
            }
        });
    }

    // ---------- 初始化 ----------

    function init() {
        loadStorage();
        renderYearMonthSelectors();
        bindEvents();
        renderPlatformGrid();
        renderStatsAndCharts();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
