(() => {
  const state = {
    config: Storage.load(),
    dingxinRows: [],
    lineBlocks: [],
    priceTable: null,
    lineResolved: [],
    pendingStores: new Map(),
    pendingItems: new Map(),
    orderCompare: [],
    priceCompare: []
  };

  const $ = (id) => document.getElementById(id);

  // ---------- tabs ----------
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // ---------- file uploads ----------
  function readArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
  function readText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file, 'UTF-8');
    });
  }

  $('fileDingxin').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const buf = await readArrayBuffer(file);
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    state.dingxinRows = DingxinParser.parse(wb);
    $('statusDingxin').textContent = `已讀取 ${state.dingxinRows.length} 筆明細`;
    autoSetDateRange();
  });

  $('fileLine').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await readText(file);
    state.lineBlocks = LineParser.parse(text, state.config.excludedNames);
    $('statusLine').textContent = `已解析 ${state.lineBlocks.length} 個訂單區塊`;
  });

  $('filePrice').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const buf = await readArrayBuffer(file);
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    state.priceTable = PriceTable.build(wb);
    $('statusPrice').textContent = `已讀取 ${state.priceTable.customerList.length} 個客戶 / ${state.priceTable.productMaster.size} 個品項`;
    refreshPromoSelectors();
  });

  function autoSetDateRange() {
    const dates = state.dingxinRows.map((r) => r.date).filter(Boolean).sort();
    if (dates.length) {
      $('dateFrom').value = dates[0];
      $('dateTo').value = dates[dates.length - 1];
    }
  }

  // ---------- run comparison ----------
  $('btnRun').addEventListener('click', () => {
    if (!state.dingxinRows.length || !state.lineBlocks.length || !state.priceTable) {
      $('statusRun').textContent = '請先把三個檔案都上傳完成';
      return;
    }
    $('statusRun').textContent = '比對中...';
    setTimeout(runCompare, 30);
  });

  function runCompare() {
    const dingxinCustomers = [...new Set(state.dingxinRows.map((r) => r.customer))];
    const { resolved, pendingStores, pendingItems } = Matcher.buildLineIndex(
      state.lineBlocks, state.config, dingxinCustomers, state.priceTable.productMaster
    );
    state.lineResolved = resolved;
    state.pendingStores = pendingStores;
    state.pendingItems = pendingItems;

    const dateFrom = $('dateFrom').value || null;
    const dateTo = $('dateTo').value || null;
    state.orderCompare = Matcher.compareOrders(resolved, state.dingxinRows, dateFrom, dateTo);
    state.priceCompare = computePriceCompare(dateFrom, dateTo);

    $('statusRun').textContent = '比對完成';
    renderPendingStores();
    renderPendingItems();
    renderAliasTables();
    renderOrderResults();
    renderPriceResults();
  }

  function computePriceCompare(dateFrom, dateTo) {
    const inRange = (d) => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
    const out = [];
    for (const row of state.dingxinRows) {
      if (!row.date || !inRange(row.date)) continue;
      if (!row.itemCode) continue;
      const cp = PriceTable.correctPrice(state.priceTable, state.config.promotions, row.customer, row.itemCode, row.date);
      let status = 'unknown';
      if (cp.price != null) status = (row.unitPrice === cp.price) ? 'ok' : 'diff';
      out.push({ ...row, correctPrice: cp.price, priceSource: cp.source, promo: cp.promo, status });
    }
    return out;
  }

  // ---------- render: pending stores/items ----------
  function renderPendingStores() {
    const el = $('pendingStores');
    if (!state.pendingStores.size) { el.innerHTML = '<div class="empty-state">目前沒有待對照店家</div>'; return; }
    const customers = [...new Set(state.dingxinRows.map((r) => r.customer))].sort();
    let html = '<div class="pending-list">';
    for (const [key, info] of state.pendingStores) {
      const options = customers.map((c) => `<option value="${escapeAttr(c)}" ${info.suggestion === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
      html += `<div class="pending-row" data-key="${escapeAttr(key)}">
        <span class="raw">LINE: ${escapeHtml(info.raw)}</span>
        ${info.suggestion ? `<span class="suggestion">建議: ${escapeHtml(info.suggestion)} (${Math.round((info.score||0)*100)}%)</span>` : ''}
        <select class="pending-store-select"><option value="">-- 選擇對應鼎新客戶 --</option>${options}</select>
        <button class="secondary pending-store-confirm">確認對照</button>
      </div>`;
    }
    html += '</div>';
    el.innerHTML = html;
    el.querySelectorAll('.pending-row').forEach((rowEl) => {
      rowEl.querySelector('.pending-store-confirm').addEventListener('click', () => {
        const key = rowEl.dataset.key;
        const val = rowEl.querySelector('.pending-store-select').value;
        if (!val) return;
        state.config.storeAliases[key] = val;
        Storage.save(state.config);
        runCompare();
      });
    });
  }

  function renderPendingItems() {
    const el = $('pendingItems');
    if (!state.pendingItems.size) { el.innerHTML = '<div class="empty-state">目前沒有待對照品項</div>'; return; }
    const products = [...state.priceTable.productMaster.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let html = '<div class="pending-list">';
    for (const [key, info] of state.pendingItems) {
      const options = products.map(([code, name]) => `<option value="${escapeAttr(code)}" ${info.suggestion === code ? 'selected' : ''}>${escapeHtml(code)} - ${escapeHtml(name)}</option>`).join('');
      const warnBadge = info.sizeWarning ? '<span class="badge badge-warn">⚠️ 規格可能不同，請確認重量/容量</span>' : '';
      html += `<div class="pending-row" data-key="${escapeAttr(key)}">
        <span class="raw">LINE: ${escapeHtml(info.raw)}</span>
        ${info.suggestion ? `<span class="suggestion">建議: ${escapeHtml(info.suggestionName || info.suggestion)} (${Math.round((info.score||0)*100)}%)</span>` : ''}
        ${warnBadge}
        <select class="pending-item-select"><option value="">-- 選擇對應鼎新品號 --</option>${options}</select>
        <button class="secondary pending-item-confirm">確認對照</button>
      </div>`;
    }
    html += '</div>';
    el.innerHTML = html;
    el.querySelectorAll('.pending-row').forEach((rowEl) => {
      rowEl.querySelector('.pending-item-confirm').addEventListener('click', () => {
        const key = rowEl.dataset.key;
        const val = rowEl.querySelector('.pending-item-select').value;
        if (!val) return;
        state.config.itemAliases[key] = val;
        Storage.save(state.config);
        runCompare();
      });
    });
  }

  function renderAliasTables() {
    const storeEl = $('storeAliasTable');
    const storeEntries = Object.entries(state.config.storeAliases);
    storeEl.innerHTML = storeEntries.length ? tableHtml(
      ['LINE店名(正規化)', '對應鼎新客戶', ''],
      storeEntries.map(([k, v]) => [k, v, `<button class="danger remove-store-alias" data-key="${escapeAttr(k)}">刪除</button>`])
    ) : '<div class="empty-state">尚未建立</div>';
    storeEl.querySelectorAll('.remove-store-alias').forEach((b) => b.addEventListener('click', () => {
      delete state.config.storeAliases[b.dataset.key];
      Storage.save(state.config);
      renderAliasTables();
    }));

    const itemEl = $('itemAliasTable');
    const itemEntries = Object.entries(state.config.itemAliases);
    itemEl.innerHTML = itemEntries.length ? tableHtml(
      ['LINE品名(正規化)', '對應鼎新品號', ''],
      itemEntries.map(([k, v]) => [k, v, `<button class="danger remove-item-alias" data-key="${escapeAttr(k)}">刪除</button>`])
    ) : '<div class="empty-state">尚未建立</div>';
    itemEl.querySelectorAll('.remove-item-alias').forEach((b) => b.addEventListener('click', () => {
      delete state.config.itemAliases[b.dataset.key];
      Storage.save(state.config);
      renderAliasTables();
    }));
  }

  // ---------- render: order comparison ----------
  function renderOrderResults() {
    const el = $('orderResults');
    const diffCount = state.orderCompare.filter((g) => g.hasDiff).length;
    $('orderStats').innerHTML = `
      <div class="stat"><b>${state.orderCompare.length}</b>店家×日期 組合</div>
      <div class="stat"><b>${diffCount}</b>有差異</div>
      <div class="stat"><b>${state.pendingStores.size}</b>待對照店家</div>
      <div class="stat"><b>${state.pendingItems.size}</b>待對照品項</div>
    `;
    if (!state.orderCompare.length) { el.innerHTML = '<div class="empty-state">此區間沒有可比對的資料</div>'; return; }
    let html = '';
    for (const g of state.orderCompare) {
      const badge = g.hasDiff ? '<span class="badge badge-diff">有差異</span>' : '<span class="badge badge-ok">一致</span>';
      html += `<div class="order-block"><div class="block-header"><strong>${escapeHtml(g.customer)} - ${g.date}</strong>${badge}</div>`;
      html += '<div class="block-body">' + tableHtml(
        ['品號', 'LINE數量', '鼎新數量', '差異'],
        g.rows.map((r) => [r.itemCode, r.lineQty, r.dxQty, r.diff]),
        (r) => (r[3] !== 0 ? 'row-diff' : 'row-ok')
      ) + '</div></div>';
    }
    el.innerHTML = html;
  }

  // ---------- render: price comparison ----------
  function renderPriceResults() {
    const onlyDiff = $('priceOnlyDiff').checked;
    const rows = onlyDiff ? state.priceCompare.filter((r) => r.status === 'diff') : state.priceCompare;
    const diffCount = state.priceCompare.filter((r) => r.status === 'diff').length;
    const unknownCount = state.priceCompare.filter((r) => r.status === 'unknown').length;
    $('priceStats').innerHTML = `
      <div class="stat"><b>${state.priceCompare.length}</b>筆明細</div>
      <div class="stat"><b>${diffCount}</b>價格異常</div>
      <div class="stat"><b>${unknownCount}</b>查無價格資料</div>
    `;
    const el = $('priceResults');
    if (!rows.length) { el.innerHTML = '<div class="empty-state">沒有符合條件的資料</div>'; return; }
    el.innerHTML = tableHtml(
      ['日期', '單號', '客戶', '品號', '品名', '數量', '登打單價', '正確價格', '來源', '狀態'],
      rows.map((r) => [
        r.date, r.orderNo, r.customer, r.itemCode, r.itemName, r.qty, r.unitPrice,
        r.correctPrice != null ? r.correctPrice : '-',
        r.priceSource ? (r.promo ? `${r.priceSource}+促銷` : r.priceSource) : '-',
        r.status === 'diff' ? '異常' : (r.status === 'ok' ? '正常' : '查無資料')
      ]),
      (r, i) => rows[i].status === 'diff' ? 'row-diff' : (rows[i].status === 'unknown' ? 'row-warn' : 'row-ok')
    );
  }
  $('priceOnlyDiff').addEventListener('change', renderPriceResults);

  $('btnExportPrice').addEventListener('click', () => {
    const rows = state.priceCompare.map((r) => ({
      日期: r.date, 單號: r.orderNo, 客戶: r.customer, 品號: r.itemCode, 品名: r.itemName,
      數量: r.qty, 登打單價: r.unitPrice, 正確價格: r.correctPrice, 價格來源: r.priceSource,
      狀態: r.status === 'diff' ? '異常' : (r.status === 'ok' ? '正常' : '查無資料')
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '價格比對');
    XLSX.writeFile(wb, `價格比對結果_${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

  // ---------- exclude names ----------
  function renderExcludeList() {
    const el = $('excludeList');
    el.innerHTML = state.config.excludedNames.map((n) =>
      `<span class="tag">${escapeHtml(n)}<button data-name="${escapeAttr(n)}">×</button></span>`
    ).join('');
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      state.config.excludedNames = state.config.excludedNames.filter((n) => n !== b.dataset.name);
      Storage.save(state.config);
      renderExcludeList();
    }));
  }
  $('btnAddExclude').addEventListener('click', () => {
    const val = $('newExcludeName').value.trim();
    if (!val || state.config.excludedNames.includes(val)) return;
    state.config.excludedNames.push(val);
    Storage.save(state.config);
    $('newExcludeName').value = '';
    renderExcludeList();
  });

  // ---------- promotions ----------
  function refreshPromoSelectors() {
    if (!state.priceTable) return;
    const storeSel = $('promoStore');
    storeSel.innerHTML = state.priceTable.customerList.slice().sort().map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
    const itemSel = $('promoItem');
    itemSel.innerHTML = [...state.priceTable.productMaster.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, name]) => `<option value="${escapeAttr(code)}">${escapeHtml(code)} - ${escapeHtml(name)}</option>`).join('');
    renderPromoTable();
  }
  $('promoScope').addEventListener('change', () => {
    $('promoItem').style.display = $('promoScope').value === 'item' ? '' : 'none';
  });
  $('btnAddPromo').addEventListener('click', () => {
    if (!state.priceTable) { alert('請先上傳客戶價格查核表'); return; }
    const scope = $('promoScope').value;
    const promo = {
      id: `p${Date.now()}`,
      store: $('promoStore').value,
      scope,
      itemCode: scope === 'item' ? $('promoItem').value : null,
      discountType: $('promoType').value,
      value: Number($('promoValue').value),
      startDate: $('promoStart').value || null,
      endDate: $('promoEnd').value || null,
      note: $('promoNote').value.trim()
    };
    if (!promo.store || isNaN(promo.value)) { alert('請選擇店家並輸入數值'); return; }
    state.config.promotions.push(promo);
    Storage.save(state.config);
    $('promoValue').value = '';
    $('promoNote').value = '';
    renderPromoTable();
  });
  function renderPromoTable() {
    const el = $('promoTable');
    if (!state.config.promotions.length) { el.innerHTML = '<div class="empty-state">尚未設定促銷</div>'; return; }
    el.innerHTML = tableHtml(
      ['店家', '範圍', '折扣/價格', '開始', '結束', '備註', ''],
      state.config.promotions.map((p) => [
        p.store,
        p.scope === 'item' ? `單品 ${p.itemCode}` : '整店',
        p.discountType === 'percent' ? `${p.value}折算(%)` : `固定 ${p.value} 元`,
        p.startDate || '不限', p.endDate || '不限', p.note || '',
        `<button class="danger remove-promo" data-id="${p.id}">刪除</button>`
      ])
    );
    el.querySelectorAll('.remove-promo').forEach((b) => b.addEventListener('click', () => {
      state.config.promotions = state.config.promotions.filter((p) => p.id !== b.dataset.id);
      Storage.save(state.config);
      renderPromoTable();
    }));
  }

  // ---------- config import/export ----------
  $('btnExportConfig').addEventListener('click', () => Storage.exportJSON(state.config));
  $('fileImportConfig').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      state.config = await Storage.importJSON(file);
      Storage.save(state.config);
      renderExcludeList();
      renderAliasTables();
      refreshPromoSelectors();
      alert('設定匯入完成');
    } catch (err) {
      alert('匯入失敗，請確認是本工具匯出的 JSON 檔');
    }
  });

  // ---------- helpers ----------
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function tableHtml(headers, rows, rowClassFn) {
    let html = '<table><thead><tr>' + headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead><tbody>';
    rows.forEach((r, i) => {
      const cls = rowClassFn ? rowClassFn(r, i) : '';
      html += `<tr class="${cls}">` + r.map((c) => `<td>${typeof c === 'string' && c.startsWith('<button') ? c : escapeHtml(c)}</td>`).join('') + '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  // ---------- init ----------
  renderExcludeList();
  renderAliasTables();
})();
