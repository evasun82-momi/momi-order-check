// 解析「客戶資料」主檔 .xlsx，取得完整客戶簡稱清單（不受限於當天有出貨的客戶）

const CustomerParser = (() => {
  function parse(workbook) {
    const sheetName = workbook.SheetNames[0];
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
    const out = [];
    for (const row of rows) {
      const name = (row['客戶簡稱'] || '').toString().trim();
      if (!name) continue;
      out.push({
        code: (row['客戶代號'] || '').toString().trim(),
        name,
        type: row['客戶類型'] || null,
        address: row['送貨地址'] || null
      });
    }
    return out;
  }

  return { parse };
})();
