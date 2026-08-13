// 解析「多倉庫存表.xlsx」，目前只有品號/品名/單位（沒有實際庫存數量），
// 但品項涵蓋範圍比查核表/報價單完整很多，拿來當作最準確的商品中文名來源

const StockMasterParser = (() => {
  function parse(workbook) {
    const sheetName = workbook.SheetNames[0];
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
    const out = new Map(); // itemCode -> {name, unit}
    for (const row of rows) {
      const code = (row['品號'] || '').toString().trim();
      const name = (row['品名'] || '').toString().trim();
      if (!code || !name) continue;
      out.set(code, { name, unit: row['單位'] || null });
    }
    return out;
  }

  return { parse };
})();
