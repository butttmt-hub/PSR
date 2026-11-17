/*
 * TMT PreSale — shared data layer (Phase 2)
 *
 * ทุกหน้าอ่าน/เขียนข้อมูลผ่าน TMTStore เท่านั้น ห้ามเรียก localStorage/sessionStorage ตรง
 *
 * สถาปัตยกรรม:
 *   หน้าจอ  →  TMTStore (cache ในหน่วยความจำ + subscribe)  →  adapter (ที่เก็บจริง)
 *
 *  - อ่าน (list/get) เป็น sync เสมอ อ่านจาก cache ที่ hydrate ไว้แล้ว
 *  - เขียนทีละเอกสาร (upsert/remove) อัปเดต cache ทันที แล้วส่งต่อให้ adapter
 *  - subscribe(fn) แจ้งทุกครั้งที่ข้อมูลเปลี่ยน ทั้งจากตัวเองและจาก tab/ผู้ใช้อื่น
 *  - adapter ปัจจุบันคือ localStorage (โหมด Demo) — ระยะถัดไปสลับเป็น Firestore ได้โดยไม่แตะหน้าจอ
 *
 * สัญญาของ adapter (ดู localAdapter ด้านล่างเป็นตัวอย่าง) — แต่ละเมธอดคืนค่า sync หรือ Promise ก็ได้:
 *   load(name)                  → list
 *   put(name, idField, rec)     → { ok, list? }
 *   del(name, idField, id)      → { ok, list? }
 *   delWhere(name, idField, fn) → { ok, list? }
 *   clear(name)                 → { ok, list? }
 *   watch(onRemoteChange)       → เรียก onRemoteChange(name, list?) เมื่อมีคนอื่นแก้ข้อมูล
 */
