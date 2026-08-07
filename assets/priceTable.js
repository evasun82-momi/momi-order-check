// 解析「客戶價格查核表.xlsm」的 各客戶產品價格 / 客戶名單 / 等級報價
// 並提供含檔期促銷的價格查詢邏輯

const PriceTable = (() => {
  function sheetRows(workbook, name) {
    const ws = workbook.Sheets[name];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { defval: null });
  }

  function build(workbook) {
    const customerProductRows = sheetRows(workbook, '各客戶產品價格');
    const customerRows = sheetRows(workbook, '客戶名單');
    const tierRows = sheetRows(workbook, '等級報價');

    const customerProductPrice = new Map(); // customer|itemCode -> price
    const productMaster = new Map(); // itemCode -> name
    for (const row of customerProductRows) {
      const customer = (row['客戶簡稱'] || '').toString().trim();
      const itemCode = (row['品號'] || '').toString().trim();
      const price = Number(row['進價']);
      if (!customer || !itemCode) continue;
      customerProductPrice.set(`${customer}|${itemCode}`, price);
      if (!productMaster.has(itemCode)) productMaster.set(itemCode, (row['產品名稱'] || '').toString().trim());
    }

    const customerTier = new Map(); // customer -> tier
    for (const row of customerRows) {
      const customer = (row['客戶簡稱'] || '').toString().trim();
      const tier = row['固定折扣'];
      if (!customer) continue;
      customerTier.set(customer, tier != null ? String(tier).trim() : null);
    }

    const tierPrice = new Map(); // tier|itemCode -> price
    for (const row of tierRows) {
      const tier = row['報價等級'] != null ? String(row['報價等級']).trim() : null;
      const itemCode = (row['產品代號'] || '').toString().trim();
      const price = Number(row['進價']);
      if (!tier || !itemCode) continue;
      tierPrice.set(`${tier}|${itemCode}`, price);
      if (!productMaster.has(itemCode)) productMaster.set(itemCode, (row['產品名稱'] || '').toString().trim());
    }

    return { customerProductPrice, customerTier, tierPrice, productMaster, customerList: [...customerTier.keys()] };
  }

  // basePrice: 客戶特定價 優先，其次用客戶折扣等級對應等級報價
  function basePrice(table, customer, itemCode) {
    const direct = table.customerProductPrice.get(`${customer}|${itemCode}`);
    if (direct != null && !isNaN(direct)) return { price: direct, source: '客戶特定價' };
    const tier = table.customerTier.get(customer);
    if (tier) {
      const tp = table.tierPrice.get(`${tier}|${itemCode}`);
      if (tp != null && !isNaN(tp)) return { price: tp, source: `等級報價(${tier}折)` };
    }
    return { price: null, source: null };
  }

  function findActivePromo(promotions, customer, itemCode, dateStr) {
    if (!dateStr) return null;
    return promotions.find((p) => {
      if (p.store !== customer) return false;
      if (p.scope === 'item' && p.itemCode !== itemCode) return false;
      if (p.startDate && dateStr < p.startDate) return false;
      if (p.endDate && dateStr > p.endDate) return false;
      return true;
    }) || null;
  }

  function applyPromo(price, promo) {
    if (price == null) return price;
    if (promo.discountType === 'percent') {
      return Math.round(price * (Number(promo.value) / 100));
    }
    return Number(promo.value);
  }

  function correctPrice(table, promotions, customer, itemCode, dateStr) {
    const base = basePrice(table, customer, itemCode);
    if (base.price == null) return { price: null, source: null, promo: null };
    const promo = findActivePromo(promotions, customer, itemCode, dateStr);
    if (promo) {
      return { price: applyPromo(base.price, promo), source: base.source, promo };
    }
    return { price: base.price, source: base.source, promo: null };
  }

  return { build, basePrice, correctPrice, findActivePromo };
})();
