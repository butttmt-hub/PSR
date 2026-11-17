/*
 * จุดเชื่อมระหว่างระบบ V2 (Sales Portal) กับ TMS (Transport Management System) — Prototype
 *
 * จำลองการส่งข้อมูลข้ามระบบด้วย "กล่องข้อความ" (message queue) เก็บใน localStorage ของเบราว์เซอร์:
 *   V2  → TMS : PS_CREATE (ส่ง Picking Slip ทั้งใบ + ข้อมูล S/O ที่เกี่ยวข้อง) / PS_DELETE (ยกเลิกใบ)
 *   TMS → V2  : ยังไม่ออกแบบ (เว้นว่างไว้ก่อน)
 *
 * ของจริงเปลี่ยนเป็น API / ไฟล์ / IDoc ได้โดยแก้เฉพาะไฟล์นี้ — หน้าจอของทั้งสองระบบไม่ต้องแก้
 */
(function (global) {
  'use strict';
  var KEY = 'tmt_interface_v2_to_tms';
  var MAX = 300;

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
  }
  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }

  global.TMSIF = {
    KEY: KEY,
    // ส่งข้อความเข้ากล่อง (V2 เรียก)
    send: function (type, payload, sentBy) {
      var list = read();
      var msg = {
        id: 'M' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: type,
        sentAt: new Date().toISOString(),
        sentBy: sentBy || '',
        payload: payload
      };
      list.push(msg);
      if (list.length > MAX) list = list.slice(-MAX);
      return write(list) ? msg : null;
    },
    list: read,
    // true ถ้า Picking Slip นี้เคยถูกส่งและยังไม่ถูกยกเลิก
    isSent: function (psNo) {
      var sent = false;
      read().forEach(function (m) {
        if (!m.payload) return;
        if (m.type === 'PS_CREATE' && m.payload.ps && m.payload.ps.psNo === psNo) sent = true;
        if (m.type === 'PS_DELETE' && m.payload.psNo === psNo) sent = false;
      });
      return sent;
    },
    // แจ้งเมื่อมีข้อความใหม่ (TMS ใช้ฟัง — ทำงานข้ามแท็บของเบราว์เซอร์เดียวกัน)
    onChange: function (cb) {
      window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === null) cb(); });
    }
  };
})(window);
