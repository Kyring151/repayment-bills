/* ============================================
 * 还款账单工作台 - 核心逻辑
 * 数据存储：LocalStorage
 * 架构：原生 JavaScript，无框架
 * ============================================ */

(function () {
    'use strict';

    // ---------- 常量配置 ----------
    const STORAGE_KEY = 'repayment_bills_v1';

    // 固定平台列表（9 个，含颜色标识）
    const DEFAULT_PLATFORMS = [
        { name: '微信分付', color: '#07C160' },
        { name: '信用卡',   color: '#165DFF' },
        { name: '车贷',     color: '#722ED1' },
        { name: '保险',     color: '#F53F3F' },
        { name: '花呗',     color: '#FF7D00' },
        { name: '拿去花',   color: '#FF9A2E' },
        { name: '白条',     color: '#EAB308' },
        { name: '美团月付', color: '#FFD100' },
        { name: '抖音月付', color: '#000000' }
    ];

    // Chart.js 配色（饼图/趋势图用）
    const CHART_COLORS = [
        '#165DFF', '#00B42A', '#FF7D00', '#F53F3F', '#722ED1',
        '#0FC6C2', '#FF9A2E', '#86909C', '#14C9C9', '#F7BA1E'
    ];

    // ---------- 状态 ----------
    let state = {
        currentYear: new Date().getFullYear(),
        currentMonth: new Date().getMonth() + 1, // 1-12
        bills: {}, // 结构：{ '2026-09': [ {id, platform, amount, paid, dueDate, remark}, ... ] }
        customPlatforms: [] // 用户自定义平台
    };

    let platformChart = null;
    let trendChart = null;

    // ---------- 工具函数 ----------

    /** 生成唯一 ID */
    function genId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    /** 格式化金额为 ¥xxx.xx */
    function fmtMoney(num) {
        const n = Number(num) || 0;
        return '¥' + n.toFixed(2);
    }

    /** 获取月份 key，如 '2026-09' */
    function monthKey(year, month) {
        return `${year}-${String(month).padStart(2, '0')}`;
    }

    /** 获取当月账单列表 */
    function getMonthBills(year, month) {
        const key = monthKey(year, month);
        return state.bills[key] || [];
    }

    /** 保存当月账单 */
    function setMonthBills(year, month, bills) {
        const key = monthKey(year, month);
        if (bills.length === 0) {
            delete state.bills[key];
        } else {
            state.bills[key] = bills;
        }
        saveStorage();
    }

    /** 读取 LocalStorage */
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

    /** 写入 LocalStorage */
    function saveStorage() {
        try {
            const data = {
                bills: state.bills,
                customPlatforms: state.customPlatforms,
                updatedAt: new Date().toISOString()
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('保存数据失败:', e);
            showToast('保存失败，存储空间可能已满', 'error');
        }
    }

    /** 获取所有平台（默认 + 自定义） */
    function getAllPlatforms() {
        return [...DEFAULT_PLATFORMS, ...state.customPlatforms];
    }

    /** 根据平台名获取颜色 */
    function getPlatformColor(name) {
        const p = getAllPlatforms().find(p => p.name === name);
        return p ? p.color : '#86909C';
    }

    /** 计算账单的状态标签 */
    function getBillStatus(bill) {
        const amount = Number(bill.amount) || 0;
        const paid = Number(bill.paid) || 0;
        if (paid <= 0) return { text: '待还', class: 'tag-unpaid' };
        if (paid >= amount) return { text: '已还清', class: 'tag-paid' };
        return { text: '部分还款', class: 'tag-partial' };
    }

    /** 显示 Toast */
    let toastTimer = null;
    function showToast(msg, type = 'success') {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = msg;
        toast.className = 'fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-white text-sm shadow-lg transition-all pointer-events-none toast-show';
        if (type === 'error') {
            toast.classList.add('bg-danger/90');
        } else if (type === 'warning') {
            toast.classList.add('bg-warning/90');
        } else {
            toast.classList.add('bg-gray-800/90');
        }
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.classList.remove('toast-show');
            toast.classList.add('toast-hide');
            setTimeout(() => {
                toast.classList.remove('toast-hide');
                toast.style.opacity = '0';
            }, 300);
        }, 2000);
    }

    /** 确认弹窗 */
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

        const close = () => {
            content.classList.remove('modal-enter');
            content.classList.add('modal-leave');
            setTimeout(() => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }, 180);
        };

        const okHandler = () => {
            okBtn.removeEventListener('click', okHandler);
            cancelBtn.removeEventListener('click', cancelHandler);
            close();
            onOk && onOk();
        };
        const cancelHandler = () => {
            okBtn.removeEventListener('click', okHandler);
            cancelBtn.removeEventListener('click', cancelHandler);
            close();
        };

        okBtn.addEventListener('click', okHandler);
        cancelBtn.addEventListener('click', cancelHandler);
    }

    // ---------- 渲染：年月选择 ----------

    function renderYearMonthSelectors() {
        const yearSel = document.getElementById('yearSelect');
        const monthSel = document.getElementById('monthSelect');

        // 年份：前后 5 年
        const now = new Date().getFullYear();
        let html = '';
        for (let y = now - 5; y <= now + 5; y++) {
            html += `<option value="${y}" ${y === state.currentYear ? 'selected' : ''}>${y} 年</option>`;
        }
        yearSel.innerHTML = html;

        // 月份
        let mhtml = '';
        for (let m = 1; m <= 12; m++) {
            mhtml += `<option value="${m}" ${m === state.currentMonth ? 'selected' : ''}>${m} 月</option>`;
        }
        monthSel.innerHTML = mhtml;
    }

    // ---------- 渲染：月度账单列表 ----------

    function renderBillList() {
        const list = document.getElementById('billList');
        const empty = document.getElementById('emptyState');
        const bills = getMonthBills(state.currentYear, state.currentMonth);

        document.getElementById('billCount').textContent = `共 ${bills.length} 项`;

        if (bills.length === 0) {
            list.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        // 按还款日排序（有日期的在前，无日期在后）
        const sorted = [...bills].sort((a, b) => {
            if (!a.dueDate && !b.dueDate) return 0;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return a.dueDate.localeCompare(b.dueDate);
        });

        let html = '';
        sorted.forEach(bill => {
            const amount = Number(bill.amount) || 0;
            const paid = Number(bill.paid) || 0;
            const unpaid = Math.max(0, amount - paid);
            const progress = amount > 0 ? Math.min(100, (paid / amount) * 100) : 0;
            const status = getBillStatus(bill);
            const color = getPlatformColor(bill.platform);

            html += `
            <div class="bill-card bg-gray-card rounded-2xl shadow-sm border border-gray-border overflow-hidden flex">
                <div class="platform-bar" style="background-color: ${color};"></div>
                <div class="flex-1 p-4">
                    <div class="flex items-start justify-between gap-2 mb-2">
                        <div class="flex items-center gap-2 min-w-0">
                            <span class="text-base font-semibold text-gray-800 truncate">${escapeHtml(bill.platform)}</span>
                            <span class="tag ${status.class}">${status.text}</span>
                        </div>
                        <div class="bill-actions flex-shrink-0">
                            <button data-action="edit" data-id="${bill.id}" class="p-1.5 rounded-lg text-gray-text hover:text-primary hover:bg-primary/10 transition-colors" title="编辑">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                                </svg>
                            </button>
                            <button data-action="delete" data-id="${bill.id}" class="p-1.5 rounded-lg text-gray-text hover:text-danger hover:bg-danger/10 transition-colors" title="删除">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="grid grid-cols-3 gap-2 mb-3">
                        <div>
                            <p class="text-xs text-gray-text mb-0.5">账单金额</p>
                            <p class="text-sm font-semibold text-gray-800">${fmtMoney(amount)}</p>
                        </div>
                        <div>
                            <p class="text-xs text-gray-text mb-0.5">已还</p>
                            <p class="text-sm font-semibold text-success">${fmtMoney(paid)}</p>
                        </div>
                        <div>
                            <p class="text-xs text-gray-text mb-0.5">待还</p>
                            <p class="text-sm font-semibold text-warning">${fmtMoney(unpaid)}</p>
                        </div>
                    </div>
                    <div class="mb-2">
                        <div class="flex justify-between text-xs text-gray-text mb-1">
                            <span>还款进度</span>
                            <span>${progress.toFixed(1)}%</span>
                        </div>
                        <div class="h-1.5 bg-gray-border rounded-full overflow-hidden">
                            <div class="progress-bar h-full rounded-full ${paid >= amount ? 'bg-success' : 'bg-primary'}" style="width: ${progress}%;"></div>
                        </div>
                    </div>
                    <div class="flex items-center justify-between text-xs text-gray-text">
                        <span>${bill.dueDate ? '还款日：' + bill.dueDate : '未设置还款日'}</span>
                        ${bill.remark ? `<span class="truncate ml-2" title="${escapeHtml(bill.remark)}">📝 ${escapeHtml(bill.remark)}</span>` : ''}
                    </div>
                </div>
            </div>`;
        });
        list.innerHTML = html;

        // 绑定操作按钮
        list.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', handleBillAction);
        });
    }

    /** 处理账单卡片上的操作 */
    function handleBillAction(e) {
        const btn = e.currentTarget;
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === 'edit') {
            openEditModal(id);
        } else if (action === 'delete') {
            deleteBill(id);
        }
    }

    // ---------- 渲染：月度统计 ----------

    function renderMonthStats() {
        const bills = getMonthBills(state.currentYear, state.currentMonth);
        let total = 0, paid = 0;
        bills.forEach(b => {
            total += Number(b.amount) || 0;
            paid += Number(b.paid) || 0;
        });
        const unpaid = Math.max(0, total - paid);
        document.getElementById('monthTotal').textContent = fmtMoney(total);
        document.getElementById('monthPaid').textContent = fmtMoney(paid);
        document.getElementById('monthUnpaid').textContent = fmtMoney(unpaid);
    }

    // ---------- 渲染：年度统计 ----------

    function renderYearStats() {
        document.getElementById('yearLabel').textContent = state.currentYear;

        let total = 0, paid = 0;
        for (let m = 1; m <= 12; m++) {
            const bills = getMonthBills(state.currentYear, m);
            bills.forEach(b => {
                total += Number(b.amount) || 0;
                paid += Number(b.paid) || 0;
            });
        }
        const unpaid = Math.max(0, total - paid);
        document.getElementById('yearTotal').textContent = fmtMoney(total);
        document.getElementById('yearPaid').textContent = fmtMoney(paid);
        document.getElementById('yearUnpaid').textContent = fmtMoney(unpaid);
    }

    // ---------- 渲染：图表 ----------

    function renderCharts() {
        renderPlatformChart();
        renderTrendChart();
    }

    /** 各平台年度占比（饼图） */
    function renderPlatformChart() {
        const ctx = document.getElementById('platformChart');
        if (!ctx) return;

        // 聚合全年各平台总金额
        const platformMap = {};
        for (let m = 1; m <= 12; m++) {
            const bills = getMonthBills(state.currentYear, m);
            bills.forEach(b => {
                if (!platformMap[b.platform]) platformMap[b.platform] = 0;
                platformMap[b.platform] += Number(b.amount) || 0;
            });
        }

        const labels = Object.keys(platformMap);
        const data = labels.map(l => platformMap[l]);
        const colors = labels.map((l, i) => {
            const c = getPlatformColor(l);
            return c || CHART_COLORS[i % CHART_COLORS.length];
        });

        if (platformChart) {
            platformChart.data.labels = labels;
            platformChart.data.datasets[0].data = data;
            platformChart.data.datasets[0].backgroundColor = colors;
            platformChart.update();
            return;
        }

        platformChart = new Chart(ctx, {
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
                        position: 'right',
                        labels: {
                            boxWidth: 12,
                            padding: 8,
                            font: { size: 11 }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(ctx) {
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                                return ` ${ctx.label}: ¥${ctx.raw.toFixed(2)} (${pct}%)`;
                            }
                        }
                    }
                },
                cutout: '60%'
            }
        });
    }

    /** 每月还款趋势（柱状图） */
    function renderTrendChart() {
        const ctx = document.getElementById('trendChart');
        if (!ctx) return;

        const labels = [];
        const totalData = [];
        const paidData = [];

        for (let m = 1; m <= 12; m++) {
            labels.push(`${m}月`);
            const bills = getMonthBills(state.currentYear, m);
            let total = 0, paid = 0;
            bills.forEach(b => {
                total += Number(b.amount) || 0;
                paid += Number(b.paid) || 0;
            });
            totalData.push(total);
            paidData.push(paid);
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
                        labels: {
                            boxWidth: 12,
                            padding: 8,
                            font: { size: 11 }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(ctx) {
                                return ` ${ctx.dataset.label}: ¥${ctx.raw.toFixed(2)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 10 } }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.05)' },
                        ticks: {
                            font: { size: 10 },
                            callback: function(v) { return '¥' + v; }
                        }
                    }
                }
            }
        });
    }

    // ---------- 弹窗：新增/编辑 ----------

    function openAddModal() {
        document.getElementById('modalTitle').textContent = '新增还款账单';
        document.getElementById('billForm').reset();
        document.getElementById('billId').value = '';
        document.getElementById('paidAmount').value = '0';

        // 填充平台下拉
        renderPlatformSelect('');

        // 默认还款日设为当月 10 号（可改）
        const defaultDate = `${state.currentYear}-${String(state.currentMonth).padStart(2, '0')}-10`;
        document.getElementById('dueDate').value = defaultDate;

        toggleCustomPlatform();
        showBillModal();
    }

    function openEditModal(id) {
        const bills = getMonthBills(state.currentYear, state.currentMonth);
        const bill = bills.find(b => b.id === id);
        if (!bill) return;

        document.getElementById('modalTitle').textContent = '编辑还款账单';
        document.getElementById('billId').value = bill.id;
        document.getElementById('billAmount').value = bill.amount;
        document.getElementById('paidAmount').value = bill.paid;
        document.getElementById('dueDate').value = bill.dueDate || '';
        document.getElementById('billRemark').value = bill.remark || '';

        renderPlatformSelect(bill.platform);
        toggleCustomPlatform();
        showBillModal();
    }

    /** 渲染平台下拉（包含自定义平台 + "其他"） */
    function renderPlatformSelect(selectedName) {
        const sel = document.getElementById('platformSelect');
        const platforms = getAllPlatforms();
        let html = '';
        platforms.forEach(p => {
            html += `<option value="${escapeAttr(p.name)}" ${p.name === selectedName ? 'selected' : ''}>${escapeHtml(p.name)}</option>`;
        });
        // 如果选中的平台不在列表中（可能之前自定义后又被删除了），也加进去
        if (selectedName && !platforms.find(p => p.name === selectedName)) {
            html += `<option value="${escapeAttr(selectedName)}" selected>${escapeHtml(selectedName)}</option>`;
        }
        html += `<option value="__other__">+ 自定义平台</option>`;
        sel.innerHTML = html;
    }

    function toggleCustomPlatform() {
        const sel = document.getElementById('platformSelect');
        const wrap = document.getElementById('customPlatformWrap');
        if (sel.value === '__other__') {
            wrap.classList.remove('hidden');
        } else {
            wrap.classList.add('hidden');
        }
    }

    function showBillModal() {
        const modal = document.getElementById('billModal');
        const content = modal.querySelector('.modal-content');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        content.classList.remove('modal-leave');
        content.classList.add('modal-enter');
        // 聚焦第一个输入框
        setTimeout(() => document.getElementById('platformSelect').focus(), 200);
    }

    function hideBillModal() {
        const modal = document.getElementById('billModal');
        const content = modal.querySelector('.modal-content');
        content.classList.remove('modal-enter');
        content.classList.add('modal-leave');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 180);
    }

    /** 提交表单 */
    function handleFormSubmit(e) {
        e.preventDefault();

        let platform = document.getElementById('platformSelect').value;
        const customPlatform = document.getElementById('customPlatform').value.trim();
        const amountStr = document.getElementById('billAmount').value;
        const paidStr = document.getElementById('paidAmount').value;
        const dueDate = document.getElementById('dueDate').value;
        const remark = document.getElementById('billRemark').value.trim();
        const editId = document.getElementById('billId').value;

        // 校验
        if (platform === '__other__') {
            if (!customPlatform) {
                showToast('请输入自定义平台名称', 'warning');
                document.getElementById('customPlatform').focus();
                return;
            }
            platform = customPlatform;
            // 若该平台不存在，加入自定义列表
            if (!getAllPlatforms().find(p => p.name === platform)) {
                state.customPlatforms.push({
                    name: platform,
                    color: CHART_COLORS[state.customPlatforms.length % CHART_COLORS.length]
                });
                saveStorage();
            }
        }

        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount < 0) {
            showToast('请输入有效的账单金额', 'warning');
            return;
        }

        const paid = parseFloat(paidStr) || 0;
        if (paid < 0) {
            showToast('已还金额不能为负数', 'warning');
            return;
        }

        const bills = getMonthBills(state.currentYear, state.currentMonth);

        if (editId) {
            // 编辑
            const idx = bills.findIndex(b => b.id === editId);
            if (idx > -1) {
                bills[idx] = {
                    ...bills[idx],
                    platform,
                    amount,
                    paid,
                    dueDate,
                    remark
                };
            }
            showToast('账单已更新');
        } else {
            // 新增
            bills.push({
                id: genId(),
                platform,
                amount,
                paid,
                dueDate,
                remark
            });
            showToast('账单已添加');
        }

        setMonthBills(state.currentYear, state.currentMonth, bills);
        hideBillModal();
        refreshAll();
    }

    /** 删除账单 */
    function deleteBill(id) {
        const bills = getMonthBills(state.currentYear, state.currentMonth);
        const bill = bills.find(b => b.id === id);
        if (!bill) return;

        showConfirm('确认删除', `确定要删除「${bill.platform}」的这条账单吗？`, () => {
            const newBills = bills.filter(b => b.id !== id);
            setMonthBills(state.currentYear, state.currentMonth, newBills);
            showToast('已删除');
            refreshAll();
        });
    }

    /** 清空当月数据 */
    function clearMonthBills() {
        const bills = getMonthBills(state.currentYear, state.currentMonth);
        if (bills.length === 0) {
            showToast('当月暂无账单', 'warning');
            return;
        }
        showConfirm(
            '清空当月数据',
            `确定要清空 ${state.currentYear} 年 ${state.currentMonth} 月的所有账单吗？此操作不可撤销。`,
            () => {
                setMonthBills(state.currentYear, state.currentMonth, []);
                showToast('当月数据已清空');
                refreshAll();
            }
        );
    }

    // ---------- 导入导出 ----------

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
        a.download = `还款账单_${state.currentYear}年备份_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('已导出备份文件');
    }

    function importJSON(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.bills || typeof data.bills !== 'object') {
                    throw new Error('文件格式无效');
                }
                showConfirm(
                    '导入备份',
                    '导入将合并到现有数据中，相同月份的账单会追加（不会覆盖）。确定导入吗？',
                    () => {
                        // 合并账单
                        Object.keys(data.bills).forEach(key => {
                            if (!state.bills[key]) {
                                state.bills[key] = [];
                            }
                            const existingIds = new Set(state.bills[key].map(b => b.id));
                            data.bills[key].forEach(b => {
                                // 给导入的账单生成新 ID，避免冲突
                                const newBill = { ...b, id: genId() };
                                // 但如果 ID 已经不存在就直接用
                                if (!existingIds.has(b.id)) {
                                    newBill.id = b.id;
                                    existingIds.add(b.id);
                                }
                                state.bills[key].push(newBill);
                            });
                        });
                        // 合并自定义平台
                        if (Array.isArray(data.customPlatforms)) {
                            data.customPlatforms.forEach(p => {
                                if (!state.customPlatforms.find(cp => cp.name === p.name)) {
                                    state.customPlatforms.push(p);
                                }
                            });
                        }
                        saveStorage();
                        showToast('导入成功');
                        refreshAll();
                    }
                );
            } catch (err) {
                showToast('导入失败：' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    }

    // ---------- HTML 转义 ----------

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttr(str) {
        return escapeHtml(str);
    }

    // ---------- 全局刷新 ----------

    function refreshAll() {
        renderBillList();
        renderMonthStats();
        renderYearStats();
        renderCharts();
    }

    // ---------- 事件绑定 ----------

    function bindEvents() {
        // 年份切换
        document.getElementById('yearSelect').addEventListener('change', (e) => {
            state.currentYear = parseInt(e.target.value);
            refreshAll();
        });

        // 月份切换
        document.getElementById('monthSelect').addEventListener('change', (e) => {
            state.currentMonth = parseInt(e.target.value);
            refreshAll();
        });

        // 添加按钮
        document.getElementById('btnAdd').addEventListener('click', openAddModal);

        // 取消按钮
        document.getElementById('btnCancelModal').addEventListener('click', hideBillModal);

        // 点击弹窗背景关闭
        document.getElementById('billModal').addEventListener('click', (e) => {
            if (e.target.id === 'billModal') hideBillModal();
        });

        // 表单提交
        document.getElementById('billForm').addEventListener('submit', handleFormSubmit);

        // 平台选择切换（显示自定义输入框）
        document.getElementById('platformSelect').addEventListener('change', toggleCustomPlatform);

        // 清空当月
        document.getElementById('btnClearMonth').addEventListener('click', clearMonthBills);

        // 导出
        document.getElementById('btnExport').addEventListener('click', exportJSON);

        // 导入按钮触发文件选择
        document.getElementById('btnImport').addEventListener('click', () => {
            document.getElementById('fileImport').click();
        });
        document.getElementById('fileImport').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) importJSON(file);
            e.target.value = ''; // 重置，以便重复选择同一文件
        });

        // ESC 键关闭弹窗
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const billModal = document.getElementById('billModal');
                const confirmModal = document.getElementById('confirmModal');
                if (!billModal.classList.contains('hidden')) {
                    hideBillModal();
                } else if (!confirmModal.classList.contains('hidden')) {
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
        refreshAll();
    }

    // DOM 就绪后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
