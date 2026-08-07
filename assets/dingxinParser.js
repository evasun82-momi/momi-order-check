// 解析鼎新匯出的「銷退貨明細表」.xlsx

const DingxinParser = (() => {
  const HEADER_MAP = {
    '日期': 'date', '單號': 'orderNo', '客戶簡稱': 'customer', '業務員': 'salesperson',
    '品號': 'itemCode', '品名': 'itemName', '倉庫': 'warehouse', '數量': 'qty',
    '單位': 'unit', '單價': 'unitPrice', '金額': 'amount', '未稅金額': 'amountNoTax',
    '稅額': 'tax', '訂單單號': 'refOrderNo'
  };

  function excelDateToISO(v) {
    if (v instanceof Date) {
      return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    }
    if (typeof v === 'string') {
      const m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/.exec(v.trim());
      if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    }
    if (typeof v === 'number') {
      const d = XLSX.SSF.parse_date_code(v);
      if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
    return null;
  }

  function parse(workbook) {
    const sheetName = workbook.SheetNames[0];
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    if (!rows.length) return [];
    const headerRow = rows[0].map((h) => (h || '').toString().trim());
    const colIdx = {};
    headerRow.forEach((h, i) => {
      if (HEADER_MAP[h]) colIdx[HEADER_MAP[h]] = i;
    });

    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((c) => c === null || c === '')) continue;
      const get = (key) => (colIdx[key] !== undefined ? row[colIdx[key]] : null);
      const rawDate = get('date');
      const date = excelDateToISO(rawDate);
      const orderNo = get('orderNo');
      if (!orderNo && !get('customer')) continue;
      out.push({
        date,
        orderNo: orderNo ? String(orderNo).trim() : null,
        customer: (get('customer') || '').toString().trim(),
        salesperson: (get('salesperson') || '').toString().trim(),
        itemCode: (get('itemCode') || '').toString().trim(),
        itemName: (get('itemName') || '').toString().trim(),
        warehouse: get('warehouse'),
        qty: Number(get('qty')) || 0,
        unit: get('unit'),
        unitPrice: Number(get('unitPrice')) || 0,
        amount: Number(get('amount')) || 0,
        isReturn: orderNo && String(orderNo).trim().startsWith('退')
      });
    }
    return out;
  }

  return { parse };
})();
