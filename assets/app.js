(() => {
  const state = {
    config: Storage.load(),
    dingxinRows: [],
    lineBlocks: [],
    priceTable: null,
    customerMaster: [],
    quoteMaster: new Map(),
    stockMaster: new Map(),
    lineResolved: [],
    pendingStores: new Map(),
    pendingItems: new Map(),
    orderCompare: [],
    priceCompare: []
  };

  const $ = (id) => document.getElementById(id);

  // 存設定：本機一定存一份（離線也能用），Firebase有設定好的話同時推上雲端讓其他裝置同步到
  function saveConfig() {
    Storage.save(state.config);
    CloudSync.push(state.config);
  }
  function mergeCloudConfig(remote) {
    return {
      ...structuredClone(Storage.DEFAULT_CONFIG),
      ...remote,
      storeAliases: { ...Storage.DEFAULT_CONFIG.storeAliases, ...(remote.storeAliases || {}) },
      itemAliases: { ...Storage.DEFAULT_CONFIG.itemAliases, ...(remote.itemAliases || {}) }
    };
  }
  function refreshConfigDependentUI() {
    renderExcludeList();
    renderAliasTables();
    refreshPromoSelectors();
  }

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
    RefStorage.savePrice(state.priceTable, file.name);
    $('statusPrice').textContent = `已讀取 ${state.priceTable.customerList.length} 個客戶 / ${state.priceTable.productMaster.size} 個品項（已記住，下次自動帶入）`;
    $('btnClearPrice').style.display = '';
    refreshPromoSelectors();
  });

  $('fileCustomer').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const buf = await readArrayBuffer(file);
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    state.customerMaster = CustomerParser.parse(wb);
    RefStorage.saveCustomer(state.customerMaster, file.name);
    $('statusCustomer').textContent = `已讀取 ${state.customerMaster.length} 個客戶（已記住，下次自動帶入）`;
    $('btnClearCustomer').style.display = '';
    refreshPromoSelectors();
  });

  $('fileQuote').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const buf = await readArrayBuffer(file);
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    state.quoteMaster = QuoteParser.parse(wb);
    RefStorage.saveQuote(state.quoteMaster, file.name);
    $('statusQuote').textContent = `已讀取 ${state.quoteMaster.size} 個品項（已記住，下次自動帶入）`;
    $('btnClearQuote').style.display = '';
    refreshPromoSelectors();
  });

  $('fileStockMaster').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const buf = await readArrayBuffer(file);
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    state.stockMaster = StockMasterParser.parse(wb);
    RefStorage.saveStockMaster(state.stockMaster, file.name);
    $('statusStockMaster').textContent = `已讀取 ${state.stockMaster.size} 個品項（已記住，下次自動帶入）`;
    $('btnClearStockMaster').style.display = '';
    refreshPromoSelectors();
  });

  $('btnClearPrice').addEventListener('click', () => {
    RefStorage.clear('price');
    state.priceTable = null;
    $('statusPrice').textContent = '';
    $('btnClearPrice').style.display = 'none';
    refreshPromoSelectors();
  });
  $('btnClearCustomer').addEventListener('click', () => {
    RefStorage.clear('customer');
    state.customerMaster = [];
    $('statusCustomer').textContent = '';
    $('btnClearCustomer').style.display = 'none';
    refreshPromoSelectors();
  });
  $('btnClearQuote').addEventListener('click', () => {
    RefStorage.clear('quote');
    state.quoteMaster = new Map();
    $('statusQuote').textContent = '';
    $('btnClearQuote').style.display = 'none';
    refreshPromoSelectors();
  });
  $('btnClearStockMaster').addEventListener('click', () => {
    RefStorage.clear('stockMaster');
    state.stockMaster = new Map();
    $('statusStockMaster').textContent = '';
    $('btnClearStockMaster').style.display = 'none';
    refreshPromoSelectors();
  });

  function loadPersistedReferences() {
    const p = RefStorage.loadPrice();
    if (p) {
      state.priceTable = p.priceTable;
      $('statusPrice').textContent = RefStorage.formatMeta(p.meta);
      $('btnClearPrice').style.display = '';
    }
    const c = RefStorage.loadCustomer();
    if (c) {
      state.customerMaster = c.customerMaster;
      $('statusCustomer').textContent = RefStorage.formatMeta(c.meta);
      $('btnClearCustomer').style.display = '';
    }
    const q = RefStorage.loadQuote();
    if (q) {
      state.quoteMaster = q.quoteMaster;
      $('statusQuote').textContent = RefStorage.formatMeta(q.meta);
      $('btnClearQuote').style.display = '';
    }
    const sm = RefStorage.loadStockMaster();
    if (sm) {
      state.stockMaster = sm.stockMaster;
      $('statusStockMaster').textContent = RefStorage.formatMeta(sm.meta);
      $('btnClearStockMaster').style.display = '';
    }
    refreshPromoSelectors();
  }

  function allStoreCandidates() {
    const s = new Set(state.dingxinRows.map((r) => r.customer));
    for (const c of state.customerMaster) s.add(c.name);
    if (state.priceTable) for (const c of state.priceTable.customerList) s.add(c);
    return [...s].filter(Boolean);
  }

  // 品名優先用商品主檔（多倉庫存表，品項最完整最準確），
  // 其次報價單（momi報價單），查不到才退回查核表的品名
  function productDisplayName(itemCode) {
    if (!itemCode) return '';
    const sm = state.stockMaster.get(itemCode);
    if (sm && sm.name) return sm.name;
    const q = state.quoteMaster.get(itemCode);
    if (q && q.name) return q.name;
    if (state.priceTable && state.priceTable.productMaster.has(itemCode)) {
      return state.priceTable.productMaster.get(itemCode);
    }
    return itemCode;
  }

  function allProductMaster() {
    const m = new Map(state.priceTable ? state.priceTable.productMaster : []);
    for (const [code, info] of state.quoteMaster) {
      if (!m.has(code)) m.set(code, info.name);
    }
    for (const [code, info] of state.stockMaster) {
      m.set(code, info.name); // 商品主檔品名最準確，覆蓋前面的
    }
    return m;
  }

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
    const { resolved, pendingStores, pendingItems } = Matcher.buildLineIndex(
      state.lineBlocks, state.config, allStoreCandidates(), allProductMaster()
    );
    state.lineResolved = resolved;
    state.pendingStores = pendingStores;
    state.pendingItems = pendingItems;

    const dateFrom = $('dateFrom').value || null;
    const dateTo = $('dateTo').value || null;
    const priceCtx = { priceTable: state.priceTable, promotions: state.config.promotions, quoteMaster: state.quoteMaster };
    state.orderCompare = Matcher.compareOrders(resolved, state.dingxinRows, dateFrom, dateTo, state.config.stockouts, priceCtx);
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
      const cp = PriceTable.correctPrice(state.priceTable, state.config.promotions, row.customer, row.itemCode, row.date, state.quoteMaster);
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
    const customers = allStoreCandidates().sort();
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
        saveConfig();
        runCompare();
      });
    });
  }

  function renderPendingItems() {
    const el = $('pendingItems');
    if (!state.pendingItems.size) { el.innerHTML = '<div class="empty-state">目前沒有待對照品項</div>'; return; }
    const products = [...allProductMaster().entries()].sort((a, b) => a[0].localeCompare(b[0]));
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
        saveConfig();
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
      saveConfig();
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
      saveConfig();
      renderAliasTables();
    }));
  }

  // ---------- render: order comparison ----------
  function renderOrderResults() {
    const el = $('orderResults');
    const diffCount = state.orderCompare.filter((g) => g.hasDiff).length;
    const unmatchedLineCount = state.orderCompare.filter((g) => g.unmatchedSide === 'line').length;
    const unmatchedDxCount = state.orderCompare.filter((g) => g.unmatchedSide === 'dingxin').length;
    const priceDiffCount = state.orderCompare.filter((g) => (g.rows || []).some((r) => r.priceStatus === 'diff')).length;
    $('orderStats').innerHTML = `
      <div class="stat"><b>${state.orderCompare.length}</b>則對話/訂單</div>
      <div class="stat"><b>${diffCount}</b>數量有差異</div>
      <div class="stat"><b>${priceDiffCount}</b>價格有異常</div>
      <div class="stat"><b>${unmatchedLineCount}</b>LINE有下單但鼎新找不到對應</div>
      <div class="stat"><b>${unmatchedDxCount}</b>鼎新有單但LINE找不到對應對話</div>
      <div class="stat"><b>${state.pendingStores.size}</b>待對照店家</div>
      <div class="stat"><b>${state.pendingItems.size}</b>待對照品項</div>
    `;
    if (!state.orderCompare.length) { el.innerHTML = '<div class="empty-state">此區間沒有可比對的資料</div>'; return; }

    const searchText = ($('orderSearch').value || '').trim().toLowerCase();
    const onlyDiff = $('orderOnlyDiff').checked;
    const rows = state.orderCompare.filter((g) => {
      if (onlyDiff && !g.hasDiff) return false;
      if (!searchText) return true;
      const haystack = [
        g.customer, g.date, g.orderNo, g.lineHeader,
        ...(g.lineRawItems || []), ...(g.rows || []).map((r) => r.itemCode)
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(searchText);
    });

    if (!rows.length) { el.innerHTML = '<div class="empty-state">沒有符合搜尋條件的結果</div>'; return; }

    let html = '';
    for (const g of rows) {
      let badge = '<span class="badge badge-ok">一致</span>';
      if (g.unmatchedSide === 'line') badge = '<span class="badge badge-warn">⚠️ LINE有下單，鼎新找不到對應</span>';
      else if (g.unmatchedSide === 'dingxin') badge = '<span class="badge badge-warn">⚠️ 鼎新有單，LINE找不到對應對話</span>';
      else if (g.hasDiff) badge = '<span class="badge badge-diff">有差異</span>';
      const lineSentLabel = g.lineTime
        ? (g.lineDate && g.lineDate !== g.date ? `LINE送出於 ${g.lineDate} ${g.lineTime}（歸入 ${g.date} 訂單）` : `LINE時間 ${g.lineTime}`)
        : null;
      const meta = [
        lineSentLabel,
        g.orderNo ? `鼎新單號 ${g.orderNo}` : null
      ].filter(Boolean).join(' ｜ ');
      html += `<div class="order-block"><div class="block-header"><strong>${escapeHtml(g.customer)} - ${g.date}</strong>${badge}</div>`;
      if (meta) html += `<div class="section-note" style="margin-top:-6px">${escapeHtml(meta)}</div>`;

      if (g.lineHeader || (g.lineRawLines && g.lineRawLines.length)) {
        const bubbleLines = [];
        if (g.lineHeader) bubbleLines.push(escapeHtml(g.lineHeader));
        // 按原始訊息裡的行順序顯示，不要把品項行跟備註行拆開重新分組，
        // 不然「請補出 二割x3 / 回收 一割x3」這種一行指示對應一個品項的語意會被打亂
        const raws = (g.lineRawLines && g.lineRawLines.length) ? g.lineRawLines : [...(g.lineRawItems || []), ...(g.lineNotes || [])];
        for (const raw of raws) bubbleLines.push(escapeHtml(raw));
        html += `<div class="line-bubble">${bubbleLines.join('<br>')}</div>`;
      }

      html += '<div class="block-body">' + compareTableHtml(g.rows) + '</div></div>';
    }
    el.innerHTML = html;
  }

  function priceStatusBadge(status) {
    if (status === 'ok') return '<span class="badge badge-ok">正常</span>';
    if (status === 'diff') return '<span class="badge badge-diff">異常</span>';
    if (status === 'gift') return '<span class="badge badge-warn">贈品/特殊</span>';
    if (status === 'selfuse') return '<span class="badge badge-warn">活體/自用</span>';
    return '<span class="badge badge-muted">查無資料</span>';
  }

  // 左右對照表：品名用鼎新中文名，不同的一格用顏色標出來（而不是只標整列）。
  // 鼎新那一行如果同品號分好幾行登打（例如一行正常價、一行贈品0元），完全照鼎新單拆成好幾列顯示，
  // 不要自己加總合併成一列——這樣才能直接對照原始銷貨單肉眼核對。
  function compareTableHtml(rows) {
    const hasPrice = rows.some((r) => r.priceStatus !== undefined);
    let html = '<table class="compare-table"><thead><tr>' +
      '<th class="col-a">LINE寫的品名</th><th class="col-b">鼎新品名</th><th class="col-a">LINE數量</th><th class="col-b">鼎新數量</th><th>數量差異</th>' +
      (hasPrice ? '<th class="col-a">登打單價</th><th class="col-b">正確價格</th><th>價格狀態</th><th class="col-a">LINE備註</th>' : '') +
      '</tr></thead><tbody>';
    for (const r of rows) {
      const netDiff = r.diff - (r.selfUseAbsorbed || 0);
      const mismatch = netDiff !== 0 && !r.stockout;
      const cell = mismatch ? 'cell-diff' : (r.stockout || r.selfUseAbsorbed ? 'cell-stockout' : '');
      let diffCell = escapeHtml(r.diff);
      if (r.stockout) diffCell = '<span class="badge badge-warn">缺貨</span>';
      else if (r.selfUseAbsorbed) diffCell = `<span class="badge badge-warn">活體/自用 +${r.selfUseAbsorbed}</span>` + (netDiff !== 0 ? ` ${escapeHtml(netDiff)}` : '');

      // 鼎新這個品號在單上有幾行，這裡就顯示幾列；完全沒有鼎新明細（純LINE有寫、鼎新沒key）時只顯示一列
      const dxLines = (hasPrice && r.priceLines && r.priceLines.length) ? r.priceLines : (r.dxQty ? [{ qty: r.dxQty, unitPrice: null, status: undefined }] : [null]);
      const rowspan = dxLines.length;

      dxLines.forEach((l, i) => {
        html += '<tr>';
        if (i === 0) {
          html += `
          <td class="col-a" rowspan="${rowspan}">${escapeHtml(r.lineName || '-')}</td>`;
        }
        html += `<td class="col-b">${escapeHtml(productDisplayName(r.itemCode))}</td>`;
        if (i === 0) {
          html += `<td class="col-a ${cell}" rowspan="${rowspan}">${escapeHtml(r.lineQty)}</td>`;
        }
        html += `<td class="col-b ${cell}">${l ? escapeHtml(l.qty) : '-'}</td>`;
        if (i === 0) {
          html += `<td class="${cell}" rowspan="${rowspan}">${diffCell}</td>`;
        }
        if (hasPrice) {
          const priceCell = l && l.status === 'diff' ? 'cell-diff' : (l && (l.status === 'gift' || l.status === 'selfuse') ? 'cell-stockout' : '');
          html += `
          <td class="col-a ${priceCell}">${l && l.unitPrice != null ? escapeHtml(l.unitPrice) : '-'}</td>`;
          if (i === 0) {
            html += `<td class="col-b" rowspan="${rowspan}">${r.correctPrice != null ? escapeHtml(r.correctPrice) : '-'}</td>`;
          }
          html += `<td class="${priceCell}">${priceStatusBadge(l ? l.status : undefined)}</td>`;
          if (i === 0) {
            html += `<td class="col-a suggestion" rowspan="${rowspan}">${escapeHtml(r.lineNote || '')}</td>`;
          }
        }
        html += '</tr>';
      });
    }
    html += '</tbody></table>';
    return html;
  }
  $('orderSearch').addEventListener('input', renderOrderResults);
  $('orderOnlyDiff').addEventListener('change', renderOrderResults);

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
    let html = '<table class="compare-table"><thead><tr>' +
      '<th>日期</th><th>客戶</th><th>品名</th><th>數量</th><th class="col-a">登打單價</th>' +
      '<th class="col-b">正確價格</th><th>來源</th><th>狀態</th></tr></thead><tbody>';
    for (const r of rows) {
      const mismatch = r.status === 'diff';
      const cell = mismatch ? 'cell-diff' : '';
      const statusBadge = r.status === 'diff'
        ? '<span class="badge badge-diff">異常</span>'
        : (r.status === 'ok' ? '<span class="badge badge-ok">正常</span>' : '<span class="badge badge-muted">查無資料</span>');
      html += `<tr>
        <td>${escapeHtml(r.date)}</td>
        <td>${escapeHtml(r.customer)}</td>
        <td>${escapeHtml(productDisplayName(r.itemCode))}</td>
        <td>${escapeHtml(r.qty)}</td>
        <td class="col-a ${cell}">${escapeHtml(r.unitPrice)}</td>
        <td class="col-b ${cell}">${r.correctPrice != null ? escapeHtml(r.correctPrice) : '-'}</td>
        <td>${escapeHtml(r.priceSource ? (r.promo ? `${r.priceSource}+促銷` : r.priceSource) : '-')}</td>
        <td>${statusBadge}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    el.innerHTML = html;
  }
  $('priceOnlyDiff').addEventListener('change', renderPriceResults);

  $('btnExportPrice').addEventListener('click', () => {
    const rows = state.priceCompare.map((r) => ({
      日期: r.date, 單號: r.orderNo, 客戶: r.customer, 品號: r.itemCode, 品名: productDisplayName(r.itemCode),
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
      saveConfig();
      renderExcludeList();
    }));
  }
  $('btnAddExclude').addEventListener('click', () => {
    const val = $('newExcludeName').value.trim();
    if (!val || state.config.excludedNames.includes(val)) return;
    state.config.excludedNames.push(val);
    saveConfig();
    $('newExcludeName').value = '';
    renderExcludeList();
  });

  // ---------- promotions ----------
  function refreshPromoSelectors() {
    const storeSel = $('promoStore');
    storeSel.innerHTML = allStoreCandidates().sort().map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
    const itemSel = $('promoItem');
    itemSel.innerHTML = [...allProductMaster().entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, name]) => `<option value="${escapeAttr(code)}">${escapeHtml(code)} - ${escapeHtml(name)}</option>`).join('');
    renderPromoTable();

    const stockItemSel = $('stockItem');
    stockItemSel.innerHTML = [...allProductMaster().entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, name]) => `<option value="${escapeAttr(code)}">${escapeHtml(code)} - ${escapeHtml(name)}</option>`).join('');
    const stockStoreSel = $('stockStore');
    stockStoreSel.innerHTML = '<option value="">全部店家</option>' +
      allStoreCandidates().sort().map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
    renderStockTable();
  }
  $('promoScope').addEventListener('change', () => {
    $('promoItem').style.display = $('promoScope').value === 'item' ? '' : 'none';
  });
  $('btnAddPromo').addEventListener('click', () => {
    if (!$('promoStore').options.length) { alert('請先上傳客戶價格查核表或客戶資料表'); return; }
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
    saveConfig();
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
      saveConfig();
      renderPromoTable();
    }));
  }

  // ---------- 缺貨品項設定 ----------
  $('btnAddStock').addEventListener('click', () => {
    if (!$('stockItem').options.length) { alert('請先上傳商品主檔、報價單或客戶價格查核表'); return; }
    const stockout = {
      id: `s${Date.now()}`,
      itemCode: $('stockItem').value,
      store: $('stockStore').value || null,
      startDate: $('stockStart').value || null,
      endDate: $('stockEnd').value || null,
      note: $('stockNote').value.trim()
    };
    if (!stockout.itemCode) { alert('請選擇品項'); return; }
    state.config.stockouts.push(stockout);
    saveConfig();
    $('stockNote').value = '';
    renderStockTable();
  });
  function renderStockTable() {
    const el = $('stockTable');
    if (!state.config.stockouts.length) { el.innerHTML = '<div class="empty-state">尚未設定缺貨品項</div>'; return; }
    el.innerHTML = tableHtml(
      ['品項', '店家', '開始', '結束', '備註', ''],
      state.config.stockouts.map((s) => [
        productDisplayName(s.itemCode) || s.itemCode,
        s.store || '全部店家',
        s.startDate || '不限', s.endDate || '尚未恢復', s.note || '',
        `<button class="danger remove-stock" data-id="${s.id}">刪除</button>`
      ])
    );
    el.querySelectorAll('.remove-stock').forEach((b) => b.addEventListener('click', () => {
      state.config.stockouts = state.config.stockouts.filter((s) => s.id !== b.dataset.id);
      saveConfig();
      renderStockTable();
    }));
  }

  // ---------- config import/export ----------
  $('btnExportConfig').addEventListener('click', () => Storage.exportJSON(state.config));
  $('fileImportConfig').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      state.config = await Storage.importJSON(file);
      saveConfig();
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
  loadPersistedReferences();

  // 雲端設定同步：Firebase設定好才會啟用；沒設定的話完全不影響，維持原本純本機儲存的行為。
  // onChange第一次觸發時本來就會拿到雲端目前的值，等同開頁時的初始讀取，不用另外呼叫一次pull()
  if (CloudSync.init()) {
    CloudSync.onChange((remote) => {
      state.config = mergeCloudConfig(remote);
      Storage.save(state.config);
      refreshConfigDependentUI();
    });
  }
})();
