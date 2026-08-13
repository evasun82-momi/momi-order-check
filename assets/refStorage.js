// 三個「固定但不定期更新」的參考資料檔（客戶價格查核表/客戶資料表/商品報價單）
// 上傳一次後存在瀏覽器 localStorage，下次開啟頁面自動帶入，不用每次重選

const RefStorage = (() => {
  const KEYS = {
    price: 'momi_ref_price_v1',
    customer: 'momi_ref_customer_v1',
    quote: 'momi_ref_quote_v1',
    stockMaster: 'momi_ref_stockmaster_v1'
  };

  function mapToArr(m) { return [...m.entries()]; }
  function arrToMap(a) { return new Map(a || []); }

  function savePrice(priceTable, fileName) {
    const payload = {
      fileName,
      uploadedAt: new Date().toISOString(),
      customerProductPrice: mapToArr(priceTable.customerProductPrice),
      customerTier: mapToArr(priceTable.customerTier),
      tierPrice: mapToArr(priceTable.tierPrice),
      productMaster: mapToArr(priceTable.productMaster),
      customerList: priceTable.customerList
    };
    localStorage.setItem(KEYS.price, JSON.stringify(payload));
  }

  function loadPrice() {
    const raw = localStorage.getItem(KEYS.price);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return {
      meta: { fileName: p.fileName, uploadedAt: p.uploadedAt },
      priceTable: {
        customerProductPrice: arrToMap(p.customerProductPrice),
        customerTier: arrToMap(p.customerTier),
        tierPrice: arrToMap(p.tierPrice),
        productMaster: arrToMap(p.productMaster),
        customerList: p.customerList || []
      }
    };
  }

  function saveCustomer(customerMaster, fileName) {
    localStorage.setItem(KEYS.customer, JSON.stringify({
      fileName, uploadedAt: new Date().toISOString(), data: customerMaster
    }));
  }

  function loadCustomer() {
    const raw = localStorage.getItem(KEYS.customer);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return { meta: { fileName: p.fileName, uploadedAt: p.uploadedAt }, customerMaster: p.data || [] };
  }

  function saveQuote(quoteMaster, fileName) {
    localStorage.setItem(KEYS.quote, JSON.stringify({
      fileName, uploadedAt: new Date().toISOString(), data: mapToArr(quoteMaster)
    }));
  }

  function loadQuote() {
    const raw = localStorage.getItem(KEYS.quote);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return { meta: { fileName: p.fileName, uploadedAt: p.uploadedAt }, quoteMaster: arrToMap(p.data) };
  }

  function saveStockMaster(stockMaster, fileName) {
    localStorage.setItem(KEYS.stockMaster, JSON.stringify({
      fileName, uploadedAt: new Date().toISOString(), data: mapToArr(stockMaster)
    }));
  }

  function loadStockMaster() {
    const raw = localStorage.getItem(KEYS.stockMaster);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return { meta: { fileName: p.fileName, uploadedAt: p.uploadedAt }, stockMaster: arrToMap(p.data) };
  }

  function clear(kind) {
    if (KEYS[kind]) localStorage.removeItem(KEYS[kind]);
  }

  function formatMeta(meta) {
    if (!meta) return '';
    const d = new Date(meta.uploadedAt);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `上次上傳：${meta.fileName}（${ds}）`;
  }

  return { savePrice, loadPrice, saveCustomer, loadCustomer, saveQuote, loadQuote, saveStockMaster, loadStockMaster, clear, formatMeta };
})();
