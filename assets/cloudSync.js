// 用 Firebase Realtime Database 做團隊共享設定同步（排除名單/店家品項對照/檔期促銷/缺貨品項）。
// 還沒填好下面的 FIREBASE_CONFIG 之前，會自動略過、只用瀏覽器本機儲存（跟以前一樣，不影響原本功能）。
const CloudSync = (() => {
  // 到 Firebase 主控台建好專案、開通 Realtime Database 後，
  // 「專案設定 -> 一般 -> 你的應用程式 -> SDK設定和程式碼」複製貼上這幾個值即可
  const FIREBASE_CONFIG = {
    apiKey: '',
    authDomain: '',
    databaseURL: '',
    projectId: ''
  };
  const CONFIG_PATH = 'momiCheckConfig';

  let db = null;
  let enabled = false;

  function init() {
    if (!FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.databaseURL) return false;
    if (typeof firebase === 'undefined') return false;
    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.database();
      enabled = true;
    } catch (e) {
      console.error('Firebase 初始化失敗，改用瀏覽器本機儲存', e);
      enabled = false;
    }
    return enabled;
  }

  function isEnabled() { return enabled; }

  // 把整份設定寫上雲端，讓其他人（其他裝置）打開網頁時能拿到同一份
  function push(config) {
    if (!enabled) return;
    db.ref(CONFIG_PATH).set(config).catch((e) => console.error('雲端同步失敗', e));
  }

  // 一次性抓一份雲端目前的設定（開啟頁面時用）
  function pull() {
    if (!enabled) return Promise.resolve(null);
    return db.ref(CONFIG_PATH).get()
      .then((snap) => (snap.exists() ? snap.val() : null))
      .catch((e) => { console.error('讀取雲端設定失敗', e); return null; });
  }

  // 訂閱雲端變化：只要有人（包含自己其他分頁/裝置）改了設定，馬上收到最新版本
  function onChange(cb) {
    if (!enabled) return;
    db.ref(CONFIG_PATH).on('value', (snap) => {
      if (snap.exists()) cb(snap.val());
    });
  }

  return { init, isEnabled, push, pull, onChange };
})();
