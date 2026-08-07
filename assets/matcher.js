// 店家別名 / 品項別名 對照解析，以及 LINE vs 鼎新 的訂單比對邏輯

const Matcher = (() => {
  function resolveStore(storeNameRaw, config, dingxinCustomers) {
    const norm = Normalize.normStore(storeNameRaw);
    if (config.storeAliases[norm]) return { customer: config.storeAliases[norm], matchType: 'alias' };
    // 完全一致（正規化後）
    for (const c of dingxinCustomers) {
      if (Normalize.normStore(c) === norm) return { customer: c, matchType: 'exact' };
    }
    // 模糊比對，僅作建議，不自動採用
    const candidates = dingxinCustomers.map((c) => ({ key: Normalize.normStore(c), value: c }));
    const best = Normalize.bestMatch(norm, candidates, 0.55);
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
    const best = Normalize.bestMatch(matchKey, candidates, 0.55);
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

  // 依 店家+日期 彙總 LINE 與 鼎新 的數量，做差異比對
  function compareOrders(lineResolved, dingxinRows, dateFrom, dateTo) {
    const inRange = (d) => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);

    const dingxinByKey = new Map(); // customer|date -> Map(itemCode -> qty)
    for (const row of dingxinRows) {
      if (!row.date || !inRange(row.date)) continue;
      if (!row.itemCode) continue;
      const key = `${row.customer}|${row.date}`;
      if (!dingxinByKey.has(key)) dingxinByKey.set(key, new Map());
      const m = dingxinByKey.get(key);
      m.set(row.itemCode, (m.get(row.itemCode) || 0) + row.qty);
    }

    const lineByKey = new Map();
    for (const block of lineResolved) {
      if (!block.customer || !block.date || !inRange(block.date)) continue;
      const key = `${block.customer}|${block.date}`;
      if (!lineByKey.has(key)) lineByKey.set(key, new Map());
      const m = lineByKey.get(key);
      for (const it of block.items) {
        if (!it.itemCode) continue;
        m.set(it.itemCode, (m.get(it.itemCode) || 0) + it.qty);
      }
    }

    const allKeys = new Set([...dingxinByKey.keys(), ...lineByKey.keys()]);
    const results = [];
    for (const key of allKeys) {
      const [customer, date] = key.split('|');
      const lineMap = lineByKey.get(key) || new Map();
      const dxMap = dingxinByKey.get(key) || new Map();
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
      results.push({ customer, date, rows: rows.sort((a, b) => a.itemCode.localeCompare(b.itemCode)), hasDiff });
    }
    return results.sort((a, b) => (a.date + a.customer).localeCompare(b.date + b.customer));
  }

  return { resolveStore, resolveItem, buildLineIndex, compareOrders };
})();
