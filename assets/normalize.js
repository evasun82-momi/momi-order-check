// 共用的文字正規化工具：店名 / 品名 用來做別名對照比對

const Normalize = (() => {
  // 分店常用「永1/永一」「板2/板二」這種阿拉伯數字/中文數字混用，統一轉中文數字再比對
  const STORE_NUM_MAP = { '1': '一', '2': '二', '3': '三', '4': '四', '5': '五' };
  function normStore(s) {
    if (!s) return '';
    return s
      .replace(/[1-5]/g, (d) => STORE_NUM_MAP[d])
      .replace(/\s+/g, '')
      .replace(/[-－—_]/g, '')
      .replace(/店$/g, '')
      .replace(/分店$/g, '')
      .toUpperCase();
  }

  function normItem(s) {
    if (!s) return '';
    let t = s.replace(/\s+/g, '').toUpperCase();
    t = t.replace(/公斤/g, 'KG').replace(/公克|克/g, 'G').replace(/公升/g, 'L');
    t = t.replace(/KGS?\b/g, 'KG');
    // 打字連續重複的中文字視為手誤，例如「提摩西草草磚」→「提摩西草磚」
    t = t.replace(/([一-鿿])\1+/g, '$1');
    return t;
  }

  // 鼎新品名常寫成「摩米美國特級第二割提摩西草0.5公斤|500克|18oz」多種規格用 | 分隔，
  // 且常見「摩米營養全成兔T(5公斤裝)」這類「品牌+動物代號+型號字母+規格」寫法，
  // 但LINE只會簡寫成「成兔5kg」。這裡盡量去掉品牌贅字與型號字母，讓兩邊比對得起來。
  // 「木刨花」故意不放進來去除：那是LINE實際會用的關鍵字（如「小刨花」），
  // 之前誤刪過導致美麗多刨花系列比對不到，這裡留著提醒不要再犯
  const FILLER_WORDS = ['摩米', '美國', '特級', '提摩西草', '裝', '第', '營養全', '護極幼', '小食', '凍乾', '木質墊料', '天然純萃', '實驗室無塵', '卡莉寵物', '標準版'];
  // 飲水機色號跟LINE簡寫的顏色字不一樣，直接做同義詞轉換
  const COLOR_SYNONYMS = [['蘇菲白', '白'], ['蘇菲亞啡', '咖'], ['琳達绿', '綠'], ['琳達綠', '綠']];
  function normItemForMatch(rawS) {
    if (!rawS) return '';
    const s = rawS.replace(/㇐/g, '一'); // 表格裡混用了CJK筆畫字元㇐當作「一」，先統一
    let t = s.split('|')[0];
    t = t.replace(/[()（）]/g, '');
    for (const w of FILLER_WORDS) t = t.split(w).join('');
    for (const [from, to] of COLOR_SYNONYMS) t = t.split(from).join(to);
    t = t.replace(/[/\\\-－—_]/g, ''); // 分隔符號不影響語意，比對前先去掉
    // 「一割/二割」是關鍵字，若被 FILLER_WORDS 誤刪要補回：從原字串偵測
    const cut = /第?[一二]割/.exec(s);
    if (cut && !/[一二]割/.test(t)) t = cut[0].replace('第', '') + t;
    t = normItem(t);
    // 去掉緊接在數字前的型號字母，例如「成兔T5KG」→「成兔5KG」
    t = t.replace(/[A-Z]{1,2}(?=\d)/g, '');
    return t;
  }

  // 兩字串的簡易相似度 (0~1)，用 bigram Dice 係數
  function similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const bigrams = (s) => {
      const arr = [];
      for (let i = 0; i < s.length - 1; i++) arr.push(s.slice(i, i + 2));
      return arr;
    };
    const A = bigrams(a), B = bigrams(b);
    let diceScore;
    if (!A.length || !B.length) {
      diceScore = a.includes(b) || b.includes(a) ? 0.5 : 0;
    } else {
      const setB = [...B];
      let hits = 0;
      for (const g of A) {
        const idx = setB.indexOf(g);
        if (idx > -1) { hits++; setB.splice(idx, 1); }
      }
      diceScore = (2 * hits) / (A.length + B.length);
    }
    // LINE常用極短的關鍵字（如「蘋果」）對應很長的正式品名，字數比例會拉低Dice分數，
    // 但只要完整被包含在對方字串裡，就給予較高的基礎分數
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    if (shorter.length >= 2 && longer.includes(shorter)) {
      diceScore = Math.max(diceScore, 0.75);
    }
    return diceScore;
  }

  // 取出品項字串中的規格數字+單位，例如「美麗多木質墊料(大顆粒)-10L」→ {value:10, unit:'L'}
  function extractSize(s) {
    const t = normItem(s);
    const m = /([0-9]+(?:\.[0-9]+)?)\s*(KG|G|L)(?!\w)/.exec(t);
    return m ? { value: parseFloat(m[1]), unit: m[2] } : null;
  }

  function sizeMismatch(targetRaw, candidateRaw) {
    const a = extractSize(targetRaw);
    const b = extractSize(candidateRaw);
    if (!a || !b) return false; // 任一方沒有規格資訊，不判斷
    if (a.unit !== b.unit) return true;
    return Math.abs(a.value - b.value) > 1e-9;
  }

  function bestMatch(target, candidates, minScore = 0.5) {
    let best = null, bestScore = 0;
    for (const c of candidates) {
      const sc = similarity(target, c.key);
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    if (best && bestScore >= minScore) return { ...best, score: bestScore };
    return null;
  }

  return { normStore, normItem, normItemForMatch, similarity, bestMatch, extractSize, sizeMismatch };
})();
