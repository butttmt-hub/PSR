/*
 * TMT PreSale — shared data layer (Phase 1)
 *
 * ทุกหน้าอ่าน/เขียนข้อมูลผ่าน TMTStore เท่านั้น ห้ามเรียก localStorage/sessionStorage ตรง
 * ตอนนี้ใช้ localStorage เป็นที่เก็บ (โหมด Demo) — ระยะถัดไปจะสลับ adapter เป็น Firestore
 * โดยไม่ต้องแก้หน้าจอ
 *
 * หลักการ: เขียนทีละเอกสาร (upsert/remove) ไม่เขียนทับทั้งลิสต์ เพื่อให้ผู้ใช้หลายคนไม่ทับงานกัน
 */
(function(global){
  'use strict';

  var KEYS = {
    quotations: 'tmt_saved_quotations',
    salesOrders: 'tmt_sales_orders',
    discountApprovals: 'tmt_discount_approvals',
    widgets: 'tmt_dashboard_widgets',
    theme: 'tmt_theme',
    sessionUser: 'tmt_sales_portal_user',
    sessionRole: 'tmt_sales_portal_role'
  };

  var ID_FIELD = {
    quotations: 'quotationNo',
    salesOrders: 'soNo',
    discountApprovals: 'quotationNo'
  };

  function readList(key){
    try{
      var raw = localStorage.getItem(key);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    }catch(e){ return []; }
  }

  // คืน false เมื่อเขียนไม่สำเร็จ (เช่น พื้นที่ localStorage เต็ม)
  function writeList(key, list){
    try{ localStorage.setItem(key, JSON.stringify(list)); return true; }
    catch(e){ return false; }
  }

  function makeCollection(name){
    var key = KEYS[name], idf = ID_FIELD[name];
    return {
      list: function(){ return readList(key); },
      get: function(id){
        var all = readList(key);
        for(var i=0;i<all.length;i++){ if(all[i][idf]===id) return all[i]; }
        return null;
      },
      upsert: function(rec){
        var all = readList(key), found = false;
        for(var i=0;i<all.length;i++){
          if(all[i][idf]===rec[idf]){ all[i] = rec; found = true; break; }
        }
        if(!found) all.push(rec);
        return writeList(key, all);
      },
      remove: function(id){
        return writeList(key, readList(key).filter(function(r){ return r[idf]!==id; }));
      },
      removeWhere: function(pred){
        return writeList(key, readList(key).filter(function(r){ return !pred(r); }));
      },
      clear: function(){ try{ localStorage.removeItem(key); }catch(e){} }
    };
  }

  // เลขเอกสาร — ระยะถัดไปจะย้ายไปออกเลขฝั่งกลาง (transaction) เพื่อกันเลขซ้ำ
  function pad(n, len){ return String(n).padStart(len, '0'); }
  var numbering = {
    nextQuotationNo: function(){
      var d = new Date();
      var ym = d.getFullYear() + pad(d.getMonth()+1, 2);
      return 'QT-' + ym + '-' + pad(Math.floor(1 + Math.random()*9999), 4);
    },
    nextSalesOrderNo: function(){
      return '1300' + String(Math.floor(100000 + Math.random()*900000));
    }
  };

  // ค่าส่วนตัวของผู้ใช้ (ธีม / Widget layout)
  var prefs = {
    getTheme: function(){
      try{ return localStorage.getItem(KEYS.theme) || 'light'; }catch(e){ return 'light'; }
    },
    setTheme: function(theme){
      try{ localStorage.setItem(KEYS.theme, theme); }catch(e){}
    },
    getWidgets: function(){
      try{
        var raw = localStorage.getItem(KEYS.widgets);
        if(raw){ var parsed = JSON.parse(raw); if(Array.isArray(parsed) && parsed.length) return parsed; }
      }catch(e){}
      return null;
    },
    setWidgets: function(widgets){
      try{ localStorage.setItem(KEYS.widgets, JSON.stringify(widgets)); }catch(e){}
    }
  };

  // ผู้ใช้ที่ login อยู่ (ต่อ tab) — ระยะถัดไปจะสลับเป็น Firebase Auth
  var session = {
    getUser: function(){
      try{ return sessionStorage.getItem(KEYS.sessionUser) || null; }catch(e){ return null; }
    },
    getRole: function(){
      try{ return sessionStorage.getItem(KEYS.sessionRole) || null; }catch(e){ return null; }
    },
    set: function(user, role){
      try{
        sessionStorage.setItem(KEYS.sessionUser, user);
        sessionStorage.setItem(KEYS.sessionRole, role);
      }catch(e){}
    },
    clear: function(){
      try{
        sessionStorage.removeItem(KEYS.sessionUser);
        sessionStorage.removeItem(KEYS.sessionRole);
      }catch(e){}
    }
  };

  global.TMTStore = {
    quotations: makeCollection('quotations'),
    salesOrders: makeCollection('salesOrders'),
    discountApprovals: makeCollection('discountApprovals'),
    numbering: numbering,
    prefs: prefs,
    session: session,
    // ล้างเฉพาะข้อมูลทดสอบ ไม่แตะ prefs/session
    clearTransactions: function(){
      this.quotations.clear();
      this.salesOrders.clear();
      this.discountApprovals.clear();
    }
  };
})(window);
