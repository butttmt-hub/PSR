/*
 * จุดเชื่อมระหว่างระบบ TMS กับ WMS (Warehouse Management System) — Prototype
 *
 * จำลองการส่งข้อมูลข้ามระบบด้วย "กล่องข้อความ" เก็บใน localStorage (อยู่ในวงเดียวกัน = เบราว์เซอร์เดียวกัน):
 *   TMS → WMS : SHIPMENT_UPSERT (สร้าง/แก้ Shipment + Picking Slip ในนั้น) / SHIPMENT_DELETE (ลบ Shipment)
 *   WMS → TMS : ยังไม่ออกแบบ
 *
 * ของจริงเปลี่ยนเป็น API / ไฟล์ได้โดยแก้เฉพาะไฟล์นี้ — หน้าจอของทั้งสองระบบไม่ต้องแก้
 */
(function (global) {
  'use strict';
  var KEY = 'tmt_interface_tms_to_wms';
  var MAX = 300;

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function write(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; } }
  function readLS(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }

  // จุดส่ง = Ship to Name เดียวกัน (ใบที่ไม่มีชื่อ Ship to ไม่ถูกรวม)
  function stopKey(o) {
    var n = ((o.summary && o.summary.shipName) || '').trim().toLowerCase();
    return n ? 'N:' + n : 'P:' + o.psNo;
  }

  global.WMSIF = {
    KEY: KEY,
    send: function (type, payload, sentBy) {
      var list = read();
      var msg = {
        id: 'W' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: type, sentAt: new Date().toISOString(), sentBy: sentBy || '', payload: payload
      };
      list.push(msg);
      if (list.length > MAX) list = list.slice(-MAX);
      return write(list) ? msg : null;
    },
    list: read,
    isSent: function (shipNo) {
      var sent = false;
      read().forEach(function (m) {
        if (!m.payload) return;
        if (m.type === 'SHIPMENT_UPSERT' && m.payload.shipment && m.payload.shipment.shipNo === shipNo) sent = true;
        if (m.type === 'SHIPMENT_DELETE' && m.payload.shipNo === shipNo) sent = false;
      });
      return sent;
    },
    // แปลง Shipment (ของ TMS) เป็นข้อมูลที่ส่งให้ WMS: หัว Shipment + จุดส่งเรียงลำดับ + Picking Slip/รายการสินค้า + ข้อมูลใบเต็ม (ไว้เปิดดูฟอร์ม)
    buildShipmentPayload: function (ship, orders) {
      var items = (ship.psNos || []).map(function (n) { return orders.filter(function (o) { return o.psNo === n; })[0]; }).filter(Boolean);
      var stop = 0, prev = null, stops = [], psData = {};
      items.forEach(function (o) {
        var k = stopKey(o); if (k !== prev) { stop++; prev = k; }
        var s = o.summary || {}, ps = (o.payload && o.payload.ps) || {};
        stops.push({
          stop: stop, psNo: o.psNo, customer: s.customer || '', shipName: s.shipName || '', district: s.district || '', province: s.province || '',
          deliveryDate: s.deliveryDate || '', doNos: (s.doNos || []).slice(), kg: s.kg || 0, pcs: s.pcs || 0,
          lines: (ps.lines || []).map(function (l) { return { doNo: l.doNo, soNo: l.soNo, code: l.code, desc: l.desc, plant: l.plant, qty: l.qty, weight: l.weight }; })
        });
        psData[o.psNo] = o.payload;
      });
      return {
        shipment: { shipNo: ship.shipNo, plate: ship.plate || '', driver: ship.driver || '', tripDate: ship.tripDate || '', note: ship.note || '',
          createdAt: ship.createdAt || '', createdBy: ship.createdBy || '', status: ship.status || 'planned' },
        stops: stops, psData: psData
      };
    },
    // นำเข้า Shipment ที่มีอยู่แล้วใน TMS แต่ยังไม่เคยส่งเข้า WMS (จัดไว้ก่อนมีการเชื่อม WMS)
    backfillFromTMS: function () {
      var ships = readLS('tms_shipments', []), orders = readLS('tms_orders', []), n = 0, self = global.WMSIF;
      ships.forEach(function (s) {
        if (self.isSent(s.shipNo)) return;
        if (self.send('SHIPMENT_UPSERT', self.buildShipmentPayload(s, orders), 'TMS (นำเข้า Shipment เดิม)')) n++;
      });
      return n;
    },
    onChange: function (cb) {
      window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === null) cb(); });
    }
  };
})(window);
