/**
 * VINTIQQ → Google Sheets order collector
 *
 * 1. Create/open the Google Sheet where you want orders stored.
 * 2. Extensions → Apps Script.
 * 3. Paste this file into Code.gs.
 * 4. Replace SHEET_NAME and SHARED_SECRET.
 * 5. Deploy → New deployment → Web app.
 *    Execute as: Me
 *    Who has access: Anyone
 * 6. Copy the /exec URL into GOOGLE_SHEETS_WEBHOOK_URL in your server .env.
 *
 * Google documents that web apps can expose doPost(e) and be deployed from the Deploy menu.
 */
const SHEET_NAME = 'Orders';
const SHARED_SECRET = 'REPLACE_WITH_THE_SAME_LONG_RANDOM_SECRET_AS_SERVER';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || '{}');
    if (data.secret !== SHARED_SECRET) {
      return json({ ok: false, error: 'Unauthorized' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

    const headers = [
      'Timestamp', 'Order ID', 'Payment ID', 'Status', 'Product', 'Colour',
      'Amount', 'Currency', 'Name', 'Phone', 'Email', 'Address', 'City',
      'State', 'PIN', 'Delivery', 'Shipping'
    ];

    if (sheet.getLastRow() === 0) sheet.appendRow(headers);

    // Avoid duplicate rows if the verification endpoint retries.
    if (data.order_id && sheet.getLastRow() > 1) {
      const ids = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().flat();
      if (ids.includes(data.order_id)) return json({ ok: true, duplicate: true });
    }

    sheet.appendRow([
      new Date(), data.order_id || '', data.payment_id || '', data.status || '',
      data.product || '', data.color || '', data.amount || '', data.currency || '',
      data.name || '', data.phone || '', data.email || '', data.address || '',
      data.city || '', data.state || '', data.pin || '', data.delivery || '2–3 weeks',
      data.shipping || 'FREE'
    ]);

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json({ ok: true, service: 'VINTIQQ Orders' });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

