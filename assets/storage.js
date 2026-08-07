// localStorage 設定存取 + 匯出/匯入 JSON（讓多人共用同一份設定）

const Storage = (() => {
  const KEY = 'momi_check_config_v1';

  const DEFAULT_CONFIG = {
    excludedNames: ['Carlily', '嘉莉', 'Eva', '孫頌芝', '芝', 'Kiki', 'Winnie', 'Carlily文嘉莉', 'Kin黃嘉宸', '嘉宸Kin', '南高屏', '鳳容', '業務使用', '動物聊聊天', '摩米'],
    storeAliases: {}, // normStore(LINE店名) -> 鼎新客戶簡稱
    itemAliases: {},  // normItem(LINE品名) -> 鼎新品號
    promotions: []    // {id, store, scope, itemCode, discountType, value, startDate, endDate, note}
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULT_CONFIG);
      const parsed = JSON.parse(raw);
      return { ...structuredClone(DEFAULT_CONFIG), ...parsed };
    } catch (e) {
      console.error('讀取設定失敗', e);
      return structuredClone(DEFAULT_CONFIG);
    }
  }

  function save(config) {
    localStorage.setItem(KEY, JSON.stringify(config));
  }

  function exportJSON(config) {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `momi-check-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          resolve({ ...structuredClone(DEFAULT_CONFIG), ...parsed });
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  return { load, save, exportJSON, importJSON, DEFAULT_CONFIG };
})();
