// 解析 LINE 匯出 txt，切成「店家訂單區塊」
// 設計原則：寧可標示「待確認」也不要靜默猜錯，方便人工review。

const LineParser = (() => {
  const DATE_RE = /^(\d{4})[.\/](\d{2})[.\/](\d{2})/;
  const TIME_RE = /^(\d{1,2}):(\d{2})\s*(.*)$/;
  const RECALL_TEXT = '已收回訊息';
  const INTERNAL_MARKER_RE = /以下分單不回總公司/;
  const ATTACHMENT_RE = /\.(pdf|jpg|jpeg|png|heic)$/i;

  const NOTE_LINE_PATTERNS = [
    /^倉[庫別]/, /^PO/i, /^P[OD]\d/i, /^ST\d/i, /^AT\d/i,
    /^地址/, /^電話/, /^姓名/, /^代寄/, /^統編/, /^備註/, /^隨貨/,
    /^新展店/, /^進貨/, /^外箱/, /^贈品/, /^驗收/, /^麥頭/, /^請/, /^附/,
    /^\d+\.[^\d]*\d*$/ // 編號清單但沒有明確分隔符的，交給人工看
  ];

  function normSpace(s) {
    return s.replace(/\s+/g, ' ').trim();
  }

  function tryParseHeader(rawLine, excludedNames) {
    const line = rawLine.replace(/^﻿/, '').trim();
    if (!line) return null;
    const m = TIME_RE.exec(line);
    if (!m) return null;
    const [, hh, mm, rest] = m;
    const restTrim = rest.trim();
    if (!restTrim) return null;

    if (restTrim.startsWith(RECALL_TEXT)) {
      return { time: `${hh.padStart(2, '0')}:${mm}`, isHeader: true, recalled: true, raw: line };
    }

    const head = restTrim.slice(0, 16);
    if (!/MOMI|摩米/.test(head)) return null; // 不含MOMI標籤，視為一般訊息行，不是新區塊

    let content = restTrim.replace(/^[￥$]?\s*(MOMI\S*|摩米\S*)\s*/, '').trim();
    const recalled = content.endsWith(RECALL_TEXT);
    if (recalled) content = content.slice(0, content.length - RECALL_TEXT.length).trim();

    const { storeName, orderRefs, skip, cutoffMarker } = extractStoreName(content, excludedNames);

    return {
      time: `${hh.padStart(2, '0')}:${mm}`,
      isHeader: true,
      recalled,
      raw: line,
      rawContent: content,
      storeNameRaw: storeName,
      orderRefs,
      skip,
      cutoffMarker
    };
  }

  // 移除業務員/暱稱名單後，取出店家名稱
  function extractStoreName(content, excludedNames) {
    // 純附件訊息（照片/pdf檔名）直接跳過，不當作店家
    if (ATTACHMENT_RE.test(content.trim()) || content.trim() === '圖片' || content.trim() === '影片') {
      return { storeName: null, orderRefs: [], skip: true };
    }

    let s = content;
    // 去掉常見括號註記，例如（急）、〔兩張單〕、【備註】
    s = s.replace(/[（(][^）)]*[）)]/g, ' ');
    s = s.replace(/[〔【\[][^〕】\]]*[〕】\]]/g, ' ');

    const names = [...excludedNames].sort((a, b) => b.length - a.length); // 長的先比對，避免留下殘字
    for (const n of names) {
      if (!n) continue;
      s = s.split(n).join(' ');
    }
    // 去掉「急）」「退單）」「追加）」這種只有右括號的口語標記（名單清除後才會浮現到開頭/字詞間）
    s = s.replace(/(^|\s)[^\s（）、,，]{1,6}[）)](\s|$)/g, ' ');
    // 清掉常見連接符號/贅字
    s = s.replace(/[｜|・.,，、\-]+/g, ' ');
    s = normSpace(s);

    // 助理常打的截止線，例如「8/6早----」「8/10-----------------早」，用來標記當天訂單的分界
    // （這條線出現「之前」累積的訊息，都算線上寫的那個日期）
    const cutoffMatch = /^(\d{1,2})\/(\d{1,2})\s*[早午晚夜]?$/.exec(s);
    if (cutoffMatch) {
      return { storeName: null, orderRefs: [], skip: true, cutoffMarker: { month: Number(cutoffMatch[1]), day: Number(cutoffMatch[2]) } };
    }

    if (!s || s === '圖片' || s === '影片' || ATTACHMENT_RE.test(s) || /^-+$/.test(s)) {
      return { storeName: null, orderRefs: [], skip: true };
    }

    // 拆出可能的單號（逗號分隔，或黏在店名尾端的英數字訂單碼/附件檔名）
    let main = s;
    const orderRefs = [];
    const commaSplit = main.split(/[,，]/);
    if (commaSplit.length > 1) {
      main = commaSplit[0].trim();
      for (let i = 1; i < commaSplit.length; i++) {
        const t = commaSplit[i].trim();
        if (t) orderRefs.push(t);
      }
    }
    const tailAttachMatch = /^(.*?)\s*([A-Za-z]{1,4}\d{6,}[A-Za-z0-9]*)\s*(pdf|jpg|jpeg|png)?$/i.exec(main);
    if (tailAttachMatch && tailAttachMatch[1].trim() && (tailAttachMatch[2] || tailAttachMatch[3])) {
      orderRefs.unshift(tailAttachMatch[2]);
      main = tailAttachMatch[1].trim();
    }
    const tailLabeledNo = /^(.*?)\s*單號[:：]?\s*\d+$/.exec(main);
    if (tailLabeledNo && tailLabeledNo[1].trim()) {
      main = tailLabeledNo[1].trim();
    } else {
      const tailBareNo = /^(.*?)\s+(\d{5,})$/.exec(main);
      if (tailBareNo && tailBareNo[1].trim()) {
        orderRefs.push(tailBareNo[2]);
        main = tailBareNo[1].trim();
      }
    }
    main = normSpace(main);
    if (!main) return { storeName: null, orderRefs, skip: true };
    return { storeName: main, orderRefs, skip: false };
  }

  function parseItemLine(rawLine) {
    const raw = rawLine.trim();
    if (!raw) return null;
    if (INTERNAL_MARKER_RE.test(raw)) return { type: 'marker_internal_split', raw };
    if (/^-+$/.test(raw)) return null;
    for (const pat of NOTE_LINE_PATTERNS) {
      if (pat.test(raw)) return { type: 'note', raw };
    }

    let main = raw, note = '';
    const commaIdx = raw.search(/[,，]/);
    if (commaIdx > -1) {
      main = raw.slice(0, commaIdx).trim();
      note = raw.slice(commaIdx + 1).trim();
    }
    if (!main) return { type: 'note', raw };

    // 優先找明確分隔符 (* × x X) + 數量。分隔符後面如果還有字（例如「大顆粒10Lx16 送3」的
    // 「送3」是贈品備註，不是主要數量），要併進備註，不能被誤判成主要數量。
    let name, qty;
    const sepMatch = /^(.*?)[\s]*[\*×xX][\s]*([0-9]+(?:\.[0-9]+)?)(.*)$/.exec(main);
    if (sepMatch && sepMatch[1].trim()) {
      name = sepMatch[1].trim();
      qty = parseFloat(sepMatch[2]);
      const trailing = sepMatch[3].trim();
      if (trailing) note = note ? `${trailing}，${note}` : trailing;
    } else {
      // 找字串裡最後一個數字當作數量
      const lastNumMatch = /^(.*?)([0-9]+(?:\.[0-9]+)?)([^\d]*)$/.exec(main);
      if (lastNumMatch && lastNumMatch[1].trim()) {
        name = (lastNumMatch[1] + (lastNumMatch[3] || '')).trim();
        qty = parseFloat(lastNumMatch[2]);
      }
    }

    if (!name || isNaN(qty)) return { type: 'note', raw };
    return { type: 'item', raw, name, qty, note };
  }

  function parse(text, excludedNames) {
    const lines = text.split(/\r?\n/);
    const blocks = [];
    let pendingBlocks = []; // 還沒遇到截止線的區塊，遇到線之後回頭蓋上那條線寫的日期
    let currentDate = null;
    let currentBlock = null;
    let internalMode = false;

    function pushBlock() {
      if (currentBlock && currentBlock.items.length > 0) pendingBlocks.push(currentBlock);
      currentBlock = null;
      internalMode = false;
    }

    for (const rawLine of lines) {
      const line = rawLine.replace(/^﻿/, '');
      const trimmed = line.trim();
      if (!trimmed) continue;

      const dm = DATE_RE.exec(trimmed);
      if (dm) {
        pushBlock();
        currentDate = `${dm[1]}-${dm[2]}-${dm[3]}`;
        continue;
      }

      const header = tryParseHeader(trimmed, excludedNames);
      if (header) {
        if (header.recalled) {
          // 整則訊息被收回：不開新區塊，若正好是剛開的區塊的收回也直接捨棄
          pushBlock();
          continue;
        }
        pushBlock();
        if (header.cutoffMarker) {
          // 截止線「之前」累積的區塊都算這條線出現當下的日曆日期（不是線上寫的數字，
          // 線上的數字似乎是配送日之類的另一個意思，不是訂單歸屬日）
          for (const b of pendingBlocks) {
            b.businessDateOverride = currentDate;
            blocks.push(b);
          }
          pendingBlocks = [];
          currentBlock = null;
          continue;
        }
        if (header.skip || !header.storeNameRaw) {
          currentBlock = null;
          continue;
        }
        currentBlock = {
          id: `${currentDate || 'unknown'}_${header.time}_${blocks.length + pendingBlocks.length}`,
          date: currentDate,
          time: header.time,
          businessDateOverride: null,
          storeNameRaw: header.storeNameRaw,
          orderRefs: header.orderRefs,
          rawHeader: header.raw,
          items: [],
          notes: [],
          unparsed: []
        };
        continue;
      }

      if (!currentBlock) continue; // 目前沒有開啟中的訂單區塊，忽略雜訊行

      const parsedItem = parseItemLine(trimmed);
      if (!parsedItem) continue;
      if (parsedItem.type === 'marker_internal_split') {
        internalMode = true;
        continue;
      }
      if (parsedItem.type === 'note') {
        currentBlock.notes.push(parsedItem.raw);
        continue;
      }
      currentBlock.items.push({
        raw: parsedItem.raw,
        name: parsedItem.name,
        qty: parsedItem.qty,
        note: parsedItem.note,
        internalOnly: internalMode
      });
    }
    pushBlock();
    // 檔案結束時還沒遇到下一條截止線的區塊，沒有依據可蓋日期，就照原本的日曆日期留著
    for (const b of pendingBlocks) blocks.push(b);
    return blocks;
  }

  return { parse, tryParseHeader, extractStoreName, parseItemLine };
})();
