/*
 * Firestore adapter + Firebase Auth สำหรับ TMTStore (ระยะ 3 / Pilot)
 *
 * ทำงานเฉพาะเมื่อเลือก backend=firestore (เพิ่ม ?backend=firestore ในลิงก์) ไม่งั้นจบทันทีโดยไม่โหลด SDK
 * โหลดผ่าน <script type="module" src="firebase-adapter.js"> ต่อจาก firebase-config.js และ data-store.js
 */
const store = window.TMTStore;

if (store && store.backend() === 'firestore') {
  const V = '10.14.1';
  const base = 'https://www.gstatic.com/firebasejs/' + V + '/';

  let fbApp, fbStore, fbAuth;
  try {
    [fbApp, fbStore, fbAuth] = await Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-firestore.js'),
      import(base + 'firebase-auth.js')
    ]);
  } catch (e) {
    console.error('Cannot load Firebase SDK', e);
    store.signalNoAuth();
    throw e;
  }

  const { initializeApp } = fbApp;
  const {
    getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, writeBatch
  } = fbStore;
  const { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } = fbAuth;

  const app = initializeApp(window.TMT_FIREBASE_CONFIG);
  const db = getFirestore(app);
  const auth = getAuth(app);

  const COLLECTIONS = ['quotations', 'salesOrders', 'discountApprovals', 'deliveryOrders'];
  const MAX_DOC_BYTES = window.TMT_MAX_DOC_BYTES || 900000;
  const enc = new TextEncoder();

  function plain(rec) { return JSON.parse(JSON.stringify(rec)); }   // ตัด undefined ที่ Firestore ไม่รับ

  function makeAdapter() {
    const unsubs = [];
    const col = (n) => collection(db, n);
    async function deleteMany(docs) {
      for (let i = 0; i < docs.length; i += 400) {
        const batch = writeBatch(db);
        docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
    return {
      name: 'firestore',
      async load(n) {
        const snap = await getDocs(col(n));
        return snap.docs.map((d) => d.data());
      },
      async put(n, idf, rec) {
        const data = plain(rec);
        if (enc.encode(JSON.stringify(data)).length > MAX_DOC_BYTES) {
          const err = new Error('document too large');
          err.code = 'doc-too-large';
          throw err;
        }
        await setDoc(doc(db, n, String(data[idf])), data);
        return { ok: true };
      },
      async del(n, idf, id) {
        await deleteDoc(doc(db, n, String(id)));
        return { ok: true };
      },
      async delWhere(n, idf, pred) {
        const snap = await getDocs(col(n));
        await deleteMany(snap.docs.filter((d) => pred(d.data())));
        return { ok: true };
      },
      async clear(n) {
        const snap = await getDocs(col(n));
        await deleteMany(snap.docs);
        return { ok: true };
      },
      // snapshot แรกคือข้อมูลที่ load ไปแล้ว / snapshot ที่ยังมี pending write คือการเขียนของเราเอง → ข้าม
      watch(onRemoteChange) {
        COLLECTIONS.forEach((n) => {
          let first = true;
          unsubs.push(onSnapshot(col(n), (snap) => {
            if (first) { first = false; return; }
            if (snap.metadata.hasPendingWrites) return;
            onRemoteChange(n, snap.docs.map((d) => d.data()));
          }, (err) => console.error('Firestore listener error', n, err)));
        });
      },
      unwatch() { unsubs.splice(0).forEach((u) => u()); }
    };
  }

  // role ของผู้ใช้เก็บที่ users/{uid} = { username, role } (role: sales | mgr01 | approval | planning | service)
  async function loadProfile(user) {
    const snap = await getDoc(doc(db, 'users', user.uid));
    const p = snap.exists() ? snap.data() : null;
    if (!p || !['sales', 'mgr01', 'approval', 'planning', 'service'].includes(p.role)) {
      const err = new Error('no role');
      err.code = 'no-role';
      throw err;
    }
    return { username: p.username || (user.email || '').split('@')[0], role: p.role };
  }

  async function enter(user) {
    const profile = await loadProfile(user);
    store.session.set(profile.username, profile.role);
    store.attachAdapter(makeAdapter());
    await new Promise((res) => store.whenReady(res));
    return profile;
  }

  let initialised = false;
  onAuthStateChanged(auth, async (user) => {
    if (!initialised) {
      initialised = true;
      if (user) {
        try { await enter(user); }
        catch (e) {
          console.error('Auth restore failed', e);
          await signOut(auth).catch(() => {});
          store.session.clear();
          store.signalNoAuth();
        }
      } else {
        store.session.clear();
        store.signalNoAuth();
      }
      return;
    }
    // ออกจากระบบ (จาก tab นี้หรือ tab อื่น) → ถอด backend แล้วกลับหน้า login
    if (!user && store.isAttached()) {
      store.detachAdapter();
      store.session.clear();
      location.href = 'sales-portal.html';
    }
  });

  window.TMTFirebase = {
    async signIn(usernameOrEmail, password) {
      const id = String(usernameOrEmail || '').trim();
      const email = id.includes('@') ? id : id.toLowerCase() + '@' + (window.TMT_LOGIN_DOMAIN || 'pilot.tmt');
      const cred = await signInWithEmailAndPassword(auth, email, password);
      try {
        return await enter(cred.user);
      } catch (e) {
        await signOut(auth).catch(() => {});
        store.session.clear();
        throw e;
      }
    },
    signOut() { return signOut(auth); },
    currentUser() { return auth.currentUser; }
  };
  store._registerFirebase(window.TMTFirebase);
}
