/*
 * Firebase web config — ค่าเหล่านี้เปิดเผยได้ ไม่ใช่ความลับ
 * ความปลอดภัยของข้อมูลอยู่ที่ Firestore Security Rules (ดู firestore.rules) และ Firebase Authentication
 */
window.TMT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCaMxH0lkbRQqyVu_yp5o8YLfMsWvgWPu8",
  authDomain: "tmt-presale-pilot.firebaseapp.com",
  projectId: "tmt-presale-pilot",
  storageBucket: "tmt-presale-pilot.firebasestorage.app",
  messagingSenderId: "505026601737",
  appId: "1:505026601737:web:84193d85a4f9dc0c1ea9d8"
};

// ผู้ใช้พิมพ์แค่ username (เช่น Sale01) ระบบจะต่อท้ายเป็นอีเมลนี้ให้อัตโนมัติ
// ถ้าพิมพ์อีเมลเต็ม (มี @) จะใช้ตามที่พิมพ์
window.TMT_LOGIN_DOMAIN = "pilot.tmt";

// เอกสาร Firestore จำกัด 1 MiB — เผื่อไว้ให้ไม่เกินนี้ (ไบต์)
window.TMT_MAX_DOC_BYTES = 900000;
