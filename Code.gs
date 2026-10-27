/**
 * =========================================================================
 * GOOGLE APPS SCRIPT - BACKEND PEMANTAU BERAT BADAN KELOMPOK (WEIGHT TRACKER)
 * =========================================================================
 * 
 * PANDUAN LENGKAP PEMASANGAN:
 * 1. Buka Google Sheets baru di browser Anda: https://sheets.new
 * 2. Beri nama Spreadsheet, misalnya: "Database Weight Tracker"
 * 3. Buka menu navigasi atas: Extensions (Ekstensi) > Apps Script
 * 4. Hapus seluruh kode bawaan yang ada di editor Apps Script
 * 5. Salin dan tempel (paste) seluruh kode file ini ke editor tersebut
 * 6. Klik ikon Disket / Save (Simpan)
 * 7. Klik tombol biru "Deploy" (Terapkan) di pojok kanan atas > pilih "New deployment" (Penerapan baru)
 * 8. Pada jendela popup yang muncul:
 *    - Klik ikon gerigi (Select type) di sebelah kiri > pilih "Web app" (Aplikasi Web)
 *    - Description: Weight Tracker Web API
 *    - Execute as (Jalankan sebagai): "Me" (email Google Anda)
 *    - Who has access (Siapa yang memiliki akses): "Anyone" (Siapa saja)  <-- PENTING! Harus "Anyone" agar web bisa kirim/terima data tanpa login Google akun pengguna lain.
 * 9. Klik "Deploy"
 * 10. Jika muncul peringatan izin (Authorization required), klik "Authorize access" > pilih akun Google Anda > klik "Advanced" > klik "Go to ... (unsafe)" > klik "Allow"
 * 11. Salin URL Web App yang berakhiran "/exec" (Contoh: https://script.google.com/macros/s/AKfycbx.../exec)
 * 12. Buka file `index.html` dan tempelkan URL tersebut ke variabel:
 *     const GOOGLE_SCRIPT_URL = "URL_APPS_SCRIPT_ANDA_DI_SINI";
 * =========================================================================
 */

// Nama tab/sheet yang digunakan untuk menyimpan data
const SHEET_NAME = "WeightData";

/**
 * Mendapatkan sheet target atau membuatnya otomatis jika belum ada
 */
function getSheetTarget() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    // Cek apakah sheet aktif pertama kosong
    const activeSheet = ss.getActiveSheet();
    if (activeSheet && activeSheet.getLastRow() === 0) {
      activeSheet.setName(SHEET_NAME);
      sheet = activeSheet;
    } else {
      sheet = ss.insertSheet(SHEET_NAME);
    }
    
    // Buat baris header otomatis
    const headers = ["ID", "Tanggal", "Nama", "Berat Badan (kg)", "Waktu Pencatatan"];
    sheet.appendRow(headers);
    
    // Format header dengan warna biru modern
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#2563EB");
    headerRange.setFontColor("#FFFFFF");
    headerRange.setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
  }
  
  return sheet;
}

/**
 * Menangani permintaan GET (Mengambil seluruh data riwayat berat badan)
 */
function doGet(e) {
  const lock = LockService.getScriptLock();
  // Kunci script selama maksimal 15 detik untuk menghindari race condition
  try {
    lock.waitLock(15000);
  } catch (err) {
    return createJsonResponse({
      status: "error",
      message: "Server sedang sibuk, coba beberapa saat lagi."
    });
  }

  try {
    const sheet = getSheetTarget();
    const data = sheet.getDataRange().getValues();

    // Jika hanya ada baris header atau kosong
    if (data.length <= 1) {
      return createJsonResponse({
        status: "success",
        total: 0,
        data: []
      });
    }

    const result = [];
    const timeZone = Session.getScriptTimeZone();

    // Loop data mulai dari baris ke-2 (index 1)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rawId = row[0];
      const rawDate = row[1];
      const rawName = row[2];
      const rawWeight = row[3];
      const rawTimestamp = row[4];

      // Lewati baris jika nama dan tanggal kosong
      if (!rawName && !rawDate) continue;

      // Format tanggal menjadi YYYY-MM-DD
      let formattedDate = "";
      if (rawDate instanceof Date) {
        formattedDate = Utilities.formatDate(rawDate, timeZone, "yyyy-MM-dd");
      } else if (rawDate) {
        formattedDate = String(rawDate).trim();
      }

      // Format waktu pencatatan
      let formattedTimestamp = "";
      if (rawTimestamp instanceof Date) {
        formattedTimestamp = Utilities.formatDate(rawTimestamp, timeZone, "yyyy-MM-dd HH:mm:ss");
      } else if (rawTimestamp) {
        formattedTimestamp = String(rawTimestamp).trim();
      }

      const weightNum = parseFloat(rawWeight);

      result.push({
        id: rawId || ("ROW-" + (i + 1)),
        tanggal: formattedDate,
        nama: String(rawName).trim(),
        berat: isNaN(weightNum) ? 0 : weightNum,
        waktuInput: formattedTimestamp
      });
    }

    return createJsonResponse({
      status: "success",
      total: result.length,
      data: result
    });

  } catch (error) {
    return createJsonResponse({
      status: "error",
      message: error.toString()
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Menangani permintaan POST (Menyimpan input berat badan baru)
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return createJsonResponse({
      status: "error",
      message: "Server sedang sibuk, silakan coba kirim ulang."
    });
  }

  try {
    let payload = {};

    // Parsing payload baik dari JSON body maupun URL Form Params
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (parseError) {
        payload = e.parameter || {};
      }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    const nama = (payload.nama || "").toString().trim();
    const tanggal = (payload.tanggal || "").toString().trim();
    const berat = parseFloat(payload.berat);

    // Validasi data input
    if (!nama || !tanggal || isNaN(berat) || berat <= 0) {
      return createJsonResponse({
        status: "error",
        message: "Data tidak valid: Nama, Tanggal, dan Berat Badan (angka positif) harus diisi!"
      });
    }

    const sheet = getSheetTarget();
    const timeZone = Session.getScriptTimeZone();
    const uniqueId = "WT-" + Utilities.getUuid().slice(0, 8).toUpperCase();
    const nowTimestamp = Utilities.formatDate(new Date(), timeZone, "yyyy-MM-dd HH:mm:ss");

    // Simpan data ke baris baru Google Sheets
    sheet.appendRow([uniqueId, tanggal, nama, berat, nowTimestamp]);

    return createJsonResponse({
      status: "success",
      message: "Data berat badan berhasil disimpan!",
      data: {
        id: uniqueId,
        tanggal: tanggal,
        nama: nama,
        berat: berat,
        waktuInput: nowTimestamp
      }
    });

  } catch (error) {
    return createJsonResponse({
      status: "error",
      message: "Gagal menyimpan data: " + error.toString()
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Helper untuk mengembalikan respons JSON dengan header CORS yang benar
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
