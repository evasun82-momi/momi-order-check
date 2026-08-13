// 店家別名 / 品項別名 對照解析，以及 LINE vs 鼎新 的訂單比對邏輯

const Matcher = (() => {
  function resolveStore(storeNameRaw, config, dingxinCustomers) {
    const norm = Normalize.normStore(storeNameRaw);
    if (config.storeAliases[norm]) return { customer: config.storeAliases[norm], matchType: 'alias' };
    // 完全一致（正規化後）
    for (const c of dingxinCustomers) {
      if (Normalize.normStore(c) === norm) return { customer: c, matchType: 'exact' };
    }
    // 模糊比對，僅作建議、一定要人工在「店家/品項對照」頁簽點選確認才會生效，不自動採用，
    // 所以門檻可以放寬到接近一半，讓更多候選被列出來給你選，而不會有靜默配對錯的風險
    const candidates = dingxinCustomers.map((c) => ({ key: Normalize.normStore(c), value: c }));
    const best = Normalize.bestMatch(norm, candidates, 0.5);
    if (best) return { customer: null, suggestion: best.value, score: best.score, matchType: 'suggest' };
    return { customer: null, matchType: 'none' };
  }

  function resolveItem(itemNameRaw, config, productMaster) {
    const norm = Normalize.normItem(itemNameRaw);
    if (config.itemAliases[norm]) return { itemCode: config.itemAliases[norm], matchType: 'alias' };
    const matchKey = Normalize.normItemForMatch(itemNameRaw);
    const candidates = [];
    for (const [code, name] of productMaster.entries()) {
      candidates.push({ key: Normalize.normItemForMatch(name), value: code, name });
      candidates.push({ key: Normalize.normItem(code), value: code, name });
    }
    const best = Normalize.bestMatch(matchKey, candidates, 0.5);
    if (best) {
      const warnSize = Normalize.sizeMismatch(itemNameRaw, best.name);
      return { itemCode: null, suggestion: best.value, suggestionName: best.name, score: best.score, sizeWarning: warnSize, matchType: 'suggest' };
    }
    return { itemCode: null, matchType: 'none' };
  }

  function buildLineIndex(blocks, config, dingxinCustomers, productMaster) {
    const pendingStores = new Map(); // normStore -> {raw, suggestion, score}
    const pendingItems = new Map();  // normItem -> {raw, suggestion, score}
    const resolved = [];

    for (const block of blocks) {
      const storeRes = resolveStore(block.storeNameRaw, config, dingxinCustomers);
      if (!storeRes.customer) {
        const key = Normalize.normStore(block.storeNameRaw);
        if (!pendingStores.has(key)) pendingStores.set(key, { raw: block.storeNameRaw, suggestion: storeRes.suggestion, score: storeRes.score });
      }
      const items = block.items.filter((it) => !it.internalOnly).map((it) => {
        const itemRes = resolveItem(it.name, config, productMaster);
        if (!itemRes.itemCode) {
          const key = Normalize.normItem(it.name);
          if (!pendingItems.has(key)) {
            pendingItems.set(key, {
              raw: it.name, suggestion: itemRes.suggestion, suggestionName: itemRes.suggestionName,
              score: itemRes.score, sizeWarning: itemRes.sizeWarning
            });
          }
        }
        return { ...it, itemCode: itemRes.itemCode || null };
      });
      resolved.push({ ...block, customer: storeRes.customer, items });
    }
    return { resolved, pendingStores, pendingItems };
  }

  // 完全以助理打的截止線（如「8/6早----」）為分割單位；截止線出現前的訊息沒有依據可判斷，
  // 就先用當下的日曆日期，不再用09:00/12:00猜測。
  function effectiveOrderDate(block) {
    if (block.businessDateOverride) return block.businessDateOverride;
    return block.date;
  }

  // 兩邊品項的重疊分數：數量重疊越多分數越高，用來把「一則LINE對話」配對到「一張鼎新單」
  function overlapScore(lineMap, dxMap) {
    let score = 0;
    for (const [code, qty] of lineMap) score += Math.min(qty, dxMap.get(code) || 0);
    return score;
  }

  function buildDiffRows(lineMap, dxMap) {
    const itemCodes = new Set([...lineMap.keys(), ...dxMap.keys()]);
    const rows = [];
    let hasDiff = false;
    for (const code of itemCodes) {
      const lineQty = lineMap.get(code) || 0;
      const dxQty = dxMap.get(code) || 0;
      const diff = dxQty - lineQty;
      if (diff !== 0) hasDiff = true;
      rows.push({ itemCode: code, lineQty, dxQty, diff });
    }
    return { rows: rows.sort((a, b) => a.itemCode.localeCompare(b.itemCode)), hasDiff };
  }

  // 「一則LINE對話 = 一張鼎新單」：同店同天可能有多則對話、多張單，
  // 用品項重疊分數做貪婪配對，而不是把整天全部加總在一起比對
  function compareOrders(lineResolved, dingxinRows, dateFrom, dateTo) {
    const inRange = (d) => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);

    const dxOrders = new Map(); // customer|date|orderNo -> {customer,date,orderNo,items:Map}
    for (const row of dingxinRows) {
      if (!row.date || !inRange(row.date) || !row.itemCode) continue;
      const key = `${row.customer}|${row.date}|${row.orderNo}`;
      if (!dxOrders.has(key)) dxOrders.set(key, { customer: row.customer, date: row.date, orderNo: row.orderNo, items: new Map() });
      const o = dxOrders.get(key);
      o.items.set(row.itemCode, (o.items.get(row.itemCode) || 0) + row.qty);
    }
    const dxByStoreDate = new Map(); // customer|date -> [order,...]
    for (const o of dxOrders.values()) {
      const k = `${o.customer}|${o.date}`;
      if (!dxByStoreDate.has(k)) dxByStoreDate.set(k, []);
      dxByStoreDate.get(k).push(o);
    }

    const lineByStoreDate = new Map(); // customer|effectiveDate -> [{block,itemMap,effectiveDate},...]
    for (const block of lineResolved) {
      const orderDate = effectiveOrderDate(block);
      if (!block.customer || !orderDate || !inRange(orderDate)) continue;
      const itemMap = new Map();
      for (const it of block.items) {
        if (!it.itemCode) continue;
        itemMap.set(it.itemCode, (itemMap.get(it.itemCode) || 0) + it.qty);
      }
      if (!itemMap.size) continue;
      const k = `${block.customer}|${orderDate}`;
      if (!lineByStoreDate.has(k)) lineByStoreDate.set(k, []);
      lineByStoreDate.get(k).push({ block, itemMap, effectiveDate: orderDate });
    }

    const allKeys = new Set([...dxByStoreDate.keys(), ...lineByStoreDate.keys()]);
    const results = [];
    for (const key of allKeys) {
      const [customer, date] = key.split('|');
      const dxList = dxByStoreDate.get(key) || [];
      const lineList = lineByStoreDate.get(key) || [];

      const pairs = [];
      for (let i = 0; i < lineList.length; i++) {
        for (let j = 0; j < dxList.length; j++) {
          const score = overlapScore(lineList[i].itemMap, dxList[j].items);
          if (score > 0) pairs.push({ i, j, score });
        }
      }
      pairs.sort((a, b) => b.score - a.score);
      const usedLine = new Set(), usedDx = new Set();
      for (const p of pairs) {
        if (usedLine.has(p.i) || usedDx.has(p.j)) continue;
        usedLine.add(p.i); usedDx.add(p.j);
        const diff = buildDiffRows(lineList[p.i].itemMap, dxList[p.j].items);
        results.push({
          customer, date, lineTime: lineList[p.i].block.time, lineDate: lineList[p.i].block.date, lineHeader: lineList[p.i].block.rawHeader,
          lineRawItems: lineList[p.i].block.items.map((it) => it.raw), lineNotes: lineList[p.i].block.notes,
          orderNo: dxList[p.j].orderNo, matched: true, ...diff
        });
      }
      for (let i = 0; i < lineList.length; i++) {
        if (usedLine.has(i)) continue;
        const diff = buildDiffRows(lineList[i].itemMap, new Map());
        results.push({
          customer, date, lineTime: lineList[i].block.time, lineDate: lineList[i].block.date, lineHeader: lineList[i].block.rawHeader,
          lineRawItems: lineList[i].block.items.map((it) => it.raw), lineNotes: lineList[i].block.notes,
          orderNo: null, matched: false, unmatchedSide: 'line', ...diff, hasDiff: true
        });
      }
      for (let j = 0; j < dxList.length; j++) {
        if (usedDx.has(j)) continue;
        const diff = buildDiffRows(new Map(), dxList[j].items);
        results.push({
          customer, date, lineTime: null, lineHeader: null,
          orderNo: dxList[j].orderNo, matched: false, unmatchedSide: 'dingxin', ...diff, hasDiff: true
        });
      }
    }
    return results.sort((a, b) => (a.date + a.customer + (a.lineTime || '')).localeCompare(b.date + b.customer + (b.lineTime || '')));
  }

  return { resolveStore, resolveItem, buildLineIndex, compareOrders };
})();
