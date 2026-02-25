(() => {
    const $ = (q) => document.querySelector(q);
  
    // --------- Storage keys ----------
    const K = {
      auth: "cswebtg_auth",
      user: "cswebtg_user",
      pendingUser: "cswebtg_pending_user",
      saved: "cswebtg_saved_templates",
      lastGenerated: "cswebtg_last_generated",
    };
  
    // --------- Helpers ----------
    const getJSON = (key, fallback) => {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
      catch { return fallback; }
    };
    const setJSON = (key, val) => localStorage.setItem(key, JSON.stringify(val));
    const API_BASE =
      localStorage.getItem("cswebtg_api_base") ||
      (location.hostname === "localhost" ? "http://localhost:5000" : "http://127.0.0.1:5000");
    const normalizePhone = (input = "") => {
      const val = input.trim();
      if (!val) return "";
      if (val.startsWith("+")) return `+${val.slice(1).replace(/\D/g, "")}`;
      return `+${val.replace(/\D/g, "")}`;
    };
    const postJSON = async (url, body) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data?.message || "Request failed");
        err.code = data?.error_code || "";
        throw err;
      }
      return data;
    };
    const GOOGLE_CLIENT_ID =
      localStorage.getItem("cswebtg_google_client_id") ||
      "83422884671-m8mmlq7jfctodhkm21gklud05iut7nj6.apps.googleusercontent.com";
    const AUTH_CANONICAL_ORIGIN =
      localStorage.getItem("cswebtg_auth_origin") || "http://localhost:3000";

    // Keep auth pages on one fixed origin to avoid Google OAuth origin_mismatch.
    const authPages = ["login.html", "signup.html"];
    const currentPage = location.pathname.split("/").pop();
    const isLocalDevHost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (authPages.includes(currentPage) && isLocalDevHost) {
      const canonical = new URL(AUTH_CANONICAL_ORIGIN);
      if (
        location.protocol !== canonical.protocol ||
        location.hostname !== canonical.hostname ||
        location.port !== canonical.port
      ) {
        const u = new URL(location.href);
        u.protocol = canonical.protocol;
        u.hostname = canonical.hostname;
        u.port = canonical.port;
        location.replace(u.toString());
        return;
      }
    }
    localStorage.setItem("cswebtg_last_origin", location.origin);
  
    const isAuthed = () => getJSON(K.auth, { loggedIn: false }).loggedIn === true;
  
    function requireAuth() {
      const protectedPages = ["dashboard.html", "templates.html", "customize.html", "customize-advanced.html"];
      const page = location.pathname.split("/").pop();
      if (protectedPages.includes(page) && !isAuthed()) {
        location.href = "login.html";
      }
    }
    requireAuth();
  
    function setMessage(id, text, ok = false) {
      const el = $(id);
      if (!el) return;
      el.textContent = text;
      el.className = ok
        ? "text-sm font-semibold text-emerald-700"
        : "text-sm font-semibold text-red-700";
    }
    function decodeJwtPayload(token) {
      try {
        const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const decoded = atob(base64);
        return JSON.parse(decoded);
      } catch {
        return null;
      }
    }

    function handleGoogleCredentialResponse(resp) {
      const payload = decodeJwtPayload(resp?.credential || "");
      if (!payload?.email) return;
      const user = {
        name: payload.name || payload.given_name || payload.email.split("@")[0],
        email: payload.email,
        picture: payload.picture || "",
      };
      setJSON(K.user, user);
      setJSON(K.auth, { loggedIn: true, at: Date.now(), provider: "google" });
      location.href = "dashboard.html";
    }

    function mountGoogleButton(containerId, attempt = 0) {
      const mount = document.getElementById(containerId);
      if (!mount) return;
      if (!window.google?.accounts?.id) {
        if (attempt < 30) {
          mount.innerHTML = `<p class="text-xs text-slate-600">Loading Google sign-in...</p>`;
          setTimeout(() => mountGoogleButton(containerId, attempt + 1), 150);
          return;
        }
        mount.innerHTML = `<p class="text-xs text-rose-700">Google script load failed. Refresh the page.</p>`;
        return;
      }
      if (!GOOGLE_CLIENT_ID) {
        mount.innerHTML = `<p class="text-xs text-amber-700">Set Google Client ID: localStorage.setItem('cswebtg_google_client_id','YOUR_CLIENT_ID')</p>`;
        return;
      }
      if (!/^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(GOOGLE_CLIENT_ID)) {
        mount.innerHTML = `<p class="text-xs text-rose-700">Invalid Google Client ID format.</p>`;
        return;
      }
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      mount.innerHTML = "";
      window.google.accounts.id.renderButton(mount, {
        theme: "outline",
        size: "large",
        type: "standard",
        width: 320,
      });
      const note = document.createElement("p");
      note.className = "mt-2 text-[11px] text-slate-600";
      note.textContent = `Origin: ${location.origin}`;
      mount.appendChild(note);
    }
  
    // --------- Password toggle ----------
    const togglePass = $("#togglePass");
    if (togglePass) {
      togglePass.addEventListener("click", () => {
        const pwd = $("#password");
        if (!pwd) return;
        pwd.type = pwd.type === "password" ? "text" : "password";
        togglePass.textContent = pwd.type === "password" ? "👁️" : "🙈";
      });
    }
  
    // --------- Login ----------
    const loginForm = $("#loginForm");
    if (loginForm) {
      loginForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const email = (loginForm.email?.value || "").trim().toLowerCase();
        const password = (loginForm.password?.value || "").trim();
  
        if (!email.includes("@") || password.length < 4) {
          setMessage("#msg", "Enter valid email & password (min 4).");
          return;
        }// Demo: accept any email/pass
        const user = { name: email.split("@")[0], email };
        setJSON(K.user, user);
        setJSON(K.auth, { loggedIn: true, at: Date.now() });
  
        setMessage("#msg", "Login successful. Redirecting...", true);
        setTimeout(() => (location.href = "dashboard.html"), 500);
      });
    }
    mountGoogleButton("googleBtnWrap");

    // --------- Signup ----------
    const signupForm = $("#signupForm");
    if (signupForm) {
      signupForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = (signupForm.name?.value || "").trim();
        const email = (signupForm.email?.value || "").trim().toLowerCase();
        const password = (signupForm.password?.value || "").trim();

        if (name.length < 2 || !email.includes("@") || password.length < 4) {
          setMessage("#msg", "Fill valid name, email and password.");
          return;
        }

        setJSON(K.user, { name, email });
        setJSON(K.auth, { loggedIn: true, at: Date.now(), provider: "local" });
        setMessage("#msg", "Account created. Redirecting...", true);
        setTimeout(() => (location.href = "dashboard.html"), 600);
      });
    }
    mountGoogleButton("googleBtnWrapSignup");
    // --------- OTP Verify ----------
    const otpForm = $("#otpForm");
    if (otpForm) {
      otpForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const code = (otpForm.otp?.value || "").trim();
        const pending = getJSON(K.pendingUser, null);

        if (!pending?.phone) {
          setMessage("#msg", "Session expired. Please signup again.");
          return;
        }
        if (!code) {
          setMessage("#msg", "Enter OTP code.");
          return;
        }

        try {
          setMessage("#msg", "Verifying OTP...", true);
          await postJSON(`${API_BASE}/api/auth/verify-otp`, { phone: pending.phone, code });

          const user = { name: pending.name, email: pending.email, phone: pending.phone };
          setJSON(K.user, user);
          setJSON(K.auth, { loggedIn: true, at: Date.now() });
          localStorage.removeItem(K.pendingUser);

          setMessage("#msg", "OTP verified. Redirecting to dashboard...", true);
          setTimeout(() => (location.href = "dashboard.html"), 700);
        } catch (err) {
          setMessage("#msg", err.message || "OTP verification failed.");
        }
      });
    }
    // --------- Dashboard user name ----------
    const userName = $("#userName");
    if (userName) {
      const user = getJSON(K.user, { name: "User" });
      userName.textContent = user.name || "User";
    }
  
    // --------- Logout ----------
    const logoutBtn = $("#logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        setJSON(K.auth, { loggedIn: false, at: Date.now() });
        location.href = "login.html";
      });
    }
    // --------- Template generator (for customize pages) ----------
    const templates = [
      { id: "gym-zen", name: "Tan & Green Minimal Gym", category: "GYM", style: "Minimal", badge: "Balanced" },
      { id: "gym-bold", name: "Power Gym Dark", category: "GYM", style: "Bold", badge: "High Impact" },
      { id: "portfolio-glass", name: "Glass Portfolio", category: "Portfolio", style: "Glass", badge: "Premium Look" },
      { id: "resto-modern", name: "Restaurant Modern", category: "Restaurant", style: "Modern", badge: "Clean UI" },
      { id: "landing-saas", name: "SaaS Landing", category: "Landing", style: "Modern", badge: "Startup Ready" },
      { id: "bank-core", name: "Digital Banking Core", category: "Banking", style: "Corporate", badge: "Enterprise" },
      { id: "bank-neobank", name: "Neo Bank Smart", category: "Banking", style: "Neo", badge: "Fintech" },
      { id: "bank-credit", name: "Credit Union Trust", category: "Banking", style: "Classic", badge: "Trust UI" },
      { id: "egdu-campus", name: "Smart Campus", category: "Education", style: "Modern", badge: "Academic" },
      { id: "health-care", name: "Care Hospital", category: "Healthcare", style: "Corporate", badge: "Secure" },
      { id: "shop-elite", name: "Elite Shop", category: "Ecommerce", style: "Bold", badge: "Conversion" },
      { id: "estate-prime", name: "Prime Estate", category: "Real Estate", style: "Classic", badge: "Luxury" },
      { id: "travel-orbit", name: "Orbit Travel", category: "Travel", style: "Glass", badge: "Immersive" },
    ];

    const list = $("#list");
    const category = $("#category");
    const style = $("#style");
    const theme = $("#theme");
    const accent = $("#accent");
    const brandName = $("#brandName");
    const templateSearch = $("#templateSearch");
    const paletteBar = $("#paletteBar");
    const pagesCount = $("#pagesCount");
    const preview = $("#preview");
    const status = $("#status");
    const templateMeta = $("#templateMeta");
    const downloadBtn = $("#downloadBtn");
    const saveBtn = $("#saveBtn");
    const genBtn = $("#generateBtn");
    const aiEnhanceBtn = $("#aiEnhanceBtn");
    let isGenerating = false;
    let aiContent = null;
    let selectedPalette = null;

    function setStatus(message, kind = "info") {
      if (!status) return;
      const classes = {
        info: "text-sm font-semibold text-slate-700",
        success: "text-sm font-semibold text-emerald-700",
        warn: "text-sm font-semibold text-amber-700",
        error: "text-sm font-semibold text-rose-700",
      };
      status.className = classes[kind] || classes.info;
      status.textContent = message;
    }

    const escapeHTML = (txt = "") =>
      txt.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const categoryCopyMap = {
      GYM: {
        headline: "Train smarter with a high-performance digital gym platform.",
        subheadline: "Membership plans, trainer showcases, and progress-first pages built for conversion.",
      },
      Portfolio: {
        headline: "Show your work with a premium portfolio that wins trust fast.",
        subheadline: "Elegant case studies, proof blocks, and strong CTAs to convert visitors into clients.",
      },
      Restaurant: {
        headline: "A modern restaurant site crafted to increase bookings and orders.",
        subheadline: "Menus, chef highlights, and reservation actions optimized for mobile users.",
      },
      Landing: {
        headline: "Launch faster with a conversion-first landing website.",
        subheadline: "Clear value proposition, concise copy, and a layout tuned for campaign traffic.",
      },
      Banking: {
        headline: "Secure digital banking experience for modern customers.",
        subheadline: "Trusted UI patterns for accounts, cards, loans, and service onboarding journeys.",
      },
      Education: {
        headline: "Education platform designed for admissions, courses, and learner growth.",
        subheadline: "Program discovery, faculty sections, and CTA flows aligned to student decisions.",
      },
      Healthcare: {
        headline: "Healthcare website focused on trust, care pathways, and clarity.",
        subheadline: "Service departments, appointment journeys, and compliance-friendly communication blocks.",
      },
      Ecommerce: {
        headline: "Ecommerce storefront engineered for product discovery and sales.",
        subheadline: "Catalog-ready sections, offer banners, and checkout-focused conversion components.",
      },
      "Real Estate": {
        headline: "Real estate website built to showcase listings and drive qualified leads.",
        subheadline: "Property cards, agent profiles, and inquiry actions tailored for high intent traffic.",
      },
      Travel: {
        headline: "Travel website layout that inspires discovery and drives bookings.",
        subheadline: "Destination showcases, itinerary highlights, and booking prompts with premium visuals.",
      },
    };

    function getCategoryCopy(categoryName, brand) {
      const base = categoryCopyMap[categoryName] || categoryCopyMap.Landing;
      return {
        headline: `${brand}: ${base.headline}`,
        subheadline: base.subheadline,
        primaryCta: "Get Started",
        secondaryCta: "Browse Templates",
        cardTitle: `${categoryName || "Business"} Experience`,
        cardNote: "Designed for trust and conversion",
      };
    }

    function getDefaultPaletteByCategory(categoryName, fallbackAccent) {
      const map = {
        GYM: ["#22c55e", "#14b8a6", "#0f172a"],
        Portfolio: ["#8b5cf6", "#6366f1", "#111827"],
        Restaurant: ["#f97316", "#ef4444", "#7c2d12"],
        Landing: ["#0ea5e9", "#2563eb", "#0f172a"],
        Banking: ["#1d4ed8", "#0ea5e9", "#0f172a"],
        Education: ["#06b6d4", "#3b82f6", "#1e293b"],
        Healthcare: ["#14b8a6", "#22c55e", "#0f172a"],
        Ecommerce: ["#f43f5e", "#f97316", "#111827"],
        "Real Estate": ["#a855f7", "#6366f1", "#1f2937"],
        Travel: ["#0ea5e9", "#22c55e", "#1e293b"],
      };
      const byCategory = map[categoryName];
      if (byCategory) return byCategory;
      return [fallbackAccent || "#0ea5e9", "#2563eb", "#0f172a"];
    }

    function renderList() {
      if (!list) return;
      const c = category?.value;
      const s = style?.value;
      const q = (templateSearch?.value || "").trim().toLowerCase();
      const prevSelected = list.dataset.selected;
      const filtered = templates.filter((t) =>
        (!c || t.category === c) &&
        (!s || t.style === s) &&
        (!q ||
          t.name.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          t.style.toLowerCase().includes(q))
      );

      if (!filtered.length) {
        list.innerHTML = `
          <div class="sm:col-span-2 p-4 rounded-2xl bg-white/60 border border-black/10">
            <div class="font-bold">No template found</div>
            <div class="text-xs opacity-70 mt-1">Try selecting Any or clearing search to view all templates.</div>
          </div>
        `;
        list.dataset.selected = "";
        if (templateMeta) templateMeta.textContent = "0 templates";
        return;
      }

      list.dataset.selected = filtered.some((t) => t.id === prevSelected) ? prevSelected : filtered[0].id;
      list.innerHTML = filtered
        .map(
          (t) => `
        <button
          data-id="${t.id}"
          class="text-left p-4 rounded-2xl bg-white/70 border border-black/10 transition hover:bg-white ${
            list.dataset.selected === t.id ? "ring-2 ring-sky-500/50" : ""
          }"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="font-extrabold">${t.name}</div>
            <span class="text-[11px] font-bold px-2 py-1 rounded-full bg-slate-900 text-white">${t.badge}</span>
          </div>
          <div class="text-xs opacity-70 mt-1">${t.category} - ${t.style}</div>
        </button>
      `,
        )
        .join("");

      if (templateMeta) {
        templateMeta.textContent = `${filtered.length} template${filtered.length > 1 ? "s" : ""}`;
      }

      list.querySelectorAll("button[data-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          list.querySelectorAll("button[data-id]").forEach((b) => b.classList.remove("ring-2", "ring-sky-500/50"));
          btn.classList.add("ring-2", "ring-sky-500/50");
          list.dataset.selected = btn.dataset.id;
          setStatus("Template selected. Click Generate to update preview.", "info");
        });
      });
    }

    if (category) category.addEventListener("change", renderList);
    if (style) style.addEventListener("change", renderList);
    if (templateSearch) templateSearch.addEventListener("input", renderList);
    const invalidateAI = () => { aiContent = null; };
    if (category) category.addEventListener("change", invalidateAI);
    if (style) style.addEventListener("change", invalidateAI);
    if (theme) theme.addEventListener("change", invalidateAI);
    if (accent) accent.addEventListener("input", () => {
      selectedPalette = null;
      invalidateAI();
    });
    if (brandName) brandName.addEventListener("input", invalidateAI);
    if (pagesCount) pagesCount.addEventListener("change", invalidateAI);
    if (paletteBar && accent) {
      paletteBar.querySelectorAll("button[data-colors]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const colors = String(btn.dataset.colors || "").split(",").map((x) => x.trim()).filter(Boolean);
          if (colors.length >= 3) {
            selectedPalette = [colors[0], colors[1], colors[2]];
            accent.value = colors[0];
          }
          invalidateAI();
          setStatus(`3-color palette applied: ${accent.value}`, "info");
        });
      });
    }
    if (list) renderList();

    function buildGeneratedHTML(opts) {
      const safeBrand = escapeHTML(opts.brand || "Generated Template");
      const safeLabel = escapeHTML(opts.label || "CS webTG export");
      const { primary, mode, glass } = opts;
      const palette = Array.isArray(opts.palette) && opts.palette.length >= 3
        ? opts.palette
        : [primary || "#0ea5e9", "#2563eb", "#0f172a"];
      const [p1, p2, p3] = palette;
      const copy = opts.copy || {};
      const bg = mode === "dark" ? "#0a1020" : "#f6f8fc";
      const fg = mode === "dark" ? "#e5e7eb" : "#0f172a";
      const hero = glass
        ? (mode === "dark"
          ? "background: rgba(15,23,42,.52); backdrop-filter: blur(14px); border: 1px solid rgba(148,163,184,.25);"
          : "background: rgba(255,255,255,.74); backdrop-filter: blur(10px); border: 1px solid rgba(148,163,184,.25);")
        : (mode === "dark"
          ? "background: linear-gradient(160deg, rgba(30,41,59,.96), rgba(15,23,42,.98)); border: 1px solid rgba(148,163,184,.20);"
          : "background: linear-gradient(160deg, rgba(255,255,255,.96), rgba(241,245,249,.98)); border: 1px solid rgba(148,163,184,.22);");
      const headline = escapeHTML(copy.headline || "A clean, fast template for your project.");
      const subheadline = escapeHTML(copy.subheadline || "This export is plain HTML and can be deployed on GitHub Pages or Netlify.");
      const primaryCta = escapeHTML(copy.primaryCta || "Download");
      const secondaryCta = escapeHTML(copy.secondaryCta || "Preview");
      const cardTitle = escapeHTML(copy.cardTitle || "Animated Card");
      const cardNote = escapeHTML(copy.cardNote || `Palette: ${p1}, ${p2}, ${p3}`);
      return `<!doctype html>
  <html>
  <head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${safeBrand}</title>
  <style>
  :root{ --p:${p1}; --p2:${p2}; --p3:${p3}; }
  *{ box-sizing:border-box; }
  body{
    margin:0;
    font-family: "Segoe UI", ui-sans-serif, system-ui;
    background:
      radial-gradient(900px 360px at 10% -10%, var(--p), transparent 60%),
      radial-gradient(900px 360px at 100% 0%, var(--p2), transparent 62%),
      ${bg};
    color:${fg};
  }
  .wrap{ max-width:1160px; margin:0 auto; padding:28px 18px 42px; }
  .panel{ border-radius:30px; padding:18px; ${hero} box-shadow:0 24px 70px rgba(0,0,0,.18); animation: panelIn .7s ease both; }
  .top{ display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .brand{ display:flex; align-items:center; gap:10px; font-weight:900; }
  .brand img{ width:34px; height:34px; border-radius:50%; object-fit:cover; border:1px solid rgba(148,163,184,.35); }
  .nav{ display:flex; gap:16px; flex-wrap:wrap; font-size:14px; opacity:.8; font-weight:700; }
  .nav a{ color:inherit; text-decoration:none; }
  .btn{ border:0; cursor:pointer; padding:11px 16px; border-radius:999px; font-weight:800; background:var(--p); color:white; text-decoration:none; display:inline-block; transition: transform .2s ease, box-shadow .2s ease; }
  .btn:hover{ transform: translateY(-2px); box-shadow:0 10px 24px rgba(14,165,233,.35); }
  .btn:active{ transform: translateY(0); }
  .ghost{ background:transparent; border:1px solid rgba(148,163,184,.45); color:${fg}; }
  .hero-title{
    margin:26px 0 0;
    font-size: clamp(44px, 9vw, 110px);
    line-height: .95;
    letter-spacing:-1.8px;
    background: linear-gradient(95deg, var(--p3) 12%, var(--p) 52%, var(--p2) 92%);
    -webkit-background-clip:text;
    background-clip:text;
    color:transparent;
    font-weight:900;
  }
  .hero-sub{ margin:14px 0 0; font-size: clamp(16px,2.4vw,32px); opacity:.92; font-weight:600; }
  .hero-note{ margin-top:10px; opacity:.78; max-width:68ch; }
  .cta{ display:flex; gap:12px; flex-wrap:wrap; margin-top:20px; }
  .cards{ margin-top:26px; display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:12px; }
  .card{
    border-radius:18px;
    min-height:156px;
    border:1px solid rgba(148,163,184,.25);
    background:
      linear-gradient(150deg, rgba(255,255,255,.2), rgba(255,255,255,0)),
      linear-gradient(120deg, var(--p), var(--p2), var(--p3));
    padding:14px;
    color:#f8fafc;
    display:flex;
    flex-direction:column;
    justify-content:space-between;
    text-decoration:none;
  }
  .card:nth-child(2){ background:linear-gradient(120deg, var(--p2), var(--p3), var(--p)); }
  .card:nth-child(3){ background:linear-gradient(120deg, var(--p3), var(--p), var(--p2)); }
  .card:nth-child(4){ background:linear-gradient(120deg, var(--p), var(--p3), var(--p2)); }
  .card-pop{ animation: cardPop .55s ease; }
  .advice-panel{
    margin-top:14px;
    border:1px solid rgba(148,163,184,.35);
    border-radius:14px;
    padding:12px;
    background: rgba(255,255,255,.38);
    backdrop-filter: blur(8px);
    display:none;
  }
  .advice-panel.show{ display:block; animation: panelIn .3s ease both; }
  .advice-title{ font-size:12px; font-weight:800; opacity:.9; letter-spacing:.3px; }
  .advice-text{ margin-top:6px; font-size:14px; line-height:1.45; opacity:.92; }
  .mark{
    margin-top:20px;
    display:flex;
    justify-content:space-between;
    gap:12px;
    flex-wrap:wrap;
    font-size:12px;
    opacity:.82;
  }
  .copyright{
    margin-top:14px;
    padding-top:12px;
    border-top:1px solid rgba(148,163,184,.25);
    font-size:12px;
    opacity:.8;
    display:flex;
    justify-content:space-between;
    gap:10px;
    flex-wrap:wrap;
  }
  @keyframes panelIn {
    from { opacity:0; transform: translateY(14px); }
    to { opacity:1; transform: translateY(0); }
  }
  @keyframes cardPop {
    0% { transform: scale(1); }
    45% { transform: scale(1.03); }
    100% { transform: scale(1); }
  }
  @media (max-width:940px){ .cards{ grid-template-columns:repeat(2,minmax(0,1fr)); } }
  @media (max-width:560px){ .cards{ grid-template-columns:1fr; } }
  </style>
  </head>
  <body>
  <div class="wrap" id="top">
    <section class="panel">
      <div class="top">
        <div class="brand">
          <img src="assets/logo.png" alt="Logo"/>
          <span>${safeBrand}</span>
        </div>
        <div class="nav">
          <a href="#hero">Modules</a>
          <a href="#cards">Templates</a>
          <a href="#mark">Collections</a>
          <a href="#copyright">Contact</a>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap">
          <button class="btn ghost" id="getAdviceBtn" type="button">Get Advice</button>
          <button class="btn" id="startProjectBtn" type="button">Start Project</button>
        </div>
      </div>

      <h1 class="hero-title" id="hero">${headline}</h1>
      <p class="hero-sub">Co-founded by Code Sanskriti and team</p>
      <p class="hero-note">${subheadline}</p>
      <div class="cta">
        <button class="btn" id="primaryCtaBtn" type="button">${primaryCta}</button>
        <button class="btn ghost" id="secondaryCtaBtn" type="button">${secondaryCta}</button>
      </div>
      <div id="advicePanel" class="advice-panel" aria-live="polite">
        <div class="advice-title">PROJECT ADVICE</div>
        <div class="advice-text" id="adviceText">Click "Get Advice" to generate a quick actionable suggestion.</div>
      </div>

      <div class="cards" id="cards">
        <a class="card" href="#hero"><strong>Website Template</strong><span>${cardTitle}</span></a>
        <a class="card" href="#cards"><strong>Business Flow</strong><span>${cardNote}</span></a>
        <a class="card" href="#mark"><strong>Brand Layer</strong><span>${safeLabel}</span></a>
        <a class="card" href="#copyright"><strong>AI Ready</strong><span>Functional Export</span></a>
      </div>

      <div class="mark" id="mark">
        <span>Trademark: ${safeBrand}™</span>
        <span>Design System: CS webTG v2.0</span>
      </div>
      <div class="copyright" id="copyright">
        <span>Copyright@CSwebTG v2.0</span>
        <span>All Rights Reserved | ${safeBrand}™</span>
      </div>
    </section>
  </div>
  <script>
  (function () {
    var cards = document.getElementById("cards");
    var getAdviceBtn = document.getElementById("getAdviceBtn");
    var startProjectBtn = document.getElementById("startProjectBtn");
    var primaryCtaBtn = document.getElementById("primaryCtaBtn");
    var secondaryCtaBtn = document.getElementById("secondaryCtaBtn");
    var advicePanel = document.getElementById("advicePanel");
    var adviceText = document.getElementById("adviceText");
    var cardItems = Array.prototype.slice.call(document.querySelectorAll(".card"));
    var advicePool = [
      "Use one clear CTA in hero and keep the nav simple.",
      "Add social proof near the first fold to improve trust.",
      "Keep headline outcome-focused and under 12 words.",
      "Highlight your top service card first for faster decisions.",
      "Use consistent spacing and section rhythm across pages."
    ];

    function focusCards() {
      if (!cards) return;
      cards.scrollIntoView({ behavior: "smooth", block: "start" });
      cardItems.forEach(function (el) {
        el.classList.remove("card-pop");
        void el.offsetWidth;
        el.classList.add("card-pop");
      });
    }

    if (getAdviceBtn && advicePanel && adviceText) {
      getAdviceBtn.addEventListener("click", function () {
        adviceText.textContent = advicePool[Math.floor(Math.random() * advicePool.length)];
        advicePanel.classList.add("show");
      });
    }
    if (startProjectBtn) startProjectBtn.addEventListener("click", focusCards);
    if (primaryCtaBtn) primaryCtaBtn.addEventListener("click", focusCards);
    if (secondaryCtaBtn) {
      secondaryCtaBtn.addEventListener("click", function () {
        document.getElementById("top").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  })();
  </script>
  </body>
  </html>`;
    }

    function getPagePlan(count) {
      const names = [
        "index",
        "about",
        "services",
        "products",
        "pricing",
        "blog",
        "careers",
        "contact",
        "faq",
      ];
      return names.slice(0, Math.max(4, Math.min(9, count)));
    }

    function buildWebsitePages(payload, copy) {
      const plan = getPagePlan(Number(payload.pages) || 4);
      const label = `${payload.category} - ${payload.style}`;
      const baseCopy = getCategoryCopy(payload.category, payload.brand);
      const heroCopy = { ...baseCopy, ...(copy || {}) };
      const pages = {};
      plan.forEach((name, idx) => {
        const pageCopy = idx === 0
          ? heroCopy
          : {
              headline: `${payload.brand} ${name[0].toUpperCase() + name.slice(1)}`,
              subheadline: `Professional ${name} page for ${payload.category.toLowerCase()} websites.`,
              primaryCta: "Get Started",
              secondaryCta: "Contact",
              cardTitle: `${name[0].toUpperCase() + name.slice(1)} Section`,
              cardNote: `${label} | ${payload.theme} | ${payload.palette.join(" / ")}`,
            };
        let html = buildGeneratedHTML({
          brand: payload.brand,
          primary: payload.accent,
          palette: payload.palette,
          mode: payload.theme,
          label,
          glass: payload.style === "Glass",
          copy: pageCopy,
        });
        const nav = plan.map((p) => `<a href="${p}.html" style="color:inherit;text-decoration:none;font-weight:700">${p[0].toUpperCase() + p.slice(1)}</a>`).join(" | ");
        html = html.replace(
          "<div class=\"wrap\" id=\"top\">",
          `<div class="wrap" id="top"><div style="margin-bottom:14px;opacity:.85;font-size:14px;display:flex;flex-wrap:wrap;gap:10px">${nav}</div>`,
        );
        pages[`${name}.html`] = html;
      });
      if (pages["products.html"] && !pages["product.html"]) {
        pages["product.html"] = pages["products.html"];
      }
      if (pages["about.html"] && !pages["about-us.html"]) {
        pages["about-us.html"] = pages["about.html"];
      }
      return pages;
    }

    function wirePreviewNavigation(pages) {
      if (!preview || !pages || typeof pages !== "object") return;
      const bind = () => {
        const doc = preview.contentDocument;
        if (!doc || !doc.documentElement) return;
        if (doc.documentElement.dataset.previewNavBound === "1") return;
        doc.documentElement.dataset.previewNavBound = "1";

        doc.addEventListener("click", (ev) => {
          const anchor = ev.target?.closest?.("a[href]");
          if (!anchor) return;
          const hrefRaw = String(anchor.getAttribute("href") || "").trim();
          if (!hrefRaw) return;
          if (!hrefRaw.endsWith(".html")) return;
          const aliasMap = {
            "product.html": "products.html",
            "aboutus.html": "about.html",
            "about-us.html": "about.html",
          };
          const href = pages[hrefRaw] ? hrefRaw : (aliasMap[hrefRaw] || hrefRaw);
          if (!pages[href]) return;
          ev.preventDefault();
          preview.srcdoc = pages[href];
          setTimeout(bind, 0);
        });
      };
      setTimeout(bind, 0);
    }

    function setGeneratingState(loading) {
      if (!genBtn) return;
      isGenerating = loading;
      genBtn.disabled = loading;
      genBtn.textContent = loading ? "Generating..." : "Generate";
    }

    function generateTemplate() {
      const selectedId = list?.dataset?.selected || templates[0].id;
      const t = templates.find((x) => x.id === selectedId) || templates[0];
      const cleanBrand = ((brandName?.value || "").trim() || "Code Sanskriti").slice(0, 40);

      const payload = {
        id: t.id,
        name: t.name,
        category: category?.value || t.category,
        style: style?.value || t.style,
        theme: theme?.value || "dark",
        accent: accent?.value || "#0ea5e9",
        brand: cleanBrand,
        pages: Number(pagesCount?.value || 4),
        createdAt: Date.now(),
      };
      payload.palette = selectedPalette || getDefaultPaletteByCategory(payload.category, payload.accent);

      const pages = buildWebsitePages(payload, aiContent);
      const html = pages["index.html"] || Object.values(pages)[0];

      if (preview) {
        preview.srcdoc = html;
        wirePreviewNavigation(pages);
      }
      if (downloadBtn) downloadBtn.disabled = false;
      setJSON(K.lastGenerated, { payload, html, pages });
      setStatus(`Generated ${Object.keys(pages).length}-page website: ${t.name}`, "success");
    }

    function buildFallbackAICopy(payload) {
      const autoCopy = getCategoryCopy(payload.category, payload.brand);
      return {
        headline: autoCopy.headline,
        subheadline: autoCopy.subheadline,
        primaryCta: "Get Started",
        secondaryCta: "Browse Templates",
        cardTitle: `${payload.category} UI`,
        cardNote: `Palette lead: ${payload.accent}`,
      };
    }

    function normalizeAICopy(copy, payload) {
      const fallback = buildFallbackAICopy(payload);
      if (!copy || typeof copy !== "object") return fallback;
      return {
        headline: String(copy.headline || fallback.headline).slice(0, 140),
        subheadline: String(copy.subheadline || fallback.subheadline).slice(0, 220),
        primaryCta: String(copy.primaryCta || fallback.primaryCta).slice(0, 20),
        secondaryCta: String(copy.secondaryCta || fallback.secondaryCta).slice(0, 24),
        cardTitle: String(copy.cardTitle || fallback.cardTitle).slice(0, 60),
        cardNote: String(copy.cardNote || fallback.cardNote).slice(0, 120),
      };
    }

    async function fetchAIFrom(endpoint, payload, timeoutMs = 6000) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const localOpenAIKey = (localStorage.getItem("cswebtg_openai_key") || "").trim();
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
          ...(localOpenAIKey ? { headers: { "Content-Type": "application/json", "x-openai-key": localOpenAIKey } } : {}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.message || `AI request failed (${res.status})`);
        return data;
      } finally {
        clearTimeout(timeout);
      }
    }

    async function getAIEnhancement(payload) {
      const originAlt = location.hostname === "localhost" ? "127.0.0.1" : "localhost";
      const endpointCandidates = [
        `${API_BASE}/api/templates/assist`,
        `${location.origin}/api/templates/assist`,
        `http://${location.hostname}:5000/api/templates/assist`,
        `http://${originAlt}:5000/api/templates/assist`,
        "http://localhost:5000/api/templates/assist",
        "http://127.0.0.1:5000/api/templates/assist",
        "/api/templates/assist",
      ];
      const endpoints = [...new Set(endpointCandidates)];
      let lastError = "";
      for (const endpoint of endpoints) {
        try {
          const data = await fetchAIFrom(endpoint, payload, 6500);
          return {
            copy: normalizeAICopy(data?.copy, payload),
            mode: data?.mode || "openai",
            message: data?.message || "",
          };
        } catch (err) {
          lastError = err?.message || "request failed";
        }
      }
      return { copy: buildFallbackAICopy(payload), mode: "fallback", message: lastError };
    }

    function mapAIErrorMessage(raw = "") {
      const msg = String(raw || "").toLowerCase();
      if (msg.includes("quota") || msg.includes("billing")) {
        return "OpenAI quota/billing limit reached. Add credits, then retry AI Enhance.";
      }
      if (msg.includes("invalid api key") || msg.includes("incorrect api key")) {
        return "Invalid OpenAI API key. Update OPENAI_API_KEY in Backend/server/.env.";
      }
      if (msg.includes("rate limit")) {
        return "OpenAI rate limit hit. Wait a few seconds and retry.";
      }
      return raw || "request failed";
    }
    if (genBtn && preview) {
      genBtn.addEventListener("click", () => {
        if (isGenerating) return;
        setGeneratingState(true);
        setStatus("Preparing your template preview...", "info");
        setTimeout(() => {
          generateTemplate();
          setGeneratingState(false);
        }, 280);
      });
    }

    if (aiEnhanceBtn) {
      aiEnhanceBtn.addEventListener("click", async () => {
        const selectedId = list?.dataset?.selected || templates[0].id;
        const t = templates.find((x) => x.id === selectedId) || templates[0];
        const payload = {
          category: category?.value || t.category,
          style: style?.value || t.style,
          theme: theme?.value || "dark",
          accent: accent?.value || "#0ea5e9",
          brand: ((brandName?.value || "").trim() || "Code Sanskriti").slice(0, 40),
        };
        aiEnhanceBtn.disabled = true;
        aiEnhanceBtn.textContent = "AI Working...";
        setStatus("Generating AI copy for preview...", "info");
        try {
          const result = await getAIEnhancement(payload);
          aiContent = normalizeAICopy(result?.copy, payload);
          generateTemplate();
          if (result?.mode === "fallback") {
            const reason = mapAIErrorMessage(result?.message || "");
            setStatus(`AI server unavailable. Fallback enhancement applied. ${reason}`.trim(), "warn");
          } else if (result?.mode === "config_missing") {
            setStatus("OpenAI key missing. Set OPENAI_API_KEY in Backend/server/.env", "warn");
          } else if (result?.mode === "error") {
            setStatus(mapAIErrorMessage(result?.message || ""), "error");
          } else {
            setStatus("AI enhancement applied to preview.", "success");
          }
        } catch {
          aiContent = buildFallbackAICopy(payload);
          generateTemplate();
          setStatus("AI unavailable. Local enhancement applied.", "warn");
        } finally {
          aiEnhanceBtn.disabled = false;
          aiEnhanceBtn.textContent = "AI Enhance";
        }
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener("click", () => {
        const last = getJSON(K.lastGenerated, null);
        if (!last?.html) {
          setStatus("Generate a template before downloading.", "warn");
          return;
        }
        const files = last.pages && typeof last.pages === "object"
          ? Object.entries(last.pages)
          : [[`${last.payload?.id || "template"}.html`, last.html]];
        files.forEach(([filename, content], idx) => {
          setTimeout(() => {
            const blob = new Blob([content], { type: "text/html" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            URL.revokeObjectURL(a.href);
          }, idx * 120);
        });
        setStatus(`Download started for ${files.length} page(s).`, "success");
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const last = getJSON(K.lastGenerated, null);
        if (!last?.payload) {
          setStatus("Generate a template first, then save it.", "warn");
          return;
        }
        const saved = getJSON(K.saved, []);
        const exists = saved.some((s) =>
          s.id === last.payload.id &&
          s.brand === last.payload.brand &&
          s.theme === last.payload.theme &&
          s.accent === last.payload.accent &&
          s.style === last.payload.style &&
          s.category === last.payload.category &&
          JSON.stringify(s.palette || []) === JSON.stringify(last.payload.palette || []) &&
          Number(s.pages || 0) === Number(last.payload.pages || 0)
        );
        if (exists) {
          setStatus("Same configuration is already saved.", "warn");
          return;
        }
        saved.unshift({ ...last.payload, html: last.html, pages: last.pages || null });
        setJSON(K.saved, saved);
        setStatus("Saved to My Templates.", "success");
      });
    }

    if (preview) {
      const last = getJSON(K.lastGenerated, null);
      if (last?.html) {
        preview.srcdoc = last.html;
        wirePreviewNavigation(last.pages || null);
        if (downloadBtn) downloadBtn.disabled = false;
        setStatus("Last generated template restored.", "info");
      } else {
        setStatus("Select a template and click Generate.", "info");
      }
    }

    // --------- Templates page render ----------
    const savedList = $("#savedList");
    const searchSaved = $("#searchSaved");
    const clearAll = $("#clearAll");
  
    function renderSaved() {
      if (!savedList) return;
      const q = (searchSaved?.value || "").trim().toLowerCase();
      const saved = getJSON(K.saved, []);
      const filtered = saved.filter(s =>
        (s.name || "").toLowerCase().includes(q) ||
        (s.category || "").toLowerCase().includes(q) ||
        (s.style || "").toLowerCase().includes(q) ||
        (s.brand || "").toLowerCase().includes(q)
      );
  
      savedList.innerHTML = filtered.length ? filtered.map((s, idx) => `
        <div class="p-5 rounded-2xl bg-white/60 border border-black/10">
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="font-extrabold">${s.name}</div>
              <div class="text-xs opacity-70">${s.category} • ${s.style} • ${s.theme} • ${s.pages || Object.keys(s.pages || {}).length || 1} page(s)</div>
              <div class="text-xs opacity-70 mt-1">Brand: <span class="font-semibold">${s.brand}</span></div>
            </div>
            <div class="h-8 w-8 rounded-full border border-black/10" style="background:${Array.isArray(s.palette) && s.palette.length >= 3 ? `linear-gradient(120deg, ${s.palette[0]}, ${s.palette[1]}, ${s.palette[2]})` : (s.accent || "#0ea5e9")}" title="palette"></div>
          </div>
  
          <div class="mt-4 flex flex-wrap gap-2">
            <button data-dl="${idx}" class="px-3 py-2 rounded-xl bg-slate-800 text-white font-semibold">Download</button>
            <button data-open="${idx}" class="px-3 py-2 rounded-xl bg-white/70 border border-black/10 font-semibold">Preview</button>
            <button data-del="${idx}" class="px-3 py-2 rounded-xl bg-rose-700 text-white font-semibold">Delete</button>
          </div>
        </div>
      `).join("") : `<p class="opacity-70">No saved templates found.</p>`;
  
      // handlers
      savedList.querySelectorAll("button[data-dl]").forEach(btn => {
        btn.addEventListener("click", () => {
          const index = Number(btn.dataset.dl);
          const s = getJSON(K.saved, [])[index];
          if (!s?.html && !s?.pages) return;
          const files = s.pages && typeof s.pages === "object"
            ? Object.entries(s.pages)
            : [[`${s.id || "template"}.html`, s.html]];
          files.forEach(([filename, content], i) => {
            setTimeout(() => {
              const blob = new Blob([content], { type: "text/html" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = filename;
              a.click();
              URL.revokeObjectURL(a.href);
            }, i * 120);
          });
        });
      });
  
      savedList.querySelectorAll("button[data-open]").forEach(btn => {
        btn.addEventListener("click", () => {
          const index = Number(btn.dataset.open);
          const s = getJSON(K.saved, [])[index];
          if (!s?.html && !s?.pages) return;
          const firstPage = s.pages?.["index.html"] || s.html || Object.values(s.pages || {})[0];
          const w = window.open("", "_blank");
          w.document.open();
          w.document.write(firstPage);
          w.document.close();
        });
      });
  
      savedList.querySelectorAll("button[data-del]").forEach(btn => {
        btn.addEventListener("click", () => {
          const index = Number(btn.dataset.del);
          const savedNow = getJSON(K.saved, []);
          savedNow.splice(index, 1);
          setJSON(K.saved, savedNow);
          renderSaved();
        });
      });
    }
  
    if (savedList) renderSaved();
    if (searchSaved) searchSaved.addEventListener("input", renderSaved);
  
    if (clearAll) {
      clearAll.addEventListener("click", () => {
        if (confirm("Delete all saved templates?")) {
          setJSON(K.saved, []);
          renderSaved();
        }
      });
    }
  })();





