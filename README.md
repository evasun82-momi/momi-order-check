# 摩米 LINE 訂單 × 鼎新銷貨 比對工具

純前端網頁工具，用來把 LINE 群組的下單紀錄跟鼎新開立的銷貨明細互相比對，並檢查價格是否正確（含檔期促銷）。

**所有檔案都只在你自己的瀏覽器裡處理，不會上傳到任何伺服器。**

## 線上使用

部署到 GitHub Pages 後，開啟這個網址就能用（見下方部署步驟），不用安裝任何東西，同事間分享同一個網址即可。

## 本機使用（不部署也可以）

直接用瀏覽器開啟 `index.html` 即可（部分瀏覽器對 `file://` 有安全限制，若打不開，可用任一種本機伺服器，例如在此資料夾執行 `python -m http.server 8000` 後開啟 `http://localhost:8000`）。

## 功能

- 上傳鼎新「銷退貨明細表」Excel、LINE 匯出的 txt、以及「客戶價格查核表」xlsm
- 解析 LINE 訊息，自動排除業務員/暱稱，取出店家名稱與訂購品項
- 店家、品項自動比對鼎新資料，抓不到的會列在「待對照」清單，選一次之後永久記住
- 訂單比對：以 LINE 為準，跟鼎新明細比對數量差異
- 價格比對：核對鼎新登打單價跟正確售價（含檔期促銷折扣/指定價）是否一致，可匯出 Excel
- 所有設定（排除名單、對照表、促銷）存在瀏覽器 localStorage，也可以匯出/匯入 JSON 跟同事共用同一份設定

## 部署到 GitHub Pages（免費）

1. 到 GitHub 建立一個新的 repository（例如 `momi-order-check`），設為 Public。
2. 把這個資料夾整個 push 上去：
   ```bash
   git remote add origin https://github.com/<你的帳號>/momi-order-check.git
   git branch -M main
   git push -u origin main
   ```
3. 到 repo 的 Settings → Pages，Source 選擇 `Deploy from a branch`，Branch 選 `main` / `/ (root)`，儲存。
4. 等 1-2 分鐘，網址會是 `https://<你的帳號>.github.io/momi-order-check/`，分享給同事即可使用。

## 已知限制

LINE 聊天紀錄格式非常不規律（業務員手動打字、格式每天都不太一樣），解析邏輯是「盡量猜、猜不準就交給人工確認」，不是 100% 全自動。第一次使用時「店家/品項對照」頁簽會出現比較多待確認項目，選過一次之後系統會記住，之後同樣的簡寫就會自動比對成功，使用越久會越準。
