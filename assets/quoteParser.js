// 解析「momi報價單.xlsx」，補充客戶價格查核表沒有的新品項（例如飲水機）
// 只取第一個報價分頁（如 TF報價）當作品號→品名/到店價 的對照來源

const QuoteParser = (() => {
  function parse(workbook) {
    const sheetName = workbook.SheetNames[0];
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const out = new Map(); // itemCode -> {name, listPrice}
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const code = (row[2] || '').toString().trim();
      const name = (row[3] || '').toString().trim();
      if (!code || !name) continue;
      const price = Number(row[6]);
      if (!out.has(code)) out.set(code, { name, listPrice: isNaN(price) ? null : price });
    }
    return out;
  }

  return { parse };
})();