(function(global){
  'use strict';

  var COLLECTIONS = ['quotations', 'salesOrders', 'discountApprovals', 'deliveryOrders'];

  var KEYS = {
    quotations: 'tmt_saved_quotations',
    salesOrders: 'tmt_sales_orders',
    discountApprovals: 'tmt_discount_approvals',
    deliveryOrders: 'tmt_delivery_orders',
    widgets: 'tmt_dashboard_widgets',
    theme: 'tmt_theme',
    sessionUser: 'tmt_sales_portal_user',
    sessionRole: 'tmt_sales_portal_role'
  };

  var ID_FIELD = {
    quotations: 'quotationNo',
    salesOrders: 'soNo',
    discountApprovals: 'quotationNo',
    deliveryOrders: 'doNo'
  };

  function isThenable(x){ return x && typeof x.then === 'function'; }
  function clone(v){
    if(typeof structuredClone === 'function') return structuredClone(v);
    return JSON.parse(JSON.stringify(v));
  }

  /* ---------------- localStorage adapter (โหมด Demo) ---------------- */

  function readList(key){
    try{
      var raw = localStorage.getItem(key);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    }catch(e){ return []; }
  }
  function writeList(key, list){
    try{ localStorage.setItem(key, JSON.stringify(list)); return true; }
    catch(e){ return false; }
  }

  // ทุกการเขียนอ่านรายการล่าสุดจาก localStorage ก่อนแก้เอกสารเดียว
  // กัน tab อื่นที่เพิ่งเขียนไปถูกทับ (read-modify-write ต่อเอกสาร)
  var localAdapter = {
    name: 'localStorage',
    load: function(name){ return readList(KEYS[name]); },
    put: function(name, idf, rec){
      var list = readList(KEYS[name]), found = false;
      for(var i=0;i<list.length;i++){
        if(list[i][idf]===rec[idf]){ list[i] = rec; found = true; break; }
      }
      if(!found) list.push(rec);
      return { ok: writeList(KEYS[name], list), list: list };
    },
    del: function(name, idf, id){
      var list = readList(KEYS[name]).filter(function(r){ return r[idf]!==id; });
      return { ok: writeList(KEYS[name], list), list: list };
    },
    delWhere: function(name, idf, pred){
      var list = readList(KEYS[name]).filter(function(r){ return !pred(r); });
      return { ok: writeList(KEYS[name], list), list: list };
    },
    clear: function(name){
      try{ localStorage.removeItem(KEYS[name]); }catch(e){}
      return { ok: true, list: [] };
    },
    // storage event ยิงเฉพาะ tab อื่นของ origin เดียวกัน = "ผู้ใช้/หน้าอื่นแก้ข้อมูล"
    watch: function(onRemoteChange){
      if(typeof window === 'undefined' || !window.addEventListener) return;
      window.addEventListener('storage', function(e){
        if(e.storageArea !== localStorage) return;
        if(e.key === null){ COLLECTIONS.forEach(function(n){ onRemoteChange(n); }); return; }
        COLLECTIONS.forEach(function(n){ if(KEYS[n]===e.key) onRemoteChange(n); });
      });
    }
  };

  /* ---------------- core: cache + subscribe ---------------- */

  // backend: 'local' (Demo, localStorage) หรือ 'firestore' (Pilot)
  // เลือกด้วย ?backend=firestore | ?backend=local ในลิงก์ (จำค่าไว้ในเบราว์เซอร์) ค่าเริ่มต้นคือ local
  function getBackendPref(){
    try{
      var m = /[?&]backend=(firestore|local)\b/.exec(location.search);
      if(m){ localStorage.setItem('tmt_backend', m[1]); return m[1]; }
      return localStorage.getItem('tmt_backend') === 'firestore' ? 'firestore' : 'local';
    }catch(e){ return 'local'; }
  }
  var backend = getBackendPref();

  var adapter = null;
  var cache = {};
  var listeners = [];
  var errorListeners = [];
  var readyState = { done: false, waiters: [] };

  function emit(ev){
    listeners.slice().forEach(function(fn){
      try{ fn(ev); }catch(e){ if(global.console) console.error('TMTStore subscriber error', e); }
    });
  }
  function emitError(err){
    errorListeners.slice().forEach(function(fn){
      try{ fn(err); }catch(e){}
    });
  }

  function markReady(){
    readyState.done = true;
    var w = readyState.waiters; readyState.waiters = [];
    w.forEach(function(fn){ try{ fn(); }catch(e){} });
    emit({ type: 'ready' });
  }

  // hydrate: adapter ที่ sync (localStorage) พร้อมใช้งานทันทีตั้งแต่โหลดสคริปต์
  // adapter ที่ async (Firestore) ให้หน้าจอรอ TMTStore.whenReady ก่อน render ครั้งแรก
  function hydrate(){
    readyState.done = false;           // เก็บ waiters ที่รออยู่ไว้ ไม่ทิ้ง
    var pending = 0, async = false;
    COLLECTIONS.forEach(function(name){
      var res = adapter.load(name);
      if(isThenable(res)){
        async = true; pending++;
        res.then(function(list){
          cache[name] = Array.isArray(list) ? list : [];
          if(--pending === 0) markReady();
        }, function(err){
          cache[name] = cache[name] || [];
          emitError({ collection: name, op: 'load', error: err });
          if(--pending === 0) markReady();
        });
      } else {
        cache[name] = Array.isArray(res) ? res : [];
      }
    });
    if(!async) markReady();
  }

  function wireWatch(){
    if(typeof adapter.watch !== 'function' || adapter.__watched) return;
    adapter.__watched = true;
    adapter.watch(function(name, list){
      var apply = function(l){
        cache[name] = Array.isArray(l) ? l : [];
        emit({ type: 'change', collection: name, source: 'remote' });
      };
      if(Array.isArray(list)) { apply(list); return; }
      var res = adapter.load(name);
      if(isThenable(res)) res.then(apply); else apply(res);
    });
  }

  function findIndex(list, idf, id){
    for(var i=0;i<list.length;i++){ if(list[i][idf]===id) return i; }
    return -1;
  }

  // ใช้ผลของ adapter (sync) หรือ optimistic + rollback (async) แล้วคืน boolean ให้ caller เดิม
  function runWrite(name, optimistic, send){
    if(!adapter) return false;         // ยังไม่ได้ login / ยังไม่ได้แนบ backend
    var before = cache[name];
    var next = optimistic(before.slice());
    var res = send();

    if(isThenable(res)){
      cache[name] = next;
      emit({ type: 'change', collection: name, source: 'local' });
      res.then(function(r){
        if(r && r.ok === false) rollback(new Error('write rejected'));
      }, rollback);
      return true;
    }

    if(res && res.ok === false){ return false; }
    cache[name] = (res && Array.isArray(res.list)) ? res.list : next;
    emit({ type: 'change', collection: name, source: 'local' });
    return true;

    function rollback(err){
      cache[name] = before;
      emit({ type: 'change', collection: name, source: 'rollback' });
      emitError({ collection: name, op: 'write', error: err });
    }
  }

  function makeCollection(name){
    var idf = ID_FIELD[name];
    return {
      list: function(){ return clone(cache[name] || []); },
      get: function(id){
        var i = findIndex(cache[name] || [], idf, id);
        return i >= 0 ? clone(cache[name][i]) : null;
      },
      upsert: function(rec){
        var copy = clone(rec);
        return runWrite(name, function(list){
          var i = findIndex(list, idf, copy[idf]);
          if(i >= 0) list[i] = copy; else list.push(copy);
          return list;
        }, function(){ return adapter.put(name, idf, copy); });
      },
      remove: function(id){
        return runWrite(name, function(list){
          return list.filter(function(r){ return r[idf]!==id; });
        }, function(){ return adapter.del(name, idf, id); });
      },
      removeWhere: function(pred){
        return runWrite(name, function(list){
          return list.filter(function(r){ return !pred(r); });
        }, function(){ return adapter.delWhere(name, idf, pred); });
      },
      clear: function(){
        return runWrite(name, function(){ return []; }, function(){ return adapter.clear(name); });
      }
    };
  }

  /* ---------------- เลขเอกสาร ---------------- */
  // ระยะถัดไปจะย้ายไปออกเลขฝั่งกลาง (transaction) เพื่อกันเลขซ้ำ
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

  /* ---------------- ค่าส่วนตัวของผู้ใช้ + session ---------------- */
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

  var store = {
    quotations: makeCollection('quotations'),
    salesOrders: makeCollection('salesOrders'),
    discountApprovals: makeCollection('discountApprovals'),
    deliveryOrders: makeCollection('deliveryOrders'),
    numbering: numbering,
    prefs: prefs,
    session: session,

    // fn({type:'change'|'ready', collection, source:'local'|'remote'|'rollback'}) — คืนฟังก์ชันยกเลิก
    subscribe: function(fn){
      listeners.push(fn);
      return function(){ listeners = listeners.filter(function(f){ return f!==fn; }); };
    },
    // แจ้งเมื่อเขียนแบบ async ไม่สำเร็จ (sync adapter ไม่ต้องใช้ — ดูค่า boolean ที่คืนจาก upsert/remove)
    onError: function(fn){
      errorListeners.push(fn);
      return function(){ errorListeners = errorListeners.filter(function(f){ return f!==fn; }); };
    },
    isReady: function(){ return readyState.done; },
    whenReady: function(fn){
      if(readyState.done) fn(); else readyState.waiters.push(fn);
    },
    adapterName: function(){ return adapter ? adapter.name : null; },
    backend: function(){ return backend; },
    isAttached: function(){ return !!adapter; },

    // ล้างเฉพาะข้อมูลทดสอบ ไม่แตะ prefs/session
    clearTransactions: function(){
      var self = this;
      COLLECTIONS.forEach(function(n){ self[n].clear(); });
    },

    // แนบ backend (เรียกหลัง login สำเร็จในโหมด Firestore) แล้ว hydrate ข้อมูลเข้า cache
    attachAdapter: function(a){
      this.detachAdapter(true);
      adapter = a;
      hydrate();
      wireWatch();
    },
    // ถอด backend ออก (logout) — ล้าง cache ในหน่วยความจำ ไม่แตะข้อมูลบนเซิร์ฟเวอร์
    detachAdapter: function(silent){
      if(adapter && typeof adapter.unwatch === 'function') adapter.unwatch();
      adapter = null;
      COLLECTIONS.forEach(function(n){ cache[n] = []; });
      readyState.done = false;
      if(!silent) emit({ type: 'change', collection: '*', source: 'detach' });
    },
    // ไม่มีผู้ใช้ login — ให้หน้าที่รอ whenReady ทำงานต่อ (เช่น แสดงหน้า login) โดยยังไม่มีข้อมูล
    signalNoAuth: function(){ markReady(); },
    _useAdapter: function(a){ this.attachAdapter(a); },   // ใช้ทดสอบ

    // ข้อความ error ภาษาไทยสำหรับแสดงผู้ใช้
    describeError: function(err){
      var code = (err && (err.code || err.message)) || '';
      var map = {
        'doc-too-large': 'เอกสารมีขนาดใหญ่เกินไป — ลดขนาดหรือจำนวนไฟล์แนบแล้วลองใหม่',
        'permission-denied': 'ไม่มีสิทธิ์ทำรายการนี้ด้วยบัญชีปัจจุบัน',
        'auth/invalid-credential': 'Username หรือ Password ไม่ถูกต้อง กรุณาลองใหม่',
        'auth/invalid-email': 'Username หรือ Password ไม่ถูกต้อง กรุณาลองใหม่',
        'auth/user-not-found': 'Username หรือ Password ไม่ถูกต้อง กรุณาลองใหม่',
        'auth/wrong-password': 'Username หรือ Password ไม่ถูกต้อง กรุณาลองใหม่',
        'auth/too-many-requests': 'ลองผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
        'auth/network-request-failed': 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ กรุณาลองใหม่',
        'no-role': 'บัญชีนี้ยังไม่ได้กำหนดสิทธิ์การใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
        'unavailable': 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'
      };
      for(var k in map){ if(code.indexOf(k) >= 0) return map[k]; }
      return 'บันทึกไม่สำเร็จ (' + (code || 'unknown error') + ')';
    },

    // Firebase module ลงทะเบียนตัวเองที่นี่ เพื่อให้หน้า login รอจนโหลดเสร็จได้
    _registerFirebase: function(fb){
      firebaseApi = fb;
      firebaseWaiters.splice(0).forEach(function(res){ res(fb); });
    },
    firebase: function(){
      return new Promise(function(res){ if(firebaseApi) res(firebaseApi); else firebaseWaiters.push(res); });
    }
  };

  var firebaseApi = null, firebaseWaiters = [];

  if(backend === 'firestore'){
    // รอจนกว่าจะ login + แนบ Firestore: ซ่อนหน้าไว้กันเห็นหน้าว่าง และมี timeout กันค้างถ้าโหลด Firebase ไม่ได้
    COLLECTIONS.forEach(function(n){ cache[n] = []; });
    try{
      var st = document.createElement('style');
      st.id = 'tmt-boot-style';
      st.textContent = 'html.tmt-booting body{visibility:hidden}';
      document.head.appendChild(st);
      document.documentElement.classList.add('tmt-booting');
    }catch(e){}
    var unhide = function(){
      try{ document.documentElement.classList.remove('tmt-booting'); }catch(e){}
    };
    store.whenReady(unhide);
    setTimeout(function(){
      if(!readyState.done){
        unhide();
        if(global.console) console.error('TMTStore: Firebase did not become ready within 10s');
        try{ alert('เชื่อมต่อ Firebase ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้า'); }catch(e){}
        markReady();
      }
    }, 10000);
  } else {
    adapter = localAdapter;
    hydrate();
    wireWatch();
  }
  global.TMTStore = store;
})(window);
