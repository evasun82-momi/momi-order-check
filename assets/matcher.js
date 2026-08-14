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
    for (const [code, entry] of lineMap) {
      const dxEntry = dxMap.get(code);
      score += Math.min(entry.qty, dxEntry ? dxEntry.qty : 0);
    }
    return score;
  }

  // 缺貨設定：LINE有訂、鼎新沒登打，但品項剛好在缺貨區間內，不算真的差異
  function isStockedOut(stockouts, itemCode, customer, dateStr) {
    return (stockouts || []).some((s) => {
      if (s.itemCode !== itemCode) return false;
      if (s.store && s.store !== customer) return false;
      if (s.startDate && dateStr < s.startDate) return false;
      if (s.endDate && dateStr > s.endDate) return false;
      return true;
    });
  }

  // LINE備註常見「送3,業務回饋」「0元,破包換貨不寫字」這種贈品/特殊價說明，
  // 有這些字樣、且登打單價剛好是0，就當作有解釋、不是價格異常
  const GIFT_NOTE_RE = /送|贈|回饋|不寫字|換貨|試吃|樣品/;

  // 「自用木屑」「活體幼兔」這類品項會併入同類品項的數量裡，不能併到不相關的品項
  const SELF_USE_CATEGORY_CODES = {
    '木屑': ['MLMP0.7', 'MLMP2', 'MLMP4', 'MLMP10', 'MLMS0.7', 'MLMS2', 'MLMS10', 'MMC5', 'MMCP5', 'MLMN005', 'MMR10L'],
    '木粒': ['MLMP0.7', 'MLMP2', 'MLMP4', 'MLMP10', 'MLMS0.7', 'MLMS2', 'MLMS10', 'MMC5', 'MMCP5', 'MLMN005', 'MMR10L'],
    '墊料': ['MLMP0.7', 'MLMP2', 'MLMP4', 'MLMP10', 'MLMS0.7', 'MLMS2', 'MLMS10'],
    '刨花': ['MMC5', 'MMCP5'],
    '木絲': ['MLMN005'],
    '木梗': ['MMR10L'],
    '苜蓿': ['ALFA1', 'ALC1'],
    '幼兔': ['TIMCA1', 'TIMCA5'],
    '成兔': ['TIMCT1', 'TIMCT5'],
    '老兔': ['TIMIC1', 'TIMIC5'],
    '天竺鼠': ['TIMCG1', 'TIMCG5']
  };
  function selfUseCategoryCodes(keyword) {
    const key = Object.keys(SELF_USE_CATEGORY_CODES).find((k) => keyword.includes(k));
    return key ? SELF_USE_CATEGORY_CODES[key] : null;
  }

  function buildDiffRows(lineMap, dxMap, stockouts, customer, dateStr, priceCtx, selfUseItems) {
    // 品項順序完全照鼎新明細表的原始行順序（Map的insertion order跟excel列順序一致），
    // 不要照品號字母排序，比對時才能直接對照原始銷貨單肉眼核對。只有LINE有寫、鼎新完全沒登打
    // 的品項，因為在鼎新單上沒有對應位置，才排在最後面。
    const itemCodes = [...dxMap.keys(), ...[...lineMap.keys()].filter((c) => !dxMap.has(c))];
    const rows = [];
    for (const code of itemCodes) {
      const lineEntry = lineMap.get(code);
      const dxEntry = dxMap.get(code);
      const lineQty = lineEntry ? lineEntry.qty : 0;
      const dxQty = dxEntry ? dxEntry.qty : 0;
      const diff = dxQty - lineQty;
      const stockout = diff < 0 && isStockedOut(stockouts, code, customer, dateStr);
      const lineNote = lineEntry && lineEntry.notes.length ? lineEntry.notes.join('，') : '';
      const lineName = lineEntry && lineEntry.lineNames.length ? lineEntry.lineNames.join('、') : '';
      rows.push({ itemCode: code, lineQty, dxQty, diff, stockout, lineNote, lineName, dxEntry });
    }

    // 自用/活體品項（如「自用木屑」）鼎新登打時會直接併進「同類」品項的數量裡、標0元贈品，
    // 不會有自己的品號。用「同一則對話裡未對照到的自用/活體品項」當額度，
    // 只去抵掉同類品項多出來的鼎新數量，不能亂併到不相關的品項
    const budgets = new Map(); // keyword -> 剩餘數量
    for (const s of selfUseItems || []) budgets.set(s.keyword, (budgets.get(s.keyword) || 0) + s.qty);
    for (const row of rows) {
      if (!(row.diff > 0 && !row.stockout)) continue;
      for (const [keyword, remaining] of budgets) {
        if (remaining <= 0) continue;
        const codes = selfUseCategoryCodes(keyword);
        if (!codes || !codes.includes(row.itemCode)) continue;
        const absorb = Math.min(row.diff - (row.selfUseAbsorbed || 0), remaining);
        if (absorb <= 0) continue;
        row.selfUseAbsorbed = (row.selfUseAbsorbed || 0) + absorb;
        budgets.set(keyword, remaining - absorb);
      }
    }

    let hasDiff = false;
    for (const row of rows) {
      const { dxEntry } = row;
      const netDiff = row.diff - (row.selfUseAbsorbed || 0);
      if (netDiff !== 0 && !row.stockout) hasDiff = true;

      if (dxEntry) {
        // 鼎新同一品項常常分成好幾行登打（例如一行正常價、一行贈品0元），
        // 不能把它們混在一起算平均單價，要逐行各自跟正確價格比對；
        // 就算沒有價格資料（還沒上傳查核表），也要保留逐行的數量/單價明細給畫面照鼎新單顯示
        const cp = priceCtx && priceCtx.priceTable
          ? priceCtx_correctPrice(priceCtx, customer, row.itemCode, dateStr)
          : { price: null, source: null, promo: null };
        const isGiftNote = GIFT_NOTE_RE.test(row.lineNote);
        let selfUseLeft = row.selfUseAbsorbed || 0;
        const priceLines = (dxEntry.lines || []).map((l) => {
          let status = 'unknown';
          if (l.unitPrice === 0 && selfUseLeft > 0) { status = 'selfuse'; selfUseLeft -= l.qty; }
          else if (isGiftNote && l.unitPrice === 0) status = 'gift';
          else if (cp.price != null) status = l.unitPrice === cp.price ? 'ok' : 'diff';
          return { qty: l.qty, unitPrice: l.unitPrice, status };
        });
        row.priceLines = priceLines;
        row.correctPrice = cp.price;
        row.priceSource = cp.source;
        row.promo = cp.promo;
        row.priceStatus = priceLines.some((l) => l.status === 'diff') ? 'diff'
          : priceLines.some((l) => l.status === 'gift' || l.status === 'selfuse') ? 'gift'
          : priceLines.every((l) => l.status === 'ok') ? 'ok' : 'unknown';
      }
      delete row.dxEntry;
    }
    return { rows, hasDiff };
  }

  function priceCtx_correctPrice(priceCtx, customer, itemCode, dateStr) {
    return PriceTable.correctPrice(priceCtx.priceTable, priceCtx.promotions, customer, itemCode, dateStr, priceCtx.quoteMaster);
  }

  // 「一則LINE對話 = 一張鼎新單」：同店同天可能有多則對話、多張單，
  // 用品項重疊分數做貪婪配對，而不是把整天全部加總在一起比對
  function compareOrders(lineResolved, dingxinRows, dateFrom, dateTo, stockouts, priceCtx) {
    const inRange = (d) => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);

    const dxOrders = new Map(); // customer|date|orderNo -> {customer,date,orderNo,items:Map<code,{qty,lines:[{qty,unitPrice}]}>}
    for (const row of dingxinRows) {
      if (!row.date || !inRange(row.date) || !row.itemCode) continue;
      const key = `${row.customer}|${row.date}|${row.orderNo}`;
      if (!dxOrders.has(key)) dxOrders.set(key, { customer: row.customer, date: row.date, orderNo: row.orderNo, items: new Map() });
      const o = dxOrders.get(key);
      // 同品項可能分好幾行登打（例如一行正常價、一行贈品0元），逐行各自保留，不能混在一起算平均價
      const entry = o.items.get(row.itemCode) || { qty: 0, lines: [] };
      entry.qty += row.qty;
      entry.lines.push({ qty: row.qty, unitPrice: row.unitPrice });
      o.items.set(row.itemCode, entry);
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
      const itemMap = new Map(); // code -> {qty, notes:[]}
      const selfUseItems = []; // [{keyword, qty}]，keyword用來限制只能併進同類品項
      for (const it of block.items) {
        if (!it.itemCode) {
          // 「自用木屑」「活體苜蓿」這類品項鼎新不會另開品號，會併進同類品項的數量裡（標贈品）
          const m = /^(?:自用|活體){1,2}(.+)$/.exec(it.name);
          if (m) selfUseItems.push({ keyword: m[1], qty: it.qty });
          continue;
        }
        const entry = itemMap.get(it.itemCode) || { qty: 0, notes: [], lineNames: [] };
        entry.qty += it.qty;
        if (it.note) entry.notes.push(it.note);
        if (!entry.lineNames.includes(it.name)) entry.lineNames.push(it.name);
        itemMap.set(it.itemCode, entry);
      }
      if (!itemMap.size && !selfUseItems.length) continue;
      const k = `${block.customer}|${orderDate}`;
      if (!lineByStoreDate.has(k)) lineByStoreDate.set(k, []);
      lineByStoreDate.get(k).push({ block, itemMap, effectiveDate: orderDate, selfUseItems });
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
        const diff = buildDiffRows(lineList[p.i].itemMap, dxList[p.j].items, stockouts, customer, date, priceCtx, lineList[p.i].selfUseItems);
        results.push({
          customer, date, lineTime: lineList[p.i].block.time, lineDate: lineList[p.i].block.date, lineHeader: lineList[p.i].block.rawHeader,
          lineRawItems: lineList[p.i].block.items.map((it) => it.raw), lineNotes: lineList[p.i].block.notes,
          lineRawLines: lineList[p.i].block.rawLines,
          orderNo: dxList[p.j].orderNo, matched: true, ...diff
        });
      }
      for (let i = 0; i < lineList.length; i++) {
        if (usedLine.has(i)) continue;
        const diff = buildDiffRows(lineList[i].itemMap, new Map(), stockouts, customer, date, priceCtx, lineList[i].selfUseItems);
        results.push({
          customer, date, lineTime: lineList[i].block.time, lineDate: lineList[i].block.date, lineHeader: lineList[i].block.rawHeader,
          lineRawItems: lineList[i].block.items.map((it) => it.raw), lineNotes: lineList[i].block.notes,
          lineRawLines: lineList[i].block.rawLines,
          orderNo: null, matched: false, unmatchedSide: 'line', ...diff, hasDiff: true
        });
      }
      for (let j = 0; j < dxList.length; j++) {
        if (usedDx.has(j)) continue;
        const diff = buildDiffRows(new Map(), dxList[j].items, stockouts, customer, date, priceCtx);
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
