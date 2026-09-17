/* ============================================
 * 还款账单工作台 - 核心逻辑
 * 数据存储：LocalStorage
 * 架构：原生 JavaScript，无框架
 * 交互：9 个预设平台内联录入 + 自定义项目
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
        bills: {}, // 结构：{ '2026-09': [ {id, platform, amount, paid, dueDate, remark, custom, color}, ... ] }
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
                return true;
            }
        } catch (e) {
            console.warn('读取本地数据失败:', e);
        }
        return false;
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
        // 在所有月份的自定义账单中查找该项目的颜色
        const months = Object.keys(state.bills);
        for (let i = 0; i < months.length; i++) {
            const bill = state.bills[months[i]].find(b => b.platform === name && b.color);
            if (bill) return bill.color;
        }
        return '#86909C';
    }

    function getPlatformIcon(name) {
        const p = DEFAULT_PLATFORMS.find(p => p.name === name);
        return p ? p.icon : '🏷️';
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

    // ---------- 平台录入网格 ----------

    /**
     * 渲染当月录入网格：
     * 9 个预设平台始终显示；当月的自定义账单追加在后面
     * 注意：仅在切换月份 / 增删自定义项目时整体重绘，输入过程中不重绘以免丢失焦点
     */
    function renderPlatformGrid() {
        const grid = document.getElementById('platformGrid');
        const bills = getMonthBills(state.currentYear, state.currentMonth);
        const findBill = function (name) { return bills.find(b => b.platform === name); };

        let html = '';

        // 预设 9 个平台
        DEFAULT_PLATFORMS.forEach(function (p) {
            html += buildCardHtml(p.name, p.color, p.icon, findBill(p.name), false);
        });

        // 当月自定义项目（按添加顺序）
        bills.filter(b => b.custom).forEach(function (b) {
            html += buildCardHtml(b.platform, b.color || '#86909C', '🏷️', b, true);
        });

        grid.innerHTML = html;

        // 绑定每张卡片的实时状态更新（待还金额 / 高亮）
        grid.querySelectorAll('.platform-card').forEach(updateCardState);

        document.getElementById('billCount').textContent = '已填 ' + countFilled(bills) + ' 项';
    }

    function buildCardHtml(platform, color, icon, bill, isCustom) {
        const amount = bill && Number(bill.amount) ? String(bill.amount) : '';
        const paid = bill && Number(bill.paid) ? String(bill.paid) : '';
        const dueDate = bill && bill.dueDate ? bill.dueDate : '';

        let html = '<div class="platform-card bg-gray-card rounded-2xl shadow-sm border border-gray-border p-3.5" '
            + 'data-platform="' + escapeHtml(platform) + '"' + (isCustom ? ' data-custom="1"' : '') + '>';

        // 标题行：图标 + 名称 +（自定义删除按钮）+ 待还
        html += '<div class="flex items-center gap-2 mb-3">';
        html += '<span class="platform-icon flex-shrink-0" style="background-color:' + hexToRgba(color, 0.12) + ';">' + icon + '</span>';
        html += '<span class="text-sm font-semibold text-gray-800 truncate">' + escapeHtml(platform) + '</span>';
        if (isCustom) {
            html += '<button type="button" data-action="delete-custom" class="ml-auto flex-shrink-0 w-6 h-6 rounded-lg text-gray-text hover:text-danger hover:bg-danger/10 transition-colors flex items-center justify-center" title="删除该项目">';
            html += '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
            html += '</button>';
        } else {
            html += '<span class="ml-auto flex-shrink-0"></span>';
        }
        html += '</div>';

        // 待还金额行
        html += '<p class="text-xs text-gray-text mb-2">待还 <span class="unpaid-label text-sm font-bold text-warning" data-role="unpaid">¥0.00</span></p>';

        // 金额输入：账单 / 已还
        html += '<div class="grid grid-cols-2 gap-2 mb-2">';
        html += '<div>';
        html += '<label class="text-[11px] text-gray-text block mb-1">账单金额(元)</label>';
        html += '<input type="number" inputmode="decimal" step="0.01" min="0" data-field="amount" value="' + amount + '" placeholder="0.00" class="money-input w-full bg-gray-bg border border-gray-border rounded-lg px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all">';
        html += '</div>';
        html += '<div>';
        html += '<label class="text-[11px] text-gray-text block mb-1">已还(元)</label>';
        html += '<input type="number" inputmode="decimal" step="0.01" min="0" data-field="paid" value="' + paid + '" placeholder="0.00" class="money-input w-full bg-gray-bg border border-gray-border rounded-lg px-2.5 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-success/30 focus:border-success transition-all">';
        html += '</div>';
        html += '</div>';

        // 还款日
        html += '<label class="text-[11px] text-gray-text block mb-1">还款日</label>';
        html += '<input type="date" data-field="dueDate" value="' + dueDate + '" class="date-input w-full bg-gray-bg border border-gray-border rounded-lg px-2.5 py-1.5 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all">';

        html += '</div>';
        return html;
    }

    /** 根据卡片内输入值刷新待还金额与高亮状态（不重绘、不丢焦点） */
    function updateCardState(card) {
        const amount = parseFloat(card.querySelector('[data-field="amount"]').value) || 0;
        const paid = parseFloat(card.querySelector('[data-field="paid"]').value) || 0;
        const dueDate = card.querySelector('[data-field="dueDate"]').value;
        const unpaid = Math.max(0, amount - paid);

        const label = card.querySelector('[data-role="unpaid"]');
        label.textContent = fmtMoney(unpaid);
        label.className = 'unpaid-label text-sm font-bold ' + (unpaid > 0 ? 'text-warning' : (amount > 0 ? 'text-success' : 'text-gray-text'));

        if (amount > 0 || paid > 0 || dueDate) {
            card.classList.add('has-data');
        } else {
            card.classList.remove('has-data');
        }
    }

    function countFilled(bills) {
        return bills.filter(b => (Number(b.amount) || 0) > 0 || (Number(b.paid) || 0) > 0 || b.dueDate).length;
    }

    /**
     * 序列化整个录入网格并保存：
     * 有金额或日期的卡片生成/更新账单记录，全空的卡片删除记录
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
            const paid = parseFloat(card.querySelector('[data-field="paid"]').value) || 0;
            const dueDate = card.querySelector('[data-field="dueDate"]').value || '';
            const old = oldBills.find(b => b.platform === platform);

            // 全空：预设平台不保留记录；自定义项目保留空壳（否则卡片会消失）
            if (amount === 0 && paid === 0 && !dueDate && !isCustom) return;

            newBills.push({
                id: old ? old.id : genId(),
                platform: platform,
                amount: amount,
                paid: paid,
                dueDate: dueDate,
                remark: old ? (old.remark || '') : '',
                custom: isCustom || (old && old.custom) || false,
                color: old ? (old.color || getPlatformColor(platform)) : getPlatformColor(platform)
            });
        });

        setMonthBills(state.currentYear, state.currentMonth, newBills);

        document.getElementById('billCount').textContent = '已填 ' + countFilled(newBills) + ' 项';
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

        // 自动分配颜色：避开预设已用色
        const usedColors = DEFAULT_PLATFORMS.map(p => p.color)
            .concat(bills.filter(b => b.custom).map(b => b.color));
        let color = CHART_COLORS.find(c => usedColors.indexOf(c) === -1) || CHART_COLORS[bills.length % CHART_COLORS.length];

        bills.push({
            id: genId(),
            platform: name,
            amount: 0,
            paid: 0,
            dueDate: '',
            remark: '',
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
        const hasData = (Number(bill.amount) || 0) > 0 || (Number(bill.paid) || 0) > 0 || bill.dueDate;
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
        let total = 0, paid = 0;
        bills.forEach(function (b) {
            total += Number(b.amount) || 0;
            paid += Number(b.paid) || 0;
        });
        return { total: total, paid: paid, unpaid: Math.max(0, total - paid) };
    }

    function renderMonthStats() {
        const s = sumBills(getMonthBills(state.currentYear, state.currentMonth));
        document.getElementById('monthTotal').textContent = fmtMoney(s.total);
        document.getElementById('monthPaid').textContent = fmtMoney(s.paid);
        document.getElementById('monthUnpaid').textContent = fmtMoney(s.unpaid);
        document.getElementById('monthPieLabel').textContent = state.currentMonth + ' 月';
    }

    function renderYearStats() {
        document.getElementById('yearLabel').textContent = state.currentYear;
        const all = [];
        for (let m = 1; m <= 12; m++) {
            getMonthBills(state.currentYear, m).forEach(b => all.push(b));
        }
        const s = sumBills(all);
        document.getElementById('yearTotal').textContent = fmtMoney(s.total);
        document.getElementById('yearPaid').textContent = fmtMoney(s.paid);
        document.getElementById('yearUnpaid').textContent = fmtMoney(s.unpaid);
    }

    // ---------- 图表 ----------

    /** 聚合各平台账单金额，返回 {labels, data, colors} */
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
        const all = [];
        for (let m = 1; m <= 12; m++) {
            getMonthBills(state.currentYear, m).forEach(b => all.push(b));
        }
        const agg = aggregatePlatforms(all);
        yearPieChart = renderDoughnut(yearPieChart, 'yearPieChart', agg);
    }

    function renderTrendChart() {
        const ctx = document.getElementById('trendChart');
        if (!ctx) return;

        const labels = [];
        const totalData = [];
        const paidData = [];
        for (let m = 1; m <= 12; m++) {
            labels.push(m + '月');
            const s = sumBills(getMonthBills(state.currentYear, m));
            totalData.push(s.total);
            paidData.push(s.paid);
        }

        if (trendChart) {
            trendChart.data.labels = labels;
            trendChart.data.datasets[0].data = totalData;
            trendChart.data.datasets[1].data = paidData;
            trendChart.update();
            return;
        }

        trendChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '总账单',
                        data: totalData,
                        backgroundColor: 'rgba(22, 93, 255, 0.7)',
                        borderRadius: 4,
                        barPercentage: 0.6
                    },
                    {
                        label: '已还',
                        data: paidData,
                        backgroundColor: 'rgba(0, 180, 42, 0.7)',
                        borderRadius: 4,
                        barPercentage: 0.6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'end',
                        labels: { boxWidth: 12, padding: 8, font: { size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (c) {
                                return ' ' + c.dataset.label + '：¥' + Number(c.raw).toFixed(2);
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
            version: 1,
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
                                const nb = Object.assign({
                                    amount: 0, paid: 0, dueDate: '', remark: '', custom: false
                                }, b, { id: genId() });
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
        // 年份 / 月份切换：整体重绘
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

        // 录入网格：事件委托
        const grid = document.getElementById('platformGrid');

        // 文本输入：即时更新本卡待还金额 + 防抖保存
        grid.addEventListener('input', function (e) {
            const field = e.target.dataset && e.target.dataset.field;
            if (!field) return;
            const card = e.target.closest('.platform-card');
            if (card) updateCardState(card);
            scheduleSave();
        });

        // 日期选择 / 失焦：立即保存
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

        // 清空当月
        document.getElementById('btnClearMonth').addEventListener('click', clearMonthBills);

        // 导入导出
        document.getElementById('btnExport').addEventListener('click', exportJSON);
        document.getElementById('btnImport').addEventListener('click', function () {
            document.getElementById('fileImport').click();
        });
        document.getElementById('fileImport').addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (file) importJSON(file);
            e.target.value = '';
        });

        // ESC 关闭弹窗
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
