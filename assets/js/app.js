(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const money = value => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0));
  const API_BASE = (window.FOODIEHUB_API_URL || "").replace(/\/$/, "");

  const PHOTO_FALLBACKS = {
    Burgers:"https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1100&q=88",
    Pizza:"https://images.unsplash.com/photo-1658478006307-525ab032ab26?auto=format&fit=crop&w=1100&q=88",
    Pasta:"https://images.unsplash.com/photo-1608219992759-8d74ed8d76eb?auto=format&fit=crop&w=1100&q=88",
    Bowls:"https://images.unsplash.com/photo-1680405531955-8b4981bb1b0c?auto=format&fit=crop&w=1100&q=88",
    Indian:"https://images.unsplash.com/photo-1641893728260-19493532d6b9?auto=format&fit=crop&w=1100&q=88",
    Sides:"https://images.unsplash.com/photo-1688978181542-87a886a16fbe?auto=format&fit=crop&w=1100&q=88",
    Desserts:"https://images.unsplash.com/photo-1617305855058-336d24456869?auto=format&fit=crop&w=1100&q=88",
    Drinks:"https://images.pexels.com/photos/8211179/pexels-photo-8211179.jpeg?auto=compress&cs=tinysrgb&w=1200",
    Featured:"https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=88",
    General:"https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1100&q=88"
  };
  function getOptimizedFoodImageUrl(source,purpose="card"){
    if(!source)return source;
    try{
      const url=new URL(source);
      const host=url.hostname.toLowerCase();
      const mobile=window.matchMedia&&window.matchMedia("(max-width: 760px)").matches;
      const width=purpose==="detail"?(mobile?820:1200):(mobile?480:900);
      const quality=purpose==="detail"?(mobile?78:84):(mobile?72:80);
      if(host==="images.unsplash.com"){
        url.searchParams.set("auto","format");
        url.searchParams.set("fit","crop");
        url.searchParams.set("w",String(width));
        url.searchParams.set("q",String(quality));
      }else if(host==="images.pexels.com"){
        url.searchParams.set("auto","compress");
        url.searchParams.set("cs","tinysrgb");
        url.searchParams.set("w",String(width));
      }
      return url.toString();
    }catch(_error){return source;}
  }
  function getDetailFoodImageUrl(source){
    return getOptimizedFoodImageUrl(source,"detail");
  }
  function protectDetailFoodPhoto(image,item,preferredSource){
    const sources=[preferredSource||item.image,PHOTO_FALLBACKS[item.category]||PHOTO_FALLBACKS.Featured,PHOTO_FALLBACKS.General]
      .filter(Boolean).map(getDetailFoodImageUrl).filter((url,index,all)=>all.indexOf(url)===index);
    let next=1;
    image.alt=item.name+" — "+item.description;
    image.loading="eager";
    image.decoding="async";
    image.fetchPriority="auto";
    image.onerror=()=>{
      if(next<sources.length){image.src=sources[next++];return;}
      image.onerror=null;
      image.classList.add("photo-unavailable");
    };
    image.classList.remove("photo-unavailable");
    image.src=sources[0]||item.image;
  }
  function protectFoodPhoto(image,item){
    const list=[PHOTO_FALLBACKS[item.category]||PHOTO_FALLBACKS.Featured,PHOTO_FALLBACKS.General];
    let next=0;
    image.onerror=()=>{
      while(next<list.length){
        const candidate=list[next++];
        if(candidate===image.src)continue;
        if(item.id)state.imageFallbacks[item.id]=candidate;
        image.src=getOptimizedFoodImageUrl(candidate);return;
      }
      image.onerror=null;image.removeAttribute("src");
      image.alt=(item.name||"Food")+" photo is temporarily unavailable";
      image.classList.add("photo-unavailable");
    };
  }
  const STORAGE = {
    cart: "foodiehub.cart.v2",
    favourites: "foodiehub.favourites.v2",
    theme: "foodiehub.theme.v2",
    orders: "foodiehub.orders.v2",
    profile: "foodiehub.profile.v1",
    rewards: "foodiehub.rewards.v1",
    auth: "foodiehub.auth.v1",
    diet: "foodiehub.menuDiet.v1",
    sort: "foodiehub.menuSort.v1"
  };

  const state = {
    menu: [],
    cart: readStore(STORAGE.cart, {}),
    favourites: readStore(STORAGE.favourites, []),
    orders: readStore(STORAGE.orders, []),
    profile: readStore(STORAGE.profile, { name: "", phone: "", email: "", address: "" }),
    auth: readStore(STORAGE.auth, { token: "", user: null, expiresAt: 0 }),
    addresses: [],
    customizations: readStore("foodiehub.customizations.v1", {}),
    imageFallbacks: {},
    currentCustomizer: null,
    customizerQuantity: 1,
    category: "All",
    diet: ["all", "veg", "nonveg"].includes(readStore(STORAGE.diet, "all")) ? readStore(STORAGE.diet, "all") : "all",
    query: "",
    sort: ["recommended", "price-low", "price-high", "discount", "name"].includes(readStore(STORAGE.sort, "recommended")) ? readStore(STORAGE.sort, "recommended") : "recommended",
    onlyFavourites: false,
    coupon: null,
    backendOnline: false,
    rewards: readStore(STORAGE.rewards, { points: 0, lifetime: 0 }),
    pendingRewardRedemption: false,
    adminKey: "",
    adminOrders: [],
    adminAnalytics: null,
    adminChartView: "month",
    adminSource: "none",
    paymentGateway: { enabled: false, keyId: "" },
    checkoutIdempotencyKey: ""
  };

  function readStore(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value === null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function saveStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function createCheckoutIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID().replace(/-/g, "");
    }
    const bytes = new Uint8Array(18);
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  async function request(path, options = {}) {
    const authHeaders = state.auth && state.auth.token ? { Authorization: "Bearer " + state.auth.token } : {};
    const response = await fetch(API_BASE + path, {
      ...options,
      headers: { ...authHeaders, "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || payload.message || "Something went wrong.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function normalizeAccountUser(user) {
    const source = user || {};
    return {
      id: String(source.id || ""),
      name: String(source.name || ""),
      email: String(source.email || ""),
      phone: String(source.phone || ""),
      createdAt: source.createdAt || source.created_at || ""
    };
  }

  function setCustomerSession(payload) {
    const expiresIn = Math.max(0, Number(payload && payload.expiresIn) || 604800);
    state.auth = {
      token: String(payload && payload.token || ""),
      user: normalizeAccountUser(payload && payload.user),
      expiresAt: Date.now() + expiresIn * 1000
    };
    if (!state.auth.token) throw new Error("The account server did not return a sign-in session.");
    saveStore(STORAGE.auth, state.auth);
  }

  function clearCustomerSession() {
    state.auth = { token: "", user: null, expiresAt: 0 };
    state.addresses = [];
    saveStore(STORAGE.auth, state.auth);
    renderProfile();
  }

  function renderAccountUI() {
    const signedIn = Boolean(state.auth && state.auth.token && state.auth.user);
    const authPanel = $("#accountAuthPanel");
    const offlineNote = $("#accountOfflineNote");
    const profileForm = $("#profileForm");
    const addressPanel = $("#savedAddressesPanel");
    const logoutButton = $("#accountLogoutButton");
    if (authPanel) authPanel.hidden = !state.backendOnline || signedIn;
    if (offlineNote) {
      offlineNote.hidden = Boolean(state.backendOnline);
      const note = offlineNote.querySelector("p");
      if (note) note.textContent = signedIn
        ? "The account server is temporarily unavailable. Your saved account data is shown, but changes cannot sync right now."
        : "Customer accounts and cloud-saved addresses need the FoodieHub API connection. You can still save details on this device.";
    }
    if (profileForm) profileForm.hidden = Boolean(state.backendOnline && !signedIn);
    if (addressPanel) addressPanel.hidden = !signedIn;
    if (logoutButton) logoutButton.hidden = !signedIn;
    const emailInput = profileForm && profileForm.elements.namedItem("email");
    if (emailInput) emailInput.readOnly = signedIn;
    const storageNote = $("#profileStorageNote");
    if (storageNote) storageNote.innerHTML = signedIn
      ? '<span aria-hidden="true">✓</span> Your account details and saved addresses sync with FoodieHub.'
      : '<span aria-hidden="true">⌂</span> Your profile and address are stored on this device only in demo mode.';
    const personalHint = $("#profilePersonalHint");
    if (personalHint) personalHint.textContent = signedIn ? "Your account details are synced securely." : "Your details stay on this device in demo mode.";
    const introTitle = $("#profileIntroTitle");
    if (introTitle) introTitle.textContent = signedIn ? "Your account details." : "Your contact and delivery details.";
    const introCopy = $("#profileIntroCopy");
    if (introCopy) introCopy.textContent = signedIn ? "Update your details and manage saved delivery addresses." : "Save your details for a faster checkout next time.";
    const title = $("#profileTitle");
    if (title) title.textContent = signedIn ? "Your account" : "Your profile";
  }

  function renderSavedAddresses() {
    const list = $("#savedAddressesList");
    const count = $("#savedAddressesCount");
    if (!list || !count) return;
    count.textContent = state.addresses.length + " saved";
    if (!state.addresses.length) {
      list.innerHTML = '<div class="saved-address-empty"><span aria-hidden="true">⌂</span><strong>No saved addresses yet</strong><p>Add a complete address above to make checkout faster.</p></div>';
      return;
    }
    list.innerHTML = state.addresses.map(entry => {
      const address = entry.address || {};
      return '<article class="account-address-card"><div class="account-address-top"><strong>' + escapeHTML(entry.label || "Address") + '</strong><span>Saved</span></div><p>' + escapeHTML(formatDeliveryAddress(address)) + '</p><div class="account-address-actions"><button type="button" data-address-use="' + escapeHTML(entry.id) + '">Use for checkout</button><button type="button" data-address-delete="' + escapeHTML(entry.id) + '">Remove</button></div></article>';
    }).join("");
  }

  async function syncCustomerAccount() {
    const result = await request("/api/auth/me");
    state.auth.user = normalizeAccountUser(result.user);
    const [addressResult, orderResult] = await Promise.all([
      request("/api/auth/addresses"),
      request("/api/auth/orders")
    ]);
    state.addresses = Array.isArray(addressResult.addresses) ? addressResult.addresses : [];
    state.orders = Array.isArray(orderResult.orders)
      ? orderResult.orders.map(order => ({ ...order, phone: state.auth.user.phone }))
      : [];
    state.profile = {
      ...state.profile,
      name: state.auth.user.name,
      phone: state.auth.user.phone,
      email: state.auth.user.email
    };
    const hasAddress = state.profile.addressDetails &&
      Object.values(state.profile.addressDetails).some(value => String(value || "").trim());
    if (!hasAddress && state.addresses.length) {
      state.profile.addressDetails = state.addresses[0].address;
      state.profile.address = formatDeliveryAddress(state.addresses[0].address);
    }
    const profileForm = $("#profileForm");
    if (profileForm) {
      ["name", "phone", "email"].forEach(field => {
        const control = profileForm.elements.namedItem(field);
        if (control) control.value = state.profile[field] || "";
      });
      fillAddressFields(profileForm, state.profile.addressDetails || {});
      updateAddressPreview("profileForm", "profileAddressPreview");
    }
    saveStore(STORAGE.profile, state.profile);
    saveStore(STORAGE.auth, state.auth);
    renderProfile();
    renderCart();
  }

  async function restoreCustomerSession() {
    if (!state.auth || !state.auth.token) {
      renderAccountUI();
      return;
    }
    if (state.auth.expiresAt && Number(state.auth.expiresAt) <= Date.now()) {
      clearCustomerSession();
      return;
    }
    if (!state.backendOnline) {
      renderAccountUI();
      return;
    }
    try {
      await syncCustomerAccount();
    } catch (error) {
      if (error.status === 401) {
        clearCustomerSession();
        showToast("Your account session has expired. Please sign in again.", "error");
      } else {
        renderAccountUI();
      }
    }
  }

  function showAccountAuthMode(mode) {
    const register = mode === "register";
    $("#customerLoginForm").hidden = register;
    $("#customerRegisterForm").hidden = !register;
    $("#authSignInTab").classList.toggle("is-active", !register);
    $("#authRegisterTab").classList.toggle("is-active", register);
    $("#authSignInTab").setAttribute("aria-selected", String(!register));
    $("#authRegisterTab").setAttribute("aria-selected", String(register));
    $("#accountAuthError").textContent = "";
  }

  async function handleCustomerLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    submit.disabled = true;
    submit.textContent = "Signing in…";
    $("#accountAuthError").textContent = "";
    try {
      const session = await request("/api/auth/login", { method: "POST", body: JSON.stringify(values) });
      setCustomerSession(session);
      await syncCustomerAccount();
      $("#profileMessage").textContent = "You are signed in. Your account details are synced.";
      showToast("Welcome back to FoodieHub.");
    } catch (error) {
      $("#accountAuthError").textContent = error.message || "Sign in could not be completed.";
    } finally {
      submit.disabled = false;
      submit.innerHTML = 'Sign in securely <span aria-hidden="true">→</span>';
    }
  }

  async function handleCustomerRegister(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    submit.disabled = true;
    submit.textContent = "Creating account…";
    $("#accountAuthError").textContent = "";
    try {
      const session = await request("/api/auth/register", { method: "POST", body: JSON.stringify(values) });
      setCustomerSession(session);
      await syncCustomerAccount();
      form.reset();
      $("#profileMessage").textContent = "Your FoodieHub account is ready.";
      showToast("Your FoodieHub account has been created.");
    } catch (error) {
      $("#accountAuthError").textContent = error.message || "Account registration could not be completed.";
    } finally {
      submit.disabled = false;
      submit.innerHTML = 'Create my account <span aria-hidden="true">→</span>';
    }
  }

  async function handleCustomerLogout() {
    try {
      if (state.backendOnline && state.auth.token) await request("/api/auth/logout", { method: "POST" });
    } catch (_) {}
    clearCustomerSession();
    showToast("You have signed out.");
  }

  async function checkBackend() {
    try {
      await request("/api/health");
      state.backendOnline = true;
      document.documentElement.dataset.backend = "connected";
      try {
        const paymentConfig = await request("/api/payments/config");
        state.paymentGateway = { enabled: Boolean(paymentConfig.enabled && paymentConfig.keyId), keyId: String(paymentConfig.keyId || "") };
      } catch (_) {
        state.paymentGateway = { enabled: false, keyId: "" };
      }
      renderPaymentAvailability();
    } catch (_) {
      state.backendOnline = false;
      document.documentElement.dataset.backend = "demo";
    }
  }

  async function loadMenu() {
    try {
      const result = await request("/api/menu");
      if (Array.isArray(result.items) && result.items.length) return result.items;
    } catch (_) {}
    const response = await fetch("./data/menu.json", { cache: "no-store" });
    if (!response.ok) throw new Error("The menu could not be loaded. Please refresh the page.");
    return response.json();
  }

  function showToast(message, type = "success") {
    const region = $("#toastRegion");
    const toast = document.createElement("div");
    toast.className = "toast toast-" + type;
    toast.textContent = message;
    region.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));
    window.setTimeout(() => {
      toast.classList.remove("visible");
      window.setTimeout(() => toast.remove(), 250);
    }, 2800);
  }

  function openDialog(id) {
    const dialog = document.getElementById(id);
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else {
      dialog.setAttribute("open", "");
      dialog.classList.add("dialog-fallback-open");
    }
  }

  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog && dialog.open) dialog.close();
  }

  const ADDRESS_FIELDS=["house","building","street","area","landmark","town","city","district","state","pincode"];
  function readAddressDetails(formData){
    const details={};
    ADDRESS_FIELDS.forEach(field=>{details[field]=String(formData.get(field)||"").trim();});
    return details;
  }
  function formatDeliveryAddress(details){
    const d=details||{};
    const places=[...new Set([d.town,d.city,d.district].filter(Boolean))];
    const lines=[
      [d.house,d.building].filter(Boolean).join(", "),
      [d.street,d.area].filter(Boolean).join(", "),
      d.landmark?("Near "+d.landmark):"",
      places.join(", "),
      [d.state].filter(Boolean).join("")+(d.pincode?" - "+d.pincode:"")
    ].filter(Boolean);
    return lines.join(", ");
  }
  function fillAddressFields(form,details){
    const source=details||{};
    ADDRESS_FIELDS.forEach(field=>{
      const control=form.elements.namedItem(field);
      if(control)control.value=source[field]||"";
    });
  }
  function showLegacyAddress(id,profile){
    const note=$("#"+id),details=(profile&&profile.addressDetails)||{};
    if(!note)return;
    const hasStructured=ADDRESS_FIELDS.some(field=>String(details[field]||"").trim());
    note.hidden=!(profile&&profile.address&&!hasStructured);
    note.textContent=note.hidden?"":"Previously saved address: "+profile.address+". Please split it into the fields above to use it for your next order.";
  }
  function updateAddressPreview(formId,previewId){
    const form=$("#"+formId),preview=$("#"+previewId);
    if(!form||!preview)return;
    const details=readAddressDetails(new FormData(form));
    const formatted=formatDeliveryAddress(details);
    preview.textContent=formatted||"Your delivery address will appear here as you complete the form.";
    preview.classList.toggle("is-filled",Boolean(formatted));
  }

  function renderProfile() {
    const name = String(state.profile.name || "").trim();
    const signedIn = Boolean(state.auth && state.auth.token && state.auth.user);
    $("#profileTriggerLabel").textContent = name ? name.split(/\s+/)[0] : (signedIn ? "Account" : "Profile");
    $("#openProfile").setAttribute("aria-label", signedIn ? "Open your FoodieHub account" : (name ? "Open profile for " + name : "Open your profile"));
    const savedAddress = String(state.profile.address || "").trim();
    $("#appLocationText").textContent = savedAddress
      ? savedAddress.split(",").slice(0, 2).join(",").trim()
      : "Add delivery address";
    $("#appLocationTrigger").setAttribute("aria-label", savedAddress
      ? "Delivery address: " + savedAddress + ". Edit delivery address"
      : "Add your delivery address");
    renderAccountUI();
    renderSavedAddresses();
  }

  function openProfile(options = {}) {
    renderAccountUI();
    const form = $("#profileForm");
    if (state.backendOnline && !(state.auth && state.auth.user)) {
      $("#profileDialog").classList.remove("address-focus-mode");
      showAccountAuthMode("login");
      $("#accountAuthError").textContent = "";
      openDialog("profileDialog");
      return;
    }
    const addressOnly = Boolean(options.addressOnly);
    const profileDialog = $("#profileDialog");
    profileDialog.classList.toggle("address-focus-mode", addressOnly);
    const profileKicker = $(".dialog-header .drawer-kicker", profileDialog);
    if (profileKicker) profileKicker.textContent = addressOnly ? "DELIVERY DETAILS" : "FOODIEHUB ACCOUNT";
    const profileTitle = $("#profileTitle");
    if (profileTitle) profileTitle.textContent = addressOnly ? "Delivery address" : (state.auth && state.auth.user ? "Your account" : "Your profile");
    const addressIntroNumber = $(".address-intro > span", profileDialog);
    if (addressIntroNumber) addressIntroNumber.textContent = addressOnly ? "01" : "02";
    const saveButton = $(".profile-save-button", profileDialog);
    if (saveButton) saveButton.innerHTML = addressOnly
      ? 'Save delivery address <span aria-hidden="true">✓</span>'
      : 'Save profile <span aria-hidden="true">✓</span>';
    ["name", "phone", "email"].forEach(field => {
      form.elements.namedItem(field).value = state.profile[field] || "";
    });
    let addressDetails = state.profile.addressDetails || {};
    if (!Object.values(addressDetails).some(value => String(value || "").trim()) && state.addresses.length) {
      addressDetails = state.addresses[0].address || {};
    }
    fillAddressFields(form, addressDetails);
    const labelInput = form.elements.namedItem("addressLabel");
    if (labelInput) labelInput.value = state.addresses[0] ? (state.addresses[0].label || "Home") : "Home";
    showLegacyAddress("profileLegacyAddress",state.profile);
    updateAddressPreview("profileForm","profileAddressPreview");
    $("#profileError").textContent = "";
    $("#profileMessage").textContent = state.auth && state.auth.user
      ? "Your account details and saved addresses are ready."
      : (state.profile.name || state.profile.address
        ? "Your saved details are ready to edit."
        : "Add your details and delivery address here.");
    renderSavedAddresses();
    openDialog("profileDialog");
  }

  async function saveProfile(event) {
    event.preventDefault();
    const submit = $(".profile-save-button");
    const values = new FormData(event.currentTarget);
    const name = String(values.get("name") || "").trim();
    const phone = String(values.get("phone") || "").replace(/\D/g, "").slice(-10);
    const email = String(values.get("email") || "").trim();
    const addressDetails = readAddressDetails(values);
    const address = formatDeliveryAddress(addressDetails) || state.profile.address || "";

    if (state.auth && state.auth.token) {
      if (!state.backendOnline) {
        $("#profileError").textContent = "The account server is unavailable. Your changes have not been synced.";
        return;
      }
      if (name.length < 2) {
        $("#profileError").textContent = "Enter your full name.";
        return;
      }
      if (!/^[6-9]\d{9}$/.test(phone)) {
        $("#profileError").textContent = "Enter a valid 10-digit Indian mobile number.";
        return;
      }
      submit.disabled = true;
      submit.textContent = "Saving account…";
      $("#profileError").textContent = "";
      try {
        const updated = await request("/api/auth/me", {
          method: "PATCH",
          body: JSON.stringify({ name, phone })
        });
        state.auth.user = normalizeAccountUser(updated.user || { ...state.auth.user, name, phone });
        state.profile = { name, phone, email: state.auth.user.email || email, addressDetails, address };
        const requiredFields = ["house", "street", "area", "town", "city", "district", "state"];
        const completeAddress = requiredFields.every(field => String(addressDetails[field] || "").trim()) &&
          /^[1-9]\d{5}$/.test(String(addressDetails.pincode || ""));
        let addressSaved = false;
        if (completeAddress) {
          const duplicate = state.addresses.some(entry => ADDRESS_FIELDS.every(field =>
            String((entry.address || {})[field] || "").trim() === String(addressDetails[field] || "").trim()
          ));
          if (!duplicate) {
            await request("/api/auth/addresses", {
              method: "POST",
              body: JSON.stringify({ label: String(values.get("addressLabel") || "Home"), address: addressDetails })
            });
          }
          addressSaved = true;
          const result = await request("/api/auth/addresses");
          state.addresses = Array.isArray(result.addresses) ? result.addresses : [];
        }
        saveStore(STORAGE.profile, state.profile);
        saveStore(STORAGE.auth, state.auth);
        renderProfile();
        updateAddressPreview("profileForm","profileAddressPreview");
        $("#profileError").textContent = "";
        $("#profileMessage").textContent = addressSaved
          ? "Account updated and your delivery address is saved."
          : "Account updated. Complete the address fields and save again to add a delivery address.";
        showToast(addressSaved ? "Your account and address are saved." : "Your account details are saved.");
      } catch (error) {
        $("#profileError").textContent = error.message || "Your account could not be updated.";
      } finally {
        submit.disabled = false;
        submit.innerHTML = $("#profileDialog").classList.contains("address-focus-mode")
          ? 'Save delivery address <span aria-hidden="true">✓</span>'
          : 'Save profile <span aria-hidden="true">✓</span>';
      }
      return;
    }

    if (phone && (phone.length !== 10 || !/^[6-9]/.test(phone))) {
      $("#profileError").textContent = "Enter a valid 10-digit Indian mobile number, or leave it blank.";
      return;
    }
    state.profile = { name, phone, email, addressDetails, address };
    saveStore(STORAGE.profile, state.profile);
    renderProfile();
    $("#profileError").textContent = "";
    $("#profileMessage").textContent = "Profile saved on this device. Connect the account service to sync across devices.";
    showToast("Your profile and delivery address have been saved on this device.");
  }

  async function handleSavedAddressClick(event) {
    const useButton = event.target.closest("[data-address-use]");
    const deleteButton = event.target.closest("[data-address-delete]");
    if (useButton) {
      const entry = state.addresses.find(item => item.id === useButton.dataset.addressUse);
      if (!entry) return;
      const form = $("#profileForm");
      fillAddressFields(form, entry.address || {});
      const label = form.elements.namedItem("addressLabel");
      if (label) label.value = entry.label || "Home";
      state.profile.addressDetails = entry.address || {};
      state.profile.address = formatDeliveryAddress(entry.address || {});
      saveStore(STORAGE.profile, state.profile);
      updateAddressPreview("profileForm","profileAddressPreview");
      showToast("This address is selected for your next checkout.");
      return;
    }
    if (deleteButton) {
      const entry = state.addresses.find(item => item.id === deleteButton.dataset.addressDelete);
      if (!entry) return;
      deleteButton.disabled = true;
      try {
        await request("/api/auth/addresses/" + encodeURIComponent(entry.id), { method: "DELETE" });
        state.addresses = state.addresses.filter(item => item.id !== entry.id);
        renderSavedAddresses();
        showToast("Saved address removed.");
      } catch (error) {
        showToast(error.message || "The address could not be removed.", "error");
        deleteButton.disabled = false;
      }
    }
  }

  function getCategoryIcon(category) {
    const name = String(category || "").toLowerCase();
    const icons = [
      [/all|everything|popular|trending/, "🍽️"],
      [/pizza/, "🍕"],
      [/burger/, "🍔"],
      [/biryani|rice|pulao/, "🍛"],
      [/dessert|cake|sweet|ice cream/, "🍰"],
      [/drink|beverage|juice|shake|coffee/, "🥤"],
      [/sandwich|wrap|roll/, "🌯"],
      [/pasta|noodle/, "🍝"],
      [/indian|north|south|thali/, "🥘"],
      [/snack|starter|momo|fries/, "🥟"]
    ];
    const match = icons.find(([pattern]) => pattern.test(name));
    return match ? match[1] : "🍴";
  }

  function renderCategories() {
    const categories = ["All", ...new Set(state.menu.map(item => item.category))];
    $("#categoryTabs").innerHTML = categories.map(category => {
      const active = state.category === category ? " active" : "";
      const label = category === "All" ? "All" : escapeHTML(category);
      const icon = getCategoryIcon(category);
      return '<button class="category-tab' + active + '" type="button" data-category="' + escapeHTML(category) + '"><span class="category-icon" aria-hidden="true">' + icon + '</span><small class="category-label">' + label + "</small></button>";
    }).join("");
    $("#categoryTabs [data-category]").forEach(button => {
      button.addEventListener("click", () => {
        state.category = button.dataset.category;
        $("#categoryTabs [data-category]").forEach(tab => {
          tab.classList.toggle("active", tab.dataset.category === state.category);
        });
        renderMenu();
      });
    });
  }

  function setDietFilter(diet, shouldRender = true) {
    const allowed = ["all", "veg", "nonveg"];
    state.diet = allowed.includes(diet) ? diet : "all";
    saveStore(STORAGE.diet, state.diet);
    $$(".diet-button").forEach(button => {
      button.classList.toggle("active", button.dataset.diet === state.diet);
    });
    if (shouldRender) renderMenu();
  }

  function visibleMenu() {
    const query = state.query.trim().toLowerCase();
    let items = state.menu.filter(item => {
      const matchesCategory = state.category === "All" || item.category === state.category;
      const matchesDiet = state.diet === "all" || (state.diet === "veg" ? item.isVeg : !item.isVeg);
      const matchesSearch = !query || [item.name, item.description, item.category, ...(item.tags || [])].join(" ").toLowerCase().includes(query);
      const matchesFavourite = !state.onlyFavourites || state.favourites.includes(item.id);
      return matchesCategory && matchesDiet && matchesSearch && matchesFavourite;
    });

    const originalOrder = new Map(state.menu.map((item, index) => [item.id, index]));
    const tieBreak = (a, b) => (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0);
    const comparators = {
      "price-low": (a, b) => Number(a.price || 0) - Number(b.price || 0),
      "price-high": (a, b) => Number(b.price || 0) - Number(a.price || 0),
      discount: (a, b) => Number(b.discountPercent || 0) - Number(a.discountPercent || 0),
      name: (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "en", { sensitivity: "base", numeric: true }),
      recommended: (a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured))
    };
    const compare = comparators[state.sort] || comparators.recommended;
    items.sort((a, b) => compare(a, b) || tieBreak(a, b));
    return items;
  }

  const menuCardCache = new Map();

  function renderMenu() {
    const grid = $("#menuGrid");
    const items = visibleMenu();
    $$(".diet-button").forEach(button => {
      button.classList.toggle("active", button.dataset.diet === state.diet);
    });
    const sortControl = $("#sortMenu");
    if (sortControl && sortControl.value !== state.sort) sortControl.value = state.sort;
    const appVegToggle = $("#appVegToggle");
    if (appVegToggle) {
      const vegEnabled = state.diet === "veg";
      appVegToggle.classList.toggle("is-active", vegEnabled);
      appVegToggle.setAttribute("aria-pressed", String(vegEnabled));
      $("#appVegState").textContent = vegEnabled ? "On" : "Off";
    }
    $("#menuCount").textContent = items.length;
    $("#menuStatus").textContent = state.onlyFavourites ? "Your saved favourites" : (state.query ? "Results for “" + state.query + "”" : "Showing all menu items");
    $("#emptyMenu").hidden = items.length > 0;

    if (!items.length) {
      grid.replaceChildren();
      return;
    }
    const template = $("#dishCardTemplate");
    const orderedCards = [];
    items.forEach(item => {
      let card = menuCardCache.get(item.id);
      if (!card) {
        card = template.content.firstElementChild.cloneNode(true);
        menuCardCache.set(item.id, card);
      }
      card.dataset.dishId = item.id;
      const image = $("[data-image]", card);
      const requestedImage = state.imageFallbacks[item.id] || item.image;
      image.alt = item.name + " — " + item.description;
      image.loading = "lazy";
      image.decoding = "async";
      image.fetchPriority = "low";
      if (image.dataset.requestedSource !== requestedImage || !image.getAttribute("src")) {
        image.dataset.requestedSource = requestedImage;
        protectFoodPhoto(image,item);
        image.src = getOptimizedFoodImageUrl(requestedImage);
      }
      $("[data-discount]", card).textContent = item.discountPercent + "% OFF";
      const dietIndicator = $("[data-diet-indicator]", card);
      dietIndicator.classList.toggle("diet-veg", Boolean(item.isVeg));
      dietIndicator.classList.toggle("diet-nonveg", !item.isVeg);
      dietIndicator.setAttribute("aria-label", item.isVeg ? "Vegetarian" : "Non-vegetarian");
      $("[data-category-label]", card).textContent = item.category;
      $("[data-prep]", card).textContent = item.prepTime + " min";
      $("[data-name]", card).textContent = item.name;
      $("[data-description]", card).textContent = item.description;
      $("[data-price]", card).textContent = money(item.price);
      $("[data-original]", card).textContent = money(item.originalPrice);
      $("[data-badge]", card).textContent = item.badge || "";
      const favourite = $("[data-favourite]", card);
      const saved = state.favourites.includes(item.id);
      favourite.classList.toggle("is-saved", saved);
      favourite.textContent = saved ? "♥" : "♡";
      favourite.setAttribute("aria-label", saved ? "Remove from favourites" : "Add to favourites");
      orderedCards.push(card);
    });
    const currentCards = Array.from(grid.children);
    const wantedCards = new Set(orderedCards);
    currentCards.forEach(card => { if (!wantedCards.has(card)) card.remove(); });
    let orderChanged = grid.children.length !== orderedCards.length;
    orderedCards.forEach((card,index) => {
      const current = grid.children[index];
      if (current !== card) {
        orderChanged = true;
        grid.insertBefore(card,current || null);
      }
    });
    if (orderChanged && typeof grid.animate === "function" &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      grid.animate([{ opacity:.82 },{ opacity:1 }], { duration:150, easing:"cubic-bezier(.2,.7,.2,1)" });
    }
  }

  let menuSearchTimer = null;
  function scheduleMenuRender() {
    if (menuSearchTimer) window.clearTimeout(menuSearchTimer);
    menuSearchTimer = window.setTimeout(() => {
      menuSearchTimer = null;
      renderMenu();
    }, 160);
  }


  function customizerAddons(item) {
    const category = String(item.category || "").toLowerCase();
    if (category === "pizza") return [
      { name: "Extra cheese", price: 35 },
      { name: item.isVeg ? "Extra paneer" : "Extra chicken", price: item.isVeg ? 49 : 59 },
      { name: "Jalapeños", price: 20 },
      { name: "Black olives", price: 25 },
      { name: "Chilli flakes", price: 0 }
    ];
    if (category === "burgers") return [
      { name: "Extra cheese", price: 29 },
      { name: item.isVeg ? "Extra paneer patty" : "Extra chicken patty", price: item.isVeg ? 49 : 69 },
      { name: "Fries combo", price: 69 },
      { name: "Signature dip", price: 20 }
    ];
    if (["pasta", "bowls", "indian"].includes(category)) return [
      { name: "Extra cheese", price: 29 },
      { name: item.isVeg ? "Extra paneer" : "Extra chicken", price: item.isVeg ? 49 : 59 },
      { name: "Extra sauce / gravy", price: 25 },
      { name: "Garlic bread", price: 49 }
    ];
    if (category === "desserts") return [
      { name: "Ice cream scoop", price: 39 },
      { name: "Whipped cream", price: 19 },
      { name: "Chocolate drizzle", price: 20 }
    ];
    if (category === "drinks") return [
      { name: "Extra espresso shot", price: 35 },
      { name: "Whipped cream", price: 19 },
      { name: "Vanilla scoop", price: 29 }
    ];
    return [
      { name: "Signature dip", price: 20 },
      { name: "Extra cheese", price: 25 },
      { name: "Make it loaded", price: 35 }
    ];
  }

  function customizerPreferences(item) {
    const category = String(item.category || "").toLowerCase();
    if (category === "drinks") return ["Less ice", "No added sugar", "Extra chilled"];
    if (category === "desserts") return ["Warm it slightly", "No extra drizzle"];
    if (category === "burgers" || category === "pizza" || category === "sides") return ["Less spicy", "Extra spicy", "Extra crispy", "No onion"];
    return ["Less spicy", "Medium spicy", "Extra spicy", "No onion", "Sauce on the side"];
  }

  function customizerSizes(item) {
    const category = String(item.category || "").toLowerCase();
    const largePrice = category === "drinks" ? 30 : category === "desserts" ? 35 : category === "sides" ? 29 : 49;
    return [{ name: "Regular", price: 0, note: "Classic portion" }, { name: category === "drinks" ? "Large" : category === "desserts" ? "Double treat" : "Large", price: largePrice, note: "Larger portion" }];
  }

  function openDishDetails(id) {
    const item = state.menu.find(product => product.id === id);
    if (!item) return;
    state.currentCustomizer = id;
    state.customizerQuantity = 1;
    const customizerImage=$("#customizerImage");
    protectDetailFoodPhoto(customizerImage,item,state.imageFallbacks[id]||item.image);
    $("#customizerTitle").textContent = item.name;
    $("#customizerDescription").textContent = item.description;
    $("#customizerBasePrice").textContent = money(item.price);
    const saved = state.customizations[id] || {};
    const sizes = customizerSizes(item);
    $("#customizerSizeOptions").innerHTML = sizes.map((size,index) =>
      '<label class="customizer-choice"><input type="radio" name="dishSize" value="' + escapeHTML(size.name) + '" data-extra="' + size.price + '"' + ((saved.size || "Regular") === size.name ? " checked" : (!saved.size && index === 0 ? " checked" : "")) + '><span>' + escapeHTML(size.name) + '<small>' + escapeHTML(size.note) + '</small></span><strong>' + (size.price ? "+" + money(size.price) : "Included") + '</strong></label>'
    ).join("");
    const addons = customizerAddons(item);
    const savedExtras = Array.isArray(saved.extras) ? saved.extras.map(extra => extra.name) : [];
    $("#customizerAddonOptions").innerHTML = addons.map(addon =>
      '<label class="customizer-addon"><input type="checkbox" name="dishAddon" value="' + escapeHTML(addon.name) + '" data-price="' + addon.price + '"' + (savedExtras.includes(addon.name) ? " checked" : "") + '><span>' + escapeHTML(addon.name) + '</span><strong>' + (addon.price ? "+" + money(addon.price) : "Free") + '</strong></label>'
    ).join("");
    const preferences = customizerPreferences(item);
    const savedPreferences = Array.isArray(saved.preferences) ? saved.preferences : [];
    $("#customizerPreferenceOptions").innerHTML = preferences.map(preference =>
      '<label class="customizer-preference"><input type="checkbox" name="dishPreference" value="' + escapeHTML(preference) + '"' + (savedPreferences.includes(preference) ? " checked" : "") + '>' + escapeHTML(preference) + '</label>'
    ).join("");
    $("#customizerNote").value = saved.note || "";
    $("#customizerQty").textContent = "1";
    updateCustomizerTotal();
    openDialog("dishDetailDialog");
  }

  function updateCustomizerTotal() {
    if (!state.currentCustomizer) return;
    const item = state.menu.find(product => product.id === state.currentCustomizer);
    if (!item) return;
    const size = $('input[name="dishSize"]:checked');
    const sizeExtra = Number(size ? size.dataset.extra : 0);
    const extras = $$('input[name="dishAddon"]:checked').reduce((sum,input) => sum + Number(input.dataset.price || 0), 0);
    const unit = item.price + sizeExtra + extras;
    $("#customizerUnitPrice").textContent = money(unit);
    $("#customizerTotal").textContent = money(unit * state.customizerQuantity);
    $("#customizerQty").textContent = state.customizerQuantity;
  }

  function addCustomizedDish(event) {
    event.preventDefault();
    const id = state.currentCustomizer;
    const item = state.menu.find(product => product.id === id);
    if (!item) return;
    const size = $('input[name="dishSize"]:checked');
    const extras = $$('input[name="dishAddon"]:checked').map(input => ({ name: input.value, price: Number(input.dataset.price || 0) }));
    const preferences = $$('input[name="dishPreference"]:checked').map(input => input.value);
    state.customizations[id] = {
      size: size ? size.value : "Regular",
      sizeExtra: Number(size ? size.dataset.extra : 0),
      extras,
      preferences,
      note: $("#customizerNote").value.trim()
    };
    state.cart[id] = Math.min(20, (state.cart[id] || 0) + state.customizerQuantity);
    saveStore(STORAGE.cart, state.cart);
    saveStore("foodiehub.customizations.v1", state.customizations);
    renderCart();
    const card = $$("#menuGrid .dish-card").find(element => $("[data-name]",element)?.textContent === item.name) || null;
    const addButton = card ? $('[data-add]', card) : null;
    animateAddToCart(addButton);
    closeDialog("dishDetailDialog");
    showToast(item.name + " customised and added to your bag.");
  }

  function toggleFavourite(id) {
    state.favourites = state.favourites.includes(id)
      ? state.favourites.filter(itemId => itemId !== id)
      : [...state.favourites, id];
    saveStore(STORAGE.favourites, state.favourites);
    renderMenu();
    showToast(state.favourites.includes(id) ? "Added to favourites." : "Removed from favourites.");
  }

  function addToCart(id, button) {
    state.cart[id] = (state.cart[id] || 0) + 1;
    saveStore(STORAGE.cart, state.cart);
    renderCart();
    animateAddToCart(button);
    showToast("Item added to your bag.");
  }

  function animateAddToCart(button) {
    const cartButton = $("#openCart");
    const card = button ? button.closest(".dish-card") : null;
    const sourceImage = card ? $(".dish-image", card) : null;
    if (button) {
      button.classList.add("is-added");
      button.innerHTML = '<span aria-hidden="true">✓</span> Added';
      window.setTimeout(() => {
        if (button.isConnected) {
          button.classList.remove("is-added");
          button.innerHTML = '<span aria-hidden="true">＋</span> Add';
        }
      }, 900);
    }
    if (!cartButton || !sourceImage || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const from = sourceImage.getBoundingClientRect();
    const to = cartButton.getBoundingClientRect();
    const flyer = document.createElement("img");
    flyer.className = "cart-flight";
    flyer.src = sourceImage.currentSrc || sourceImage.src;
    flyer.alt = "";
    flyer.setAttribute("aria-hidden", "true");
    flyer.style.left = (from.left + from.width / 2 - 28) + "px";
    flyer.style.top = (from.top + from.height / 2 - 28) + "px";
    document.body.appendChild(flyer);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const flight = flyer.animate([
      { transform: "translate3d(0,0,0) scale(1)", opacity: 1 },
      { transform: "translate3d(" + dx + "px," + dy + "px,0) scale(.18)", opacity: .15 }
    ], { duration: 440, easing: "cubic-bezier(.22,.72,.28,1)" });
    flight.onfinish = () => flyer.remove();
    cartButton.classList.remove("cart-bump");
    $("#cartCount").classList.remove("count-pop");
    window.requestAnimationFrame(() => {
      if (!cartButton.isConnected) return;
      cartButton.classList.add("cart-bump");
      $("#cartCount").classList.add("count-pop");
      window.setTimeout(() => cartButton.classList.remove("cart-bump"), 420);
      window.setTimeout(() => $("#cartCount").classList.remove("count-pop"), 380);
    });
  }

  function changeQuantity(id, change) {
    const next = (state.cart[id] || 0) + change;
    if (next <= 0) delete state.cart[id];
    else state.cart[id] = Math.min(20, next);
    saveStore(STORAGE.cart, state.cart);
    renderCart();
  }

  function getCartLines() {
    return Object.entries(state.cart).map(([id, quantity]) => {
      const item = state.menu.find(product => product.id === id);
      if (!item) return null;
      const customization = state.customizations[id] || {};
      const extras = Array.isArray(customization.extras) ? customization.extras : [];
      const unitPrice = item.price + Number(customization.sizeExtra || 0) + extras.reduce((sum, extra) => sum + Number(extra.price || 0), 0);
      return { ...item, quantity, customization, price: unitPrice, basePrice: item.price };
    }).filter(Boolean);
  }

  function calculateBill() {
    const lines = getCartLines();
    const subtotal = lines.reduce((sum, item) => sum + item.price * item.quantity, 0);
    let couponDiscount = 0;
    if (state.coupon && subtotal >= state.coupon.minimum) {
      couponDiscount = Math.min(Math.round(subtotal * state.coupon.percent / 100), state.coupon.maximum);
    }
    if (state.coupon && state.coupon.fixed && subtotal >= (state.coupon.minimum || 0)) couponDiscount = Math.min(Number(state.coupon.fixed), subtotal);
    const delivery = subtotal === 0 || subtotal >= 499 ? 0 : 39;
    const taxable = Math.max(0, subtotal - couponDiscount);
    const tax = Math.round(taxable * 0.05);
    return { lines, subtotal, couponDiscount, delivery, tax, total: taxable + delivery + tax };
  }

  function renderCheckoutReview(bill) {
    const items = $("#checkoutReviewItems");
    if (!items) return;
    const lines = bill.lines || [];
    if (!lines.length) {
      items.innerHTML = '<p class="checkout-review-empty">Your selected dishes will appear here.</p>';
    } else {
      items.innerHTML = lines.map(item => {
        const custom = item.customization || {};
        const details = [
          custom.size && custom.size !== "Regular" ? custom.size : "",
          ...(Array.isArray(custom.extras) ? custom.extras.map(extra => extra.name) : []),
          ...(Array.isArray(custom.preferences) ? custom.preferences : [])
        ].filter(Boolean);
        return '<div class="checkout-review-item"><div><strong>' + item.quantity + ' × ' + escapeHTML(item.name) + '</strong>' +
          (details.length ? '<small>' + escapeHTML(details.join(" · ")) + '</small>' : '') +
          '</div><strong>' + money(item.price * item.quantity) + '</strong></div>';
      }).join("");
    }
    $("#checkoutReviewSubtotal").textContent = money(bill.subtotal);
    $("#checkoutReviewDiscount").textContent = "−" + money(bill.couponDiscount);
    $("#checkoutReviewDelivery").textContent = bill.delivery ? money(bill.delivery) : "FREE";
    $("#checkoutReviewTax").textContent = money(bill.tax);
    $("#checkoutTotal").textContent = money(bill.total);
  }

  function renderCart() {
    const bill = calculateBill();
    const count = bill.lines.reduce((sum, item) => sum + item.quantity, 0);
    $("#cartCount").textContent = count;
    const mobileCartCount = $("#mobileCartCount");
    if (mobileCartCount) {
      mobileCartCount.textContent = count > 99 ? "99+" : String(count);
      mobileCartCount.hidden = count === 0;
    }
    $("#drawerItemCount").textContent = "(" + count + ")";
    const checkoutButton = $("#checkoutButton");
    checkoutButton.disabled = count === 0;
    checkoutButton.setAttribute("aria-disabled", count === 0 ? "true" : "false");
    checkoutButton.title = count === 0 ? "Add at least one dish to continue" : "Continue to checkout";
    $("#billSubtotal").textContent = money(bill.subtotal);
    $("#billDiscount").textContent = "−" + money(bill.couponDiscount);
    $("#billDelivery").textContent = bill.delivery ? money(bill.delivery) : (bill.subtotal ? "FREE" : money(0));
    $("#billTax").textContent = money(bill.tax);
    $("#billTotal").textContent = money(bill.total);
    $("#checkoutTotal").textContent = money(bill.total);
    renderCheckoutReview(bill);

    if (bill.subtotal >= 499) {
      $("#deliveryMessage").textContent = "Free delivery unlocked.";
      $("#deliveryProgress").classList.add("delivery-unlocked");
    } else {
      $("#deliveryMessage").textContent = bill.subtotal ? "Add " + money(499 - bill.subtotal) + " more for free delivery." : "Add items worth ₹499 for free delivery.";
      $("#deliveryProgress").classList.remove("delivery-unlocked");
    }

    const container = $("#cartItems");
    if (!bill.lines.length) {
      container.innerHTML = '<div class="cart-empty"><span class="cart-empty-icon">♡</span><h3>Your bag is empty.</h3><p>Add an item from the menu to get started.</p><button class="text-link" id="continueShopping" type="button">Browse menu →</button></div>';
      $("#continueShopping").addEventListener("click", closeCart);
    } else {
      container.innerHTML = bill.lines.map(item => (
        '<article class="cart-line">' +
          '<img data-food-id="' + escapeHTML(item.id) + '" src="' + escapeHTML(getOptimizedFoodImageUrl(state.imageFallbacks[item.id] || item.image)) + '" alt="" loading="lazy" decoding="async">' +
          '<div class="cart-line-info"><strong>' + escapeHTML(item.name) + '</strong><small>' + money(item.price) + ' each</small>' +
            (item.customization && (item.customization.size || (item.customization.extras || []).length || (item.customization.preferences || []).length || item.customization.note) ? '<small class="cart-line-customization">' + escapeHTML([item.customization.size || "Regular", ...(item.customization.extras || []).map(extra => extra.name), ...(item.customization.preferences || []), item.customization.note].filter(Boolean).join(" · ")) + '</small>' : '') +
            '<div class="quantity-control"><button type="button" data-quantity="' + item.id + '" data-change="-1" aria-label="Remove one">−</button><span>' + item.quantity + '</span><button type="button" data-quantity="' + item.id + '" data-change="1" aria-label="Add one">+</button></div>' +
          '</div><strong class="cart-line-total">' + money(item.price * item.quantity) + '</strong>' +
        '</article>'
      )).join("");
      $$("[data-quantity]", container).forEach(button => {
        button.addEventListener("click", () => changeQuantity(button.dataset.quantity, Number(button.dataset.change)));
      });
      $$(".cart-line img[data-food-id]",container).forEach(image=>{
        const dish=state.menu.find(product=>product.id===image.dataset.foodId);
        if(dish)protectFoodPhoto(image,dish);
      });
    }
    if (state.coupon && bill.subtotal < state.coupon.minimum) {
      $("#couponMessage").textContent = "Add " + money(state.coupon.minimum - bill.subtotal) + " more to use " + state.coupon.code + ".";
      $("#couponMessage").className = "coupon-message message-warning";
    } else if (state.coupon) {
      $("#couponMessage").textContent = state.coupon.code + " applied. You're saving " + money(bill.couponDiscount) + ".";
      $("#couponMessage").className = "coupon-message message-success";
    }
  }

  function openCart() {
    $("#cartDrawer").classList.add("is-open");
    $("#cartDrawer").setAttribute("aria-hidden", "false");
    $("#cartBackdrop").classList.add("is-visible");
    document.body.classList.add("drawer-open");
    $("#closeCart").focus();
  }

  function closeCart() {
    $("#cartDrawer").classList.remove("is-open");
    $("#cartDrawer").setAttribute("aria-hidden", "true");
    $("#cartBackdrop").classList.remove("is-visible");
    document.body.classList.remove("drawer-open");
  }

  function applyCoupon() {
    const code = $("#couponInput").value.trim().toUpperCase();
    const coupons = {
      HUB50: { code: "HUB50", percent: 50, maximum: 200, minimum: 699 },
      FOOD25: { code: "FOOD25", percent: 25, maximum: 100, minimum: 299 },
      COMBO10: { code: "COMBO10", percent: 10, maximum: 150, minimum: 199 },
      REWARD25: { code: "REWARD25", fixed: 25, percent: 0, maximum: 25, minimum: 249 }
    };
    if (!coupons[code]) {
      state.pendingRewardRedemption = false;
      state.coupon = null;
      $("#couponMessage").textContent = "Invalid offer code. Use HUB50, FOOD25 or COMBO10, or redeem your reward points.";
      $("#couponMessage").className = "coupon-message message-warning";
    } else if (calculateBill().subtotal < coupons[code].minimum) {
      state.pendingRewardRedemption = code === "REWARD25";
      state.coupon = coupons[code];
      $("#couponMessage").textContent = "Add " + money(coupons[code].minimum - calculateBill().subtotal) + " more to unlock " + code + ".";
      $("#couponMessage").className = "coupon-message message-warning";
    } else {
      state.pendingRewardRedemption = code === "REWARD25";
      state.coupon = coupons[code];
      $("#couponMessage").textContent = code + " applied. Your order discount is active.";
      $("#couponMessage").className = "coupon-message message-success";
      showToast("Offer applied successfully.");
    }
    renderCart();
  }

  function updatePaymentButtonLabel(method) {
    const button = $(".place-order-button");
    if (!button) return;
    const labels = {
      razorpay: "Continue to secure payment",
      cod: "Place COD order",
      upi_at_door: "Place UPI on delivery order"
    };
    button.textContent = labels[method] || "Choose a payment method";
  }

  function renderPaymentAvailability() {
    const onlineOption = $("#onlinePaymentChoice");
    const onlineInput = onlineOption && onlineOption.querySelector('input[name="paymentMethod"]');
    const onlineDescription = onlineOption && onlineOption.querySelector("small");
    const note = $("#paymentAvailabilityNote");
    if (!onlineOption || !onlineInput || !note) return;
    onlineOption.hidden = false;
    onlineInput.disabled = !state.paymentGateway.enabled;
    onlineOption.classList.toggle("is-unavailable", !state.paymentGateway.enabled);
    onlineOption.setAttribute("aria-disabled", String(!state.paymentGateway.enabled));
    if (onlineDescription) {
      onlineDescription.textContent = state.paymentGateway.enabled
        ? "UPI, cards, netbanking and more"
        : "Unavailable. Complete the payment gateway setup on the server.";
    }
    note.textContent = state.paymentGateway.enabled
      ? "Online payment is available. Select this option to continue to the secure payment window."
      : "Online payment is unavailable. Choose Cash on Delivery or UPI on delivery to continue.";
  }

  function openCheckout() {
    if (!getCartLines().length) {
      showToast("Your bag is empty. Add an item before checkout.", "error");
      openCart();
      return;
    }
    closeCart();
    $("#checkoutError").textContent = "";
    const checkoutForm = $("#checkoutForm");
    checkoutForm.reset();
    ["name", "phone", "email"].forEach(field => {
      checkoutForm.elements.namedItem(field).value = state.profile[field] || "";
    });
    fillAddressFields(checkoutForm,state.profile.addressDetails||{});
    showLegacyAddress("checkoutLegacyAddress",state.profile);
    updateAddressPreview("checkoutForm","checkoutAddressPreview");
    $("#saveCheckoutProfile").checked = true;
    if (!state.checkoutIdempotencyKey) state.checkoutIdempotencyKey = createCheckoutIdempotencyKey();
    updatePaymentButtonLabel("");
    renderPaymentAvailability();
    renderCart();
    openDialog("checkoutDialog");
  }

  function saveLocalOrder(order) {
    state.orders.unshift(order);
    saveStore(STORAGE.orders, state.orders);
  }

  function finalizeOrder(order, customer, payload, paymentMode) {
    state.checkoutIdempotencyKey = "";
    const appliedCouponCode = state.coupon ? state.coupon.code : "";
    if (appliedCouponCode === "REWARD25" && state.pendingRewardRedemption) {
      state.rewards.points = Math.max(0, Number(state.rewards.points || 0) - 50);
    }
    const pointsEarned = Math.max(0, Math.floor(Number(order.total || calculateBill().total) / 10));
    state.rewards.points = Number(state.rewards.points || 0) + pointsEarned;
    state.rewards.lifetime = Number(state.rewards.lifetime || 0) + pointsEarned;
    saveStore(STORAGE.rewards, state.rewards);
    state.pendingRewardRedemption = false;
    renderRewards();
    if ($("#saveCheckoutProfile").checked) {
      state.profile = customer;
      saveStore(STORAGE.profile, state.profile);
      renderProfile();
    }
    state.cart = {};
    state.coupon = null;
    saveStore(STORAGE.cart, state.cart);
    renderCart();
    closeDialog("checkoutDialog");
    $("#successOrderNumber").textContent = order.orderNumber;
    const defaultMessage = paymentMode === "online"
      ? "Your payment was verified securely and your order is confirmed."
      : (state.backendOnline
        ? "Your order has been saved by FoodieHub. Keep this number handy for updates."
        : "This demo order is stored on this device only. Connect the backend to share order data across devices.");
    $("#successMessage").textContent = (order.message || defaultMessage) + (pointsEarned ? " You earned " + pointsEarned + " Foodie Points!" : "");
    openDialog("successDialog");
  }

  let razorpayLoadPromise = null;
  function loadRazorpayCheckout() {
    if (window.Razorpay) return Promise.resolve();
    if (razorpayLoadPromise) return razorpayLoadPromise;
    let script = document.querySelector("script[data-razorpay-checkout]");
    if (script && (script.dataset.failed === "true" || script.dataset.loaded === "true")) {
      script.remove();
      script = null;
    }
    razorpayLoadPromise = new Promise((resolve, reject) => {
      const activeScript = script || document.createElement("script");
      const fail = () => {
        activeScript.dataset.failed = "true";
        activeScript.remove();
        reject(new Error("The secure payment window could not be loaded. Please check your connection and try again."));
      };
      activeScript.addEventListener("load", () => {
        activeScript.dataset.loaded = "true";
        if (window.Razorpay) resolve();
        else fail();
      }, { once: true });
      activeScript.addEventListener("error", fail, { once: true });
      if (!script) {
        activeScript.src = "https://checkout.razorpay.com/v1/checkout.js";
        activeScript.async = true;
        activeScript.dataset.razorpayCheckout = "true";
        document.head.appendChild(activeScript);
      } else if (window.Razorpay) {
        resolve();
      }
    }).catch(error => {
      razorpayLoadPromise = null;
      throw error;
    });
    return razorpayLoadPromise;
  }

  async function startOnlinePayment(payload, customer) {
    if (!state.backendOnline || !state.paymentGateway.enabled) {
      throw new Error("Online payments are not configured yet. Choose Cash on Delivery or UPI on Delivery.");
    }
    const order = await request("/api/payments/create-order", {
      method: "POST",
      headers: { "Idempotency-Key": state.checkoutIdempotencyKey },
      body: JSON.stringify(payload)
    });
    if (order.alreadyPaid) {
      finalizeOrder(order, customer, payload, "online");
      return;
    }
    await loadRazorpayCheckout();
    const checkout = new window.Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: "FoodieHub",
      description: "FoodieHub order " + order.orderNumber,
      order_id: order.razorpayOrderId,
      prefill: { name: customer.name, email: customer.email, contact: customer.phone },
      notes: { foodHubOrderNumber: order.orderNumber },
      theme: { color: document.documentElement.dataset.theme === "dark" ? "#467d58" : "#2c6547" },
      handler: async response => {
        try {
          const verified = await request("/api/payments/verify", {
            method: "POST",
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            })
          });
          finalizeOrder(verified, customer, payload, "online");
        } catch (error) {
          $("#checkoutError").textContent = error.message || "We could not verify this payment. Your bag has been kept. Please contact support before retrying.";
          showToast("Payment verification needs attention. Your bag has been kept.", "error");
        }
      },
      modal: {
        ondismiss: () => {
          $("#checkoutError").textContent = "Payment was not completed. Your bag is still saved, so you can try again.";
        }
      }
    });
    checkout.on("payment.failed", response => {
      const description = response && response.error && response.error.description;
      $("#checkoutError").textContent = description || "Payment failed. Your bag is still saved; please try again.";
    });
    checkout.open();
  }

  async function placeOrder(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const paymentMethod = String(form.get("paymentMethod") || "");
    if (!paymentMethod) {
      $("#checkoutError").textContent = "Choose a payment method before placing your order. COD and UPI on delivery are paid at your door; they do not open an online payment page.";
      const firstChoice = event.currentTarget.querySelector('input[name="paymentMethod"]:not(:disabled)');
      if (firstChoice) firstChoice.focus();
      return;
    }
    if (paymentMethod === "razorpay" && (!state.backendOnline || !state.paymentGateway.enabled)) {
      $("#checkoutError").textContent = "Online payment is not active yet. Connect the hosted FoodieHub API and Razorpay server keys first.";
      return;
    }
    const addressDetails=readAddressDetails(form);
    const customer = {
      name: String(form.get("name") || "").trim(),
      phone: String(form.get("phone") || "").replace(/\D/g, "").slice(-10),
      email: String(form.get("email") || "").trim(),
      addressDetails,
      address: formatDeliveryAddress(addressDetails)
    };
    if (customer.name.length < 2) {
      $("#checkoutError").textContent = "Please enter your name.";
      return;
    }
    if (customer.phone.length !== 10 || !/^[6-9]/.test(customer.phone)) {
      $("#checkoutError").textContent = "Please enter a valid 10-digit Indian mobile number.";
      return;
    }
    const missingAddressField=ADDRESS_FIELDS.filter(field=>!["building","landmark"].includes(field)&&!addressDetails[field]);
    if(missingAddressField.length){
      $("#checkoutError").textContent = "Please complete all required delivery address fields.";
      const firstMissing=event.currentTarget.elements.namedItem(missingAddressField[0]);
      if(firstMissing)firstMissing.focus();
      return;
    }
    if(!/^[1-9][0-9]{5}$/.test(addressDetails.pincode)){
      $("#checkoutError").textContent = "Enter a valid 6-digit Indian PIN code.";
      event.currentTarget.elements.namedItem("pincode").focus();
      return;
    }
    const payload = {
      customer,
      items: getCartLines().map(item => ({ productId: item.id, quantity: item.quantity, customizations: item.customization || {} })),
      couponCode: state.coupon ? state.coupon.code : "",
      paymentMethod
    };
    if (!payload.items.length) {
      $("#checkoutError").textContent = "Your bag is empty. Add an item before placing the order.";
      return;
    }
    const submit = $(".place-order-button");
    submit.disabled = true;
    submit.textContent = paymentMethod === "razorpay" ? "Opening secure payment…" : "Placing your order…";
    try {
      if (paymentMethod === "razorpay") {
        await startOnlinePayment(payload, customer);
        return;
      }
      let order;
      if (state.backendOnline) {
        order = await request("/api/orders", {
          method: "POST",
          headers: { "Idempotency-Key": state.checkoutIdempotencyKey },
          body: JSON.stringify(payload)
        });
      } else {
        const bill = calculateBill();
        order = {
          orderNumber: "FH-" + Date.now().toString(36).toUpperCase(),
          status: "demo_saved",
          total: bill.total,
          createdAt: new Date().toISOString(),
          message: "Demo order saved on this device only."
        };
        saveLocalOrder({ ...order, phone: customer.phone, items: payload.items, customer, addressDetails: customer.addressDetails, paymentMethod });
      }
      finalizeOrder(order, customer, payload, "delivery");
    } catch (error) {
      $("#checkoutError").textContent = error.message || "We couldn't place that order. Please try again.";
    } finally {
      submit.disabled = false;
      updatePaymentButtonLabel(paymentMethod);
    }
  }

  function normalizeOrderNumber(order) {
    if (typeof order === "string") return order.trim().toUpperCase();
    return String(order && (order.orderNumber || order.order_number || order.number) || "").trim().toUpperCase();
  }

  function normalizeOrderPhone(order) {
    const raw = order && (order.phone || (order.customer && order.customer.phone));
    return String(raw || "").replace(/\D/g, "").slice(-10);
  }

  function findLocalOrder(orderNumber, phone) {
    const requestedNumber = String(orderNumber || "").trim().toUpperCase();
    const requestedPhone = String(phone || "").replace(/\D/g, "").slice(-10);
    return state.orders.find(item =>
      normalizeOrderNumber(item) === requestedNumber &&
      normalizeOrderPhone(item) === requestedPhone
    );
  }

  function openTracking(preselectedOrderNumber = "") {
    closeCart();
    const form = $("#trackingForm");
    form.reset();
    $("#trackingError").textContent = "";
    $("#trackingResult").hidden = true;

    const phone = normalizeOrderPhone({ phone: state.profile.phone });
    form.elements.namedItem("phone").value = phone;
    $("#trackingHelper").textContent = phone
      ? "Mobile number filled from your profile. It must match the number used at checkout."
      : "Enter the mobile number used at checkout, or save it in your Profile first.";

    const matches = phone
      ? state.orders
          .filter(order => normalizeOrderPhone(order) === phone && normalizeOrderNumber(order))
          .slice()
          .sort((a, b) => new Date(b.createdAt || b.created_at || 0) - new Date(a.createdAt || a.created_at || 0))
          .slice(0, 6)
      : [];

    const select = $("#trackingRecentSelect");
    select.innerHTML = '<option value="">Choose an order (optional)</option>' + matches.map(order => {
      const number = normalizeOrderNumber(order);
      const date = customerOrderDate(order);
      return '<option value="' + escapeHTML(number) + '">' +
        escapeHTML(number + " · " + date + " · " + money(order.total || 0)) +
        '</option>';
    }).join("");
    $("#trackingRecentWrap").hidden = !matches.length;

    if (preselectedOrderNumber) {
      form.elements.namedItem("orderNumber").value = String(preselectedOrderNumber).trim().toUpperCase();
      select.value = String(preselectedOrderNumber).trim().toUpperCase();
    } else if (matches.length) {
      $("#trackingHelper").textContent = "Choose a recent order above, or type the order number from your confirmation.";
    }
    openDialog("trackingDialog");
  }

  async function trackOrder(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const orderNumber = String(form.get("orderNumber") || "").trim().toUpperCase();
    const phone = String(form.get("phone") || "").replace(/\D/g, "").slice(-10);
    const error = $("#trackingError");
    const result = $("#trackingResult");
    const submit = formElement.querySelector('button[type="submit"]');

    error.textContent = "";
    result.hidden = true;

    if (!orderNumber) {
      error.textContent = "Choose a recent order or enter your order number.";
      formElement.elements.namedItem("orderNumber").focus();
      return;
    }
    if (!/^[6-9]\d{9}$/.test(phone)) {
      error.textContent = "Enter the same valid 10-digit mobile number used at checkout.";
      formElement.elements.namedItem("phone").focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = "Finding your order…";
    try {
      let order = null;
      let apiError = null;

      if (state.backendOnline) {
        try {
          order = await request(
            "/api/orders/track?order=" + encodeURIComponent(orderNumber) +
            "&phone=" + encodeURIComponent(phone)
          );
        } catch (errorFromApi) {
          apiError = errorFromApi;
          order = findLocalOrder(orderNumber, phone);
          if (!order) throw apiError;
        }
      } else {
        order = findLocalOrder(orderNumber, phone);
      }

      if (order && order.order) order = order.order;
      if (!order) {
        throw new Error(state.backendOnline
          ? "No order matched those details. Check the order ID and mobile number."
          : "This order is not saved on this device. Use the device where the order was placed.");
      }

      const canonicalNumber = normalizeOrderNumber(order) || orderNumber;
      const rawStatus = String(order.status || "confirmed").toLowerCase();
      const stages = [
        { key: "confirmed", label: "Order placed", detail: "We've received your order." },
        { key: "preparing", label: "Preparing", detail: "Your order has been received and is being prepared." },
        { key: "out_for_delivery", label: "On the way", detail: "Your order is out for delivery." },
        { key: "delivered", label: "Delivered", detail: "Enjoy every bite!" }
      ];
      const currentStage = rawStatus === "demo_saved" ? 0 : stages.findIndex(stage => stage.key === rawStatus);
      const isCancelled = rawStatus === "cancelled";
      const stageMarkup = stages.map((stage, index) => {
        const complete = !isCancelled && currentStage >= index;
        const active = !isCancelled && currentStage === index;
        return '<li class="tracking-step ' + (complete ? "is-complete " : "") +
          (active ? "is-current" : "") + '"><span class="tracking-step-mark">' +
          (complete ? "✓" : String(index + 1)) + '</span><span><strong>' +
          stage.label + '</strong><small>' + stage.detail + '</small></span></li>';
      }).join("");
      const statusLabel = isCancelled
        ? "Order cancelled"
        : (rawStatus === "demo_saved"
          ? "Demo order received"
          : (stages[Math.max(0, currentStage)] || stages[0]).label);
      const total = Number(order.total || 0);

      result.innerHTML =
        '<span class="tracking-status-dot' + (isCancelled ? ' is-cancelled' : '') + '"></span>' +
        '<span class="drawer-kicker">ORDER ' + escapeHTML(canonicalNumber) + '</span>' +
        '<h3>' + escapeHTML(statusLabel) + '</h3>' +
        '<p>' + escapeHTML(order.message || "Order details updated.") + '</p>' +
        (isCancelled
          ? '<p class="tracking-cancelled">This order was cancelled. Please contact the team if you need help.</p>'
          : '<ol class="tracking-steps">' + stageMarkup + '</ol>') +
        '<div class="tracking-total"><span>Order total</span><strong>' + money(total) + '</strong></div>';
      result.hidden = false;
    } catch (trackingError) {
      error.textContent = trackingError && trackingError.message
        ? trackingError.message
        : "We couldn't find that order. Please check the details and try again.";
    } finally {
      submit.disabled = false;
      submit.innerHTML = 'Show my order status <span aria-hidden="true">→</span>';
    }
  }

  async function subscribe(event) {
    event.preventDefault();
    const email = $("#newsletterEmail").value.trim();
    const message = $("#newsletterMessage");
    try {
      if (state.backendOnline) {
        await request("/api/newsletter", { method: "POST", body: JSON.stringify({ email }) });
        message.textContent = "Thanks for your interest. Newsletter sign-ups are not stored in this demo.";
      } else {
        message.textContent = "Newsletter sign-ups are unavailable in this demo.";
      }
      event.currentTarget.reset();
    } catch (error) {
      message.textContent = error.message;
    }
  }


  const SMART_COMBOS = [
    { id:"house",title:"Burger Combo",subtitle:"Mushroom burger, masala fries and mint cooler.",ids:["truffle-mushroom-burger","classic-masala-fries","mint-lime-cooler"],tag:"POPULAR" },
    { id:"fire",title:"Peri-Peri Combo",subtitle:"Paneer burger, peri-peri fries and mango shake.",ids:["peri-peri-paneer-burger","loaded-peri-peri-fries","mango-milkshake"],tag:"SPICY" },
    { id:"slow",title:"Pasta & Dessert Combo",subtitle:"Pink sauce pasta, lava cake and iced mocha.",ids:["creamy-pink-sauce-pasta","dark-chocolate-lava-cake","iced-mocha"],tag:"PASTA & DESSERT" }
  ];
  function findMenuItem(id){return state.menu.find(item=>item.id===id);}
  function mealOptions(categories,veg){return state.menu.filter(item=>categories.includes(item.category)&&(!veg||item.isVeg));}
  function fillMealSelect(id,categories,veg){
    const select=$("#"+id),previous=select.value,items=mealOptions(categories,veg);
    select.innerHTML=items.map(item=>'<option value="'+escapeHTML(item.id)+'">'+escapeHTML(item.name)+' · '+money(item.price)+'</option>').join("");
    if(items.some(item=>item.id===previous))select.value=previous;
  }
  function populateMealBuilder(){
    const veg=$("#mealVegOnly").checked;
    fillMealSelect("mealMain",["Burgers","Pizza","Pasta","Bowls","Indian"],veg);
    fillMealSelect("mealSide",["Sides"],veg);
    fillMealSelect("mealDrink",["Drinks"],veg);
    updateMealSummary();
  }
  function getMealSelection(){return ["mealMain","mealSide","mealDrink"].map(id=>findMenuItem($("#"+id).value)).filter(Boolean);}
  function updateMealSummary(){
    const picks=getMealSelection(),total=picks.reduce((sum,item)=>sum+Number(item.price||0),0),complete=picks.length===3;
    $("#mealSummaryCount").textContent=picks.length+" / 3 picks";
    $("#mealBuilderTotal").textContent=money(total);
    $("#addMealBundle").disabled=!complete;
    $("#mealBuilderSaving").textContent=!complete?"Select a main, side and drink to calculate your total.":total>=199?"COMBO10 can save "+money(Math.min(Math.round(total*.1),150))+" on this eligible combo.":"Add items to reach the ₹199 minimum for COMBO10.";
  }
  function addMealBundle(){
    const picks=getMealSelection();if(picks.length!==3)return;
    picks.forEach(item=>{state.cart[item.id]=Math.min(20,(state.cart[item.id]||0)+1);});
    if(calculateBill().subtotal>=199){
      state.coupon={code:"COMBO10",percent:10,maximum:150,minimum:199};state.pendingRewardRedemption=false;
      $("#couponInput").value="COMBO10";$("#couponMessage").textContent="COMBO10 is active for eligible orders.";$("#couponMessage").className="coupon-message message-success";
    }
    saveStore(STORAGE.cart,state.cart);renderCart();showToast("Meal added to your bag.");
  }
  function renderSmartCombos(){
    const container=$("#comboGrid");if(!container||!state.menu.length)return;
    container.innerHTML=SMART_COMBOS.map(combo=>{
      const items=combo.ids.map(findMenuItem).filter(Boolean);if(items.length!==3)return "";
      const subtotal=items.reduce((sum,item)=>sum+item.price,0),saving=Math.min(Math.round(subtotal*.1),150),hero=items[0];
      return '<article class="combo-card" data-primary-dish="'+escapeHTML(hero.id)+'"><button type="button" class="combo-image combo-image-trigger" data-open-dish="'+escapeHTML(hero.id)+'" aria-label="View details for '+escapeHTML(hero.name)+'"><img src="'+escapeHTML(getOptimizedFoodImageUrl(hero.image))+'" alt="'+escapeHTML(hero.name)+'" loading="lazy" decoding="async"><span>'+escapeHTML(combo.tag)+'</span><strong>'+money(subtotal)+'</strong></button><div class="combo-card-body"><h3><button type="button" class="combo-title-trigger" data-open-dish="'+escapeHTML(hero.id)+'">'+escapeHTML(combo.title)+'</button></h3><p>'+escapeHTML(combo.subtitle)+'</p><ul>'+items.map(item=>'<li><button type="button" class="combo-dish-trigger" data-open-dish="'+escapeHTML(item.id)+'">'+escapeHTML(item.name)+'</button><strong>'+money(item.price)+'</strong></li>').join("")+'</ul><div class="combo-card-footer"><span>Save up to '+money(saving)+' with COMBO10</span><button type="button" class="button button-outline" data-combo="'+combo.id+'">Add combo <span aria-hidden="true">＋</span></button></div></div></article>';
    }).join("");
    $$("#comboGrid img").forEach(img=>{const item=state.menu.find(entry=>entry.name===img.alt);if(item)protectFoodPhoto(img,item);});
  }
  function addSmartCombo(comboId){
    const combo=SMART_COMBOS.find(entry=>entry.id===comboId);if(!combo)return;
    const items=combo.ids.map(findMenuItem).filter(Boolean);if(items.length!==3)return;
    items.forEach(item=>{state.cart[item.id]=Math.min(20,(state.cart[item.id]||0)+1);});
    state.coupon={code:"COMBO10",percent:10,maximum:150,minimum:199};state.pendingRewardRedemption=false;
    $("#couponInput").value="COMBO10";$("#couponMessage").textContent="COMBO10 is active for eligible orders.";
    $("#couponMessage").className="coupon-message message-success";saveStore(STORAGE.cart,state.cart);renderCart();showToast(combo.title+" added. COMBO10 is ready in your bag.");
  }
  function getRecommendedItems(mood){
    let items=[...state.menu];
    if(mood==="budget")items=items.filter(item=>item.price<=200).sort((a,b)=>a.price-b.price);
    else if(mood==="quick")items=items.filter(item=>Number(item.prepTime)<=12).sort((a,b)=>a.prepTime-b.prepTime);
    else if(mood==="veg")items=items.filter(item=>item.isVeg).sort((a,b)=>Number(b.featured)-Number(a.featured));
    else if(mood==="sweet")items=items.filter(item=>item.category==="Desserts");
    else items=items.filter(item=>item.featured).sort((a,b)=>Number(b.featured)-Number(a.featured));
    return items.slice(0,3);
  }
  function renderRecommendations(){
    const container=$("#recommendationGrid");if(!container||!state.menu.length)return;
    const items=getRecommendedItems($("#recommendationMood").value||"popular");
    if(!items.length){container.innerHTML='<p class="recommendation-empty">No matches in that mood yet. Try another pick.</p>';return;}
    container.innerHTML=items.map(item=>'<article class="recommendation-card" data-primary-dish="'+escapeHTML(item.id)+'"><button type="button" class="recommendation-image-trigger" data-open-dish="'+escapeHTML(item.id)+'" aria-label="View details for '+escapeHTML(item.name)+'"><img src="'+escapeHTML(getOptimizedFoodImageUrl(item.image))+'" alt="'+escapeHTML(item.name)+'" loading="lazy" decoding="async"></button><div class="recommendation-card-copy"><span>'+escapeHTML(item.category)+' · '+escapeHTML(String(item.prepTime||"—"))+' min</span><h3><button type="button" class="recommendation-title-trigger" data-open-dish="'+escapeHTML(item.id)+'">'+escapeHTML(item.name)+'</button></h3><p>'+escapeHTML(item.description)+'</p><div><strong>'+money(item.price)+'</strong><button type="button" class="button button-outline" data-recommend-add="'+escapeHTML(item.id)+'">Add <span aria-hidden="true">＋</span></button></div></div></article>').join("");
    $$("#recommendationGrid img").forEach(img=>{const item=state.menu.find(entry=>entry.name===img.alt);if(item)protectFoodPhoto(img,item);});
  }
  function renderRewards(){
    const points=Math.max(0,Number(state.rewards.points||0)),lifetime=Math.max(0,Number(state.rewards.lifetime||0)),progress=points%50;
    $("#rewardPoints").textContent=points.toLocaleString("en-IN");$("#rewardLifetime").textContent=lifetime.toLocaleString("en-IN")+" lifetime points";
    $("#rewardProgressFill").style.width=(progress/50*100)+"%";$("#rewardProgressText").textContent=progress+" / 50 points to your next reward";
    $("#redeemRewards").disabled=points<50;
    $("#rewardMessage").textContent=points>=50?"You have a reward ready. Orders above ₹249 can use it.":"Earn 1 point for every ₹10 spent. Points stay in this browser in this demo.";
  }
  function redeemRewards(){
    const points=Math.max(0,Number(state.rewards.points||0));
    if(points<50){showToast("You need 50 Foodie Points to redeem this reward.","error");return;}
    if(calculateBill().subtotal<249){showToast("Add at least ₹249 to your bag before redeeming.","error");return;}
    state.coupon={code:"REWARD25",fixed:25,percent:0,maximum:25,minimum:249};state.pendingRewardRedemption=true;
    $("#couponInput").value="REWARD25";$("#couponMessage").textContent="50 points will be redeemed for ₹25 off when you place this order.";
    $("#couponMessage").className="coupon-message message-success";renderCart();showToast("Reward unlocked. Complete checkout to use it!");
  }
  function normalizeAdminStatus(status){return status==="demo_saved"?"confirmed":(status||"confirmed");}
  function formatAdminDateKey(date){return date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0");}
  function buildDemoAdminAnalytics(orders){
    const months=new Map(),weeks=new Map();let grossSales=0,deliveredOrders=0,cancelledOrders=0;
    (orders||[]).forEach(order=>{
      const date=new Date(order.created_at||order.createdAt||"");
      const total=Math.max(0,Number(order.total||0));grossSales+=total;
      if(String(order.status||"").toLowerCase()==="delivered")deliveredOrders++;
      if(String(order.status||"").toLowerCase()==="cancelled")cancelledOrders++;
      if(Number.isNaN(date.getTime()))return;
      const monthKey=date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0");
      const monday=new Date(date.getFullYear(),date.getMonth(),date.getDate());monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
      const weekKey=formatAdminDateKey(monday);
      [[months,monthKey],[weeks,weekKey]].forEach(([map,key])=>{if(!map.has(key))map.set(key,{bucket:key,orders:0,revenue:0});const item=map.get(key);item.orders++;item.revenue+=total;});
    });
    const monthly=Array.from(months.values()).sort((a,b)=>a.bucket.localeCompare(b.bucket));
    const weekly=Array.from(weeks.values()).sort((a,b)=>a.bucket.localeCompare(b.bucket));
    const totalOrders=(orders||[]).length;
    return {summary:{totalOrders,grossSales,averageOrder:totalOrders?grossSales/totalOrders:0,deliveredOrders,cancelledOrders,activeMonths:monthly.length,activeWeeks:weekly.length,averagePerActiveMonth:monthly.length?totalOrders/monthly.length:0,averagePerActiveWeek:weekly.length?totalOrders/weekly.length:0},monthly,weekly,timezone:"browser local time"};
  }
  function getAdminRollingBuckets(analytics,view){
    const now=new Date(),lookup=new Map(),source=view==="week"?(analytics.weekly||[]):(analytics.monthly||[]);
    source.forEach(item=>lookup.set(String(item.bucket||item.period||""),item));
    const buckets=[];
    if(view==="week"){
      const monday=new Date(now.getFullYear(),now.getMonth(),now.getDate());monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
      for(let i=11;i>=0;i--){const start=new Date(monday);start.setDate(start.getDate()-i*7);const key=formatAdminDateKey(start),item=lookup.get(key)||{};buckets.push({key,label:start.toLocaleDateString("en-IN",{day:"numeric",month:"short"}),subLabel:"W"+(12-i),orders:Number(item.orders||item.order_count||0),revenue:Number(item.revenue||0)});}
    }else{
      for(let i=11;i>=0;i--){const date=new Date(now.getFullYear(),now.getMonth()-i,1);const key=date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0"),item=lookup.get(key)||{};buckets.push({key,label:date.toLocaleDateString("en-IN",{month:"short"}),subLabel:String(date.getFullYear()),orders:Number(item.orders||item.order_count||0),revenue:Number(item.revenue||0)});}
    }
    return buckets;
  }
  function renderAdminAnalytics(){
    const analytics=state.adminAnalytics||buildDemoAdminAnalytics(state.adminOrders||[]),summary=analytics.summary||{},view=state.adminChartView||"month";
    const buckets=getAdminRollingBuckets(analytics,view),maxOrders=Math.max(1,...buckets.map(item=>item.orders)),current=buckets[buckets.length-1]||{orders:0,revenue:0};
    const peak=buckets.reduce((best,item)=>item.orders>best.orders?item:best,{orders:0});
    $("#adminMonthlyAverage").textContent=Number(summary.averagePerActiveMonth||0).toLocaleString("en-IN",{maximumFractionDigits:1});
    $("#adminCurrentPeriodLabel").textContent=view==="week"?"THIS WEEK":"THIS MONTH";
    $("#adminCurrentPeriodOrders").textContent=current.orders.toLocaleString("en-IN")+" "+(current.orders===1?"order":"orders");
    $("#adminCurrentPeriodRevenue").textContent=money(current.revenue)+" recorded revenue";
    $("#adminChartTitle").textContent=view==="week"?"Orders per week":"Orders per month";
    $("#adminChartRange").textContent=view==="week"?"Last 12 weeks":"Last 12 months";
    $("#adminTimezoneNote").textContent=analytics.timezone==="Asia/Kolkata"?"Dates shown in India time":"Dates shown in browser local time";
    $("#adminPeakPeriod").textContent=peak.orders?(view==="week"?"Week of ":"")+peak.label+(view==="month"?" "+peak.subLabel:""):"—";
    $("#adminPeakOrders").textContent=peak.orders?peak.orders.toLocaleString("en-IN")+" orders in this period":"No orders in the periods shown";
    $$(".admin-chart-switch [data-analytics-view]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.analyticsView===view)));
    $("#adminAnalyticsChart").innerHTML='<div class="admin-chart-columns">'+buckets.map(item=>{
      const height=item.orders?Math.max(5,Math.round(item.orders/maxOrders*100)):2;
      const title=item.orders+" orders · "+money(item.revenue)+" revenue";
      return '<div class="admin-chart-column" title="'+escapeHTML(title)+'"><strong>'+item.orders.toLocaleString("en-IN")+'</strong><div class="admin-chart-bar-track"><span style="height:'+height+'%"></span></div><small>'+escapeHTML(item.label)+'</small><em>'+escapeHTML(item.subLabel)+'</em></div>';
    }).join("")+'</div>';
  }
  function renderAdminDashboard(){
    const orders=state.adminOrders||[],analytics=state.adminAnalytics||buildDemoAdminAnalytics(orders),summary=analytics.summary||{};
    const totalOrders=Number(summary.totalOrders==null?orders.length:summary.totalOrders),revenue=Number(summary.grossSales==null?orders.reduce((sum,order)=>sum+Number(order.total||0),0):summary.grossSales);
    $("#adminOrderCount").textContent=totalOrders.toLocaleString("en-IN");$("#adminRevenue").textContent=money(revenue);
    $("#adminAverage").textContent=money(summary.averageOrder==null?(totalOrders?revenue/totalOrders:0):summary.averageOrder);
    $("#adminWeeklyAverage").textContent=Number(summary.averagePerActiveWeek||0).toLocaleString("en-IN",{maximumFractionDigits:1});
    $("#adminSourceLabel").textContent=state.adminSource==="live"?"LIVE DATABASE":"THIS DEVICE";
    renderAdminAnalytics();
    if(!orders.length){$("#adminOrdersBody").innerHTML='<tr><td colspan="5">No orders yet.</td></tr>';return;}
    $("#adminOrdersBody").innerHTML=orders.map(order=>{
      const number=order.order_number||order.orderNumber||"FH-UNKNOWN",name=order.customer_name||(order.customer&&order.customer.name)||"Demo customer",status=normalizeAdminStatus(order.status);
      const choices=["confirmed","preparing","out_for_delivery","delivered","cancelled"],itemCount=Array.isArray(order.items)?order.items.reduce((sum,item)=>sum+Number(item.quantity||1),0):0;
      const address=order.addressDetails||(order.customer&&order.customer.addressDetails)||{};
      const location=[...new Set([address.city,address.district,address.state].filter(Boolean))].join(", ");
      const postal=address.pincode||"";
      return '<tr data-admin-row="'+escapeHTML(number)+'"><td><strong>'+escapeHTML(number)+'</strong><small>'+itemCount+' items</small></td><td>'+escapeHTML(name)+'<small>'+escapeHTML([location,postal].filter(Boolean).join(" · ")||"Address on file")+'</small></td><td>'+money(order.total)+'</td><td><select data-admin-status aria-label="Status for '+escapeHTML(number)+'">'+choices.map(choice=>'<option value="'+choice+'"'+(choice===status?" selected":"")+'>'+choice.replace(/_/g," ")+'</option>').join("")+'</select></td><td><button type="button" class="button button-outline admin-update-button" data-admin-update="'+escapeHTML(number)+'">Save</button></td></tr>';
    }).join("");
  }
  async function connectAdmin(event){
    event.preventDefault();const key=$("#adminKey").value.trim();$("#adminError").textContent="";
    if(state.backendOnline){
      if(!key){$("#adminError").textContent="Enter the server admin key to continue.";return;}
      try{
        const headers={Authorization:"Bearer "+key};
        const [result,analytics]=await Promise.all([request("/api/admin/orders",{headers}),request("/api/admin/analytics",{headers})]);
        state.adminKey=key;state.adminSource="live";state.adminOrders=Array.isArray(result.orders)?result.orders:[];state.adminAnalytics=analytics;
        $("#adminConnection").textContent="Connected to the live FoodieHub database. Analytics include the full order history; the table below shows the latest 100 orders.";
        renderAdminDashboard();
      }catch(error){state.adminKey="";$("#adminError").textContent=error.message||"Admin connection failed.";}
      return;
    }
    state.adminKey="";state.adminSource="demo";
    state.adminOrders=state.orders.map(order=>({...order,customer_name:(order.customer&&order.customer.name)||"This browser",order_number:order.orderNumber,total:order.total}));
    state.adminAnalytics=buildDemoAdminAnalytics(state.adminOrders);
    $("#adminConnection").textContent="Demo mode · showing orders saved on this device only. Connect the hosted backend to view shared order history.";
    renderAdminDashboard();
  }
  async function updateAdminOrder(button){
    const row=button.closest("[data-admin-row]");if(!row)return;
    const number=row.dataset.adminRow,status=$("[data-admin-status]",row).value;button.disabled=true;
    try{
      if(state.adminSource==="live"){
        await request("/api/admin/orders/"+encodeURIComponent(number),{method:"PATCH",headers:{Authorization:"Bearer "+state.adminKey},body:JSON.stringify({status})});
        const found=state.adminOrders.find(order=>(order.order_number||order.orderNumber)===number);if(found)found.status=status;
        $("#adminConnection").textContent="Order "+number+" updated in the live database.";
      }else{
        const found=state.orders.find(order=>order.orderNumber===number);if(found)found.status=status;
        saveStore(STORAGE.orders,state.orders);state.adminOrders=state.orders.map(order=>({...order,customer_name:(order.customer&&order.customer.name)||"This browser",order_number:order.orderNumber,total:order.total}));
        state.adminAnalytics=buildDemoAdminAnalytics(state.adminOrders);
        $("#adminConnection").textContent="Demo status saved on this device. It is not a live delivery update.";
      }
      renderAdminDashboard();showToast("Order status updated.");
    }catch(error){$("#adminError").textContent=error.message||"The order status could not be updated.";}
    finally{button.disabled=false;}
  }

  function customerOrderStatus(status){
    const value=String(status||"confirmed").toLowerCase();
    const labels={demo_saved:"Placed · demo",confirmed:"Confirmed",preparing:"Preparing",out_for_delivery:"On the way",delivered:"Delivered",cancelled:"Cancelled",payment_pending:"Payment pending",failed:"Payment failed"};
    const kind=value==="delivered"?"is-delivered":value==="cancelled"?"is-cancelled":(["preparing","out_for_delivery"].includes(value)?"is-progress":"is-placed");
    return {label:labels[value]||value.replace(/_/g," "),kind};
  }
  function customerOrderDate(order){
    const date=new Date(order.createdAt||order.created_at||"");
    return Number.isNaN(date.getTime())?"Date not available":date.toLocaleString("en-IN",{day:"numeric",month:"short",year:"numeric",hour:"numeric",minute:"2-digit"});
  }
  function renderMyDashboard(){
    const phone=String(state.profile.phone||"").replace(/\D/g,"").slice(-10);
    const name=String(state.profile.name||"").trim();
    const accountOrders=Boolean(state.auth && state.auth.token && state.auth.user && state.backendOnline);
    $("#myDashboardGreeting").textContent=name?"Hello, "+name.split(/\s+/)[0]+".":"Hello, foodie.";
    const orders=accountOrders
      ? state.orders.slice().sort((a,b)=>new Date(b.createdAt||b.created_at||0).getTime()-new Date(a.createdAt||a.created_at||0).getTime())
      : (phone?state.orders.filter(order=>String(order.phone||(order.customer&&order.customer.phone)||"").replace(/\D/g,"").slice(-10)===phone).slice().sort((a,b)=>new Date(b.createdAt||b.created_at||0).getTime()-new Date(a.createdAt||a.created_at||0).getTime()):[]);
    const activeOrders=orders.filter(order=>!["cancelled","payment_pending","failed"].includes(String(order.status||"").toLowerCase()));
    const totalValue=activeOrders.reduce((sum,order)=>sum+Math.max(0,Number(order.total||0)),0);
    const delivered=orders.filter(order=>String(order.status||"").toLowerCase()==="delivered").length;
    $("#myOrderCount").textContent=orders.length.toLocaleString("en-IN");
    $("#myTotalValue").textContent=money(totalValue);
    $("#myDeliveredCount").textContent=delivered.toLocaleString("en-IN");
    $("#myAverageOrder").textContent=money(activeOrders.length?totalValue/activeOrders.length:0);
    $("#myDashboardOrderRange").textContent=orders.length+" "+(orders.length===1?"order":"orders");
    $("#myDashboardIntro").textContent=accountOrders
      ? "Your order history is synced to your FoodieHub account."
      : (phone?"Showing orders matched to the mobile number ending in "+phone.slice(-4)+".":"Save the mobile number you use at checkout in your Profile to see your order history.");
    const list=$("#myOrdersList");
    if(!phone){
      list.innerHTML='<div class="my-orders-empty"><span aria-hidden="true">◉</span><h4>One quick profile step.</h4><p>Add the same mobile number you use at checkout. We use it to match your orders on this browser.</p><button class="button button-primary" type="button" data-edit-my-profile>Update my profile ↗</button></div>';
    }else if(!orders.length){
      list.innerHTML='<div class="my-orders-empty"><span aria-hidden="true">⌁</span><h4>No orders found yet.</h4><p>We could not find orders for the mobile number saved in your profile on this browser.</p><button class="button button-outline" type="button" data-browse-menu>Explore the menu ↗</button></div>';
    }else{
      list.innerHTML=orders.slice(0,8).map(order=>{
        const number=String(order.orderNumber||order.order_number||"FH-ORDER"),status=customerOrderStatus(order.status),items=Array.isArray(order.items)?order.items:[];
        const quantity=items.reduce((sum,item)=>sum+Math.max(1,Number(item.quantity||1)),0);
        const names=items.map(item=>{const id=item.productId||item.product_id||item.id,product=state.menu.find(entry=>entry.id===id);return (product&&product.name)||item.name||item.productName||"Food item";});
        const preview=names.slice(0,2).join(" · ")||(quantity+" "+(quantity===1?"item":"items")),more=names.length>2?" +"+(names.length-2)+" more":"";
        return '<article class="my-order-card"><div class="my-order-top"><div><strong>'+escapeHTML(number)+'</strong><small>'+escapeHTML(customerOrderDate(order))+'</small></div><span class="my-order-status '+status.kind+'">'+escapeHTML(status.label)+'</span></div><div class="my-order-bottom"><div><strong>'+quantity+' '+(quantity===1?"item":"items")+'</strong><small>'+escapeHTML(preview+more)+'</small></div><strong class="my-order-value">'+money(order.total||0)+'</strong></div><div class="my-order-actions"><button type="button" data-track-my-order="'+escapeHTML(number)+'">Track this order <span aria-hidden="true">↗</span></button></div></article>';
      }).join("")+(orders.length>8?'<p class="my-orders-more">Showing the latest 8 of '+orders.length+' orders.</p>':"");
    }
    $("#myDashboardNote").textContent=accountOrders
      ? "Your account order history is stored by FoodieHub and available when you sign in on another device."
      : "Demo history is matched against your saved mobile number and stays in this browser only. It is not synced across devices or accounts.";
  }
  async function openMyDashboard(){
    if(state.backendOnline && state.auth && state.auth.user){
      try{
        const result=await request("/api/auth/orders");
        state.orders=Array.isArray(result.orders)?result.orders.map(order=>({...order,phone:state.auth.user.phone})):[];
      }catch(error){showToast(error.message||"Your order history could not be refreshed.","error");}
    }
    renderMyDashboard();
    openDialog("myDashboardDialog");
  }
  function handleMyDashboardAction(event){
    const edit=event.target.closest("[data-edit-my-profile]");
    if(edit){closeDialog("myDashboardDialog");openProfile();return;}
    const browse=event.target.closest("[data-browse-menu]");
    if(browse){closeDialog("myDashboardDialog");$("#menu").scrollIntoView({behavior:"smooth"});return;}
    const track=event.target.closest("[data-track-my-order]");
    if(track){const orderNumber=track.dataset.trackMyOrder;closeDialog("myDashboardDialog");openTracking();$("#trackingForm").elements.namedItem("orderNumber").value=orderNumber;$("#trackingForm").elements.namedItem("phone").value=String(state.profile.phone||"");}
  }


  let offerSlideIndex=0;
  let offerRotationTimer=null;
  function renderOfferSlide(index,announce=false){
    const slides=$$("#offerCarousel [data-offer-slide]");
    if(!slides.length)return;
    offerSlideIndex=(index+slides.length)%slides.length;
    slides.forEach((slide,i)=>{
      const active=i===offerSlideIndex;
      slide.classList.toggle("is-active",active);
      slide.setAttribute("aria-hidden",String(!active));
    });
    $$("[data-offer-dot]", $("#offerCarousel")).forEach(button=>{
      button.setAttribute("aria-pressed",String(Number(button.dataset.offerDot)===offerSlideIndex));
    });
    $("#offerSlideCount").innerHTML=String(offerSlideIndex+1).padStart(2,"0")+' <i>/</i> '+String(slides.length).padStart(2,"0");
    if(announce)$("#offerAnnouncement").textContent="Offer "+(offerSlideIndex+1)+" of "+slides.length+" is now shown.";
  }
  function pauseOfferRotation(){
    if(offerRotationTimer){window.clearInterval(offerRotationTimer);offerRotationTimer=null;}
  }
  let offerIsInView = true;
  function resumeOfferRotation(){
    pauseOfferRotation();
    const reduced=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile=window.matchMedia&&window.matchMedia('(max-width: 760px)').matches;
    if(reduced||mobile||document.hidden||!offerIsInView)return;
    offerRotationTimer=window.setInterval(()=>renderOfferSlide(offerSlideIndex+1),4800);
  }
  function applyOfferCode(code){
    const offers={
      HUB50:{code:"HUB50",percent:50,maximum:200,minimum:699},
      FOOD25:{code:"FOOD25",percent:25,maximum:100,minimum:299},
      COMBO10:{code:"COMBO10",percent:10,maximum:150,minimum:199}
    };
    const offer=offers[code];
    if(!offer)return;
    state.coupon=offer;
    state.pendingRewardRedemption=false;
    $("#couponInput").value=code;
    const subtotal=calculateBill().subtotal;
    $("#couponMessage").textContent=subtotal>=offer.minimum
      ?code+" applied. Your order discount is active."
      :" "+code+" saved. Add "+money(offer.minimum-subtotal)+" more to unlock this offer.";
    $("#couponMessage").className=subtotal>=offer.minimum?"coupon-message message-success":"coupon-message message-warning";
    renderCart();
    $("#menu").scrollIntoView({behavior:"smooth",block:"start"});
    showToast(code+" saved to your bag. Add eligible dishes to unlock the discount.");
  }
  function initOfferCarousel(){
    const carousel=$("#offerCarousel");
    if(!carousel)return;
    renderOfferSlide(0);
    $("#offerPrevious").addEventListener("click",()=>{renderOfferSlide(offerSlideIndex-1,true);resumeOfferRotation();});
    $("#offerNext").addEventListener("click",()=>{renderOfferSlide(offerSlideIndex+1,true);resumeOfferRotation();});
    $$("[data-offer-dot]", $("#offerCarousel")).forEach(button=>button.addEventListener("click",()=>{
      renderOfferSlide(Number(button.dataset.offerDot),true);resumeOfferRotation();
    }));
    $$("[data-use-offer]", $("#offerCarousel")).forEach(button=>button.addEventListener("click",()=>{
      applyOfferCode(button.dataset.useOffer);
    }));
    $$("[data-shop-offer]", $("#offerCarousel")).forEach(button=>button.addEventListener("click",()=>{
      $("#menu").scrollIntoView({behavior:"smooth",block:"start"});
      showToast("Free delivery is automatically applied on orders of ₹499 or more.");
    }));
    carousel.addEventListener("mouseenter",pauseOfferRotation);
    carousel.addEventListener("mouseleave",resumeOfferRotation);
    carousel.addEventListener("focusin",pauseOfferRotation);
    carousel.addEventListener("focusout",()=>window.setTimeout(()=>{
      if(!carousel.contains(document.activeElement))resumeOfferRotation();
    },120));
    document.addEventListener("visibilitychange",()=>document.hidden?pauseOfferRotation():resumeOfferRotation());
    if ("IntersectionObserver" in window) {
      const visibilityObserver = new IntersectionObserver(entries => {
        offerIsInView = entries.some(entry => entry.isIntersecting);
        if (offerIsInView) resumeOfferRotation();
        else pauseOfferRotation();
      }, { threshold: 0.12 });
      visibilityObserver.observe(carousel);
    } else {
      resumeOfferRotation();
    }
  }
  function openTeamDashboard(){
    $("#adminError").textContent="";
    if(state.backendOnline){
      $("#adminLoginForm").hidden=false;
      if(state.adminAnalytics)renderAdminDashboard();
      $("#adminConnection").textContent=state.adminKey
        ?"Your live dashboard is ready. Reconnect to refresh the latest data."
        :"Enter the server admin key to load live order analytics.";
    }else{
      $("#adminLoginForm").hidden=true;
      state.adminKey="";
      state.adminSource="demo";
      state.adminOrders=state.orders.map(order=>({...order,customer_name:(order.customer&&order.customer.name)||"This browser",order_number:order.orderNumber,total:order.total}));
      state.adminAnalytics=buildDemoAdminAnalytics(state.adminOrders);
      $("#adminConnection").textContent="LOCAL DEMO · Showing orders saved on this device only. Connect the hosted backend to view shared orders.";
      renderAdminDashboard();
    }
    openDialog("adminDialog");
  }

  function bindFeatureEvents(){
    ["mealMain","mealSide","mealDrink"].forEach(id=>$("#"+id).addEventListener("change",updateMealSummary));
    $("#mealVegOnly").addEventListener("change",populateMealBuilder);$("#addMealBundle").addEventListener("click",addMealBundle);
    $("#comboGrid").addEventListener("click",event=>{
      const addButton=event.target.closest("[data-combo]");
      if(addButton){addSmartCombo(addButton.dataset.combo);return;}
      const dishButton=event.target.closest("[data-open-dish]");
      const card=event.target.closest(".combo-card[data-primary-dish]");
      const dishId=dishButton?.dataset.openDish||(card?.dataset.primaryDish);
      if(dishId)openDishDetails(dishId);
    });
    $("#recommendationMood").addEventListener("change",renderRecommendations);
    $("#recommendationGrid").addEventListener("click",event=>{
      const addButton=event.target.closest("[data-recommend-add]");
      if(addButton){addToCart(addButton.dataset.recommendAdd,addButton);return;}
      const trigger=event.target.closest("[data-open-dish]");
      const card=event.target.closest(".recommendation-card[data-primary-dish]");
      const dishId=trigger?.dataset.openDish||(card?.dataset.primaryDish);
      if(dishId)openDishDetails(dishId);
    });
    $("#redeemRewards").addEventListener("click",redeemRewards);
    $("#openAdmin").addEventListener("click",openTeamDashboard);
    $("#adminLoginForm").addEventListener("submit",connectAdmin);
    $$(".admin-chart-switch [data-analytics-view]").forEach(button=>button.addEventListener("click",()=>{state.adminChartView=button.dataset.analyticsView;renderAdminAnalytics();}));
    $("#adminOrdersBody").addEventListener("click",event=>{const button=event.target.closest("[data-admin-update]");if(button)updateAdminOrder(button);});
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    saveStore(STORAGE.theme, theme);
    $("#themeToggle").setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    $("#themeToggle").setAttribute("title", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    $("#themeToggle span").textContent = theme === "dark" ? "☀" : "☾";
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute("content", theme === "dark" ? "#171717" : "#ffffff");
  }

  function bindEvents() {
    $("#openCart").addEventListener("click", openCart);
    const mobileOpenCart = $("#mobileOpenCart");
    if (mobileOpenCart) mobileOpenCart.addEventListener("click", openCart);
    const mobileTrackOrder = $("#mobileTrackOrder");
    if (mobileTrackOrder) mobileTrackOrder.addEventListener("click", () => openTracking());
    $("#openProfile").addEventListener("click", openProfile);
    $("#appLocationTrigger").addEventListener("click", () => openProfile({ addressOnly: true }));
    $("#appVegToggle").addEventListener("click", () => {
      setDietFilter(state.diet === "veg" ? "all" : "veg");
    });
    $("#profileForm").addEventListener("submit", saveProfile);
    $("#customerLoginForm").addEventListener("submit", handleCustomerLogin);
    $("#customerRegisterForm").addEventListener("submit", handleCustomerRegister);
    $("#authSignInTab").addEventListener("click",()=>showAccountAuthMode("login"));
    $("#authRegisterTab").addEventListener("click",()=>showAccountAuthMode("register"));
    $("#savedAddressesList").addEventListener("click",handleSavedAddressClick);
    $("#accountLogoutButton").addEventListener("click",handleCustomerLogout);
    ["checkoutForm","profileForm"].forEach(formId=>{
      const form=$("#"+formId);
      const previewId=formId==="checkoutForm"?"checkoutAddressPreview":"profileAddressPreview";
      form.addEventListener("input",()=>updateAddressPreview(formId,previewId));
      form.addEventListener("change",()=>updateAddressPreview(formId,previewId));
    });
    $("#closeCart").addEventListener("click", closeCart);
    $("#cartBackdrop").addEventListener("click", closeCart);
    $("#cartDrawer").addEventListener("click", event => {
      const checkoutButton = event.target.closest("#checkoutButton");
      if (!checkoutButton) return;
      event.preventDefault();
      if (checkoutButton.disabled) {
        showToast("Add at least one dish to your bag before checkout.", "error");
        return;
      }
      openCheckout();
    });
    $("#applyCoupon").addEventListener("click", applyCoupon);
    $("#couponInput").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); applyCoupon(); } });
    $("#checkoutForm").addEventListener("submit", placeOrder);
    $("#checkoutDialog").addEventListener("close", () => {
      state.checkoutIdempotencyKey = "";
    });
    $("#checkoutForm").addEventListener("change", event => {
      if (event.target && event.target.name === "paymentMethod") {
        $("#checkoutError").textContent = "";
        updatePaymentButtonLabel(event.target.value);
      }
    });
    $("#trackingForm").addEventListener("submit", trackOrder);
    $("#trackingRecentSelect").addEventListener("change", event => {
      const selected = String(event.currentTarget.value || "").trim().toUpperCase();
      if (!selected) return;
      const order = state.orders.find(item => normalizeOrderNumber(item) === selected);
      $("#trackingForm").elements.namedItem("orderNumber").value = selected;
      $("#trackingForm").elements.namedItem("phone").value =
        normalizeOrderPhone(order) || normalizeOrderPhone({ phone: state.profile.phone || (state.auth.user && state.auth.user.phone) });
      $("#trackingError").textContent = "";
      $("#trackingResult").hidden = true;
    });
    $("#trackOrderHome").addEventListener("click", openTracking);
    $("#customisePlateShortcut").addEventListener("click",()=>{
      $("#menu").scrollIntoView({behavior:"smooth",block:"start"});
      window.setTimeout(()=>{
        const firstCustomize=$("#menuGrid [data-customize]")[0];
        if(firstCustomize)firstCustomize.focus({preventScroll:true});
      },450);
      showToast("Select a dish, then choose View details & customise to set your portion and add-ons.");
    });
    $("#openMyDashboard").addEventListener("click", openMyDashboard);
    $("#myDashboardEditProfile").addEventListener("click",()=>{closeDialog("myDashboardDialog");openProfile();});
    $("#myOrdersList").addEventListener("click",handleMyDashboardAction);
    bindFeatureEvents();
    $("#successDone").addEventListener("click", () => closeDialog("successDialog"));
    $("#newsletterForm").addEventListener("submit", subscribe);
    $("#themeToggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
    $("#dishCustomizerForm").addEventListener("submit", addCustomizedDish);
    $("#dishCustomizerForm").addEventListener("change", updateCustomizerTotal);
    $("#customizerQtyMinus").addEventListener("click", () => { state.customizerQuantity = Math.max(1, state.customizerQuantity - 1); updateCustomizerTotal(); });
    $("#customizerQtyPlus").addEventListener("click", () => { state.customizerQuantity = Math.min(20, state.customizerQuantity + 1); updateCustomizerTotal(); });
    $("#favouritesToggle").addEventListener("click", () => {
      state.onlyFavourites = !state.onlyFavourites;
      $("#favouritesToggle").classList.toggle("is-active", state.onlyFavourites);
      $("#favouritesToggle").setAttribute("aria-label", state.onlyFavourites ? "Show all dishes" : "Show favourites");
      state.category = "All";
      setDietFilter("all", false);
      renderCategories();
      renderMenu();
      document.getElementById("menu").scrollIntoView({ behavior: "smooth" });
    });
    $("#menuGrid").addEventListener("click", event => {
      const card = event.target.closest(".dish-card[data-dish-id]");
      if (!card) return;
      const id = card.dataset.dishId;
      const addButton = event.target.closest("[data-add]");
      if (addButton) {
        addToCart(id, addButton);
        return;
      }
      if (event.target.closest("[data-favourite]")) {
        toggleFavourite(id);
        return;
      }
      if (event.target.closest("[data-image], [data-name], [data-customize]")) {
        openDishDetails(id);
      }
    });
    $("#menuSearch").addEventListener("input", event => {
      state.query = event.target.value;
      scheduleMenuRender();
    });
    $("#sortMenu").addEventListener("change", event => {
      const nextSort = event.target.value;
      state.sort = ["recommended", "price-low", "price-high", "discount", "name"].includes(nextSort) ? nextSort : "recommended";
      saveStore(STORAGE.sort, state.sort);
      renderMenu();
    });
    $$(".diet-button").forEach(button => button.addEventListener("click", () => {
      setDietFilter(button.dataset.diet);
    }));
    $("#clearFilters").addEventListener("click", () => {
      state.category = "All";
      setDietFilter("all", false);
      state.query = "";
      state.onlyFavourites = false;
      $("#menuSearch").value = "";
      $("#favouritesToggle").classList.remove("is-active");
      $$(".diet-button").forEach(button => button.classList.toggle("active", button.dataset.diet === "all"));
      renderCategories();
      renderMenu();
    });
    $$("[data-close-dialog]").forEach(button => button.addEventListener("click", () => closeDialog(button.dataset.closeDialog)));
    $$(".site-dialog").forEach(dialog => dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    }));
    document.addEventListener("keydown", event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        $("#menuSearch").focus();
      }
      if (event.key === "Escape") closeCart();
    });
  }

  async function init() {
    const savedTheme = readStore(STORAGE.theme, null);
    const systemTheme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(savedTheme || systemTheme);
    $("#currentYear").textContent = new Date().getFullYear();
    bindEvents();
    initOfferCarousel();
    renderProfile();
    renderCart();
    const heroImage=$(".hero-image-frame img");
    if(heroImage)protectFoodPhoto(heroImage,{name:"FoodieHub chef's table",category:"Featured"});
    const storyImage=$(".story-image img");
    if(storyImage)protectFoodPhoto(storyImage,{name:"Fresh from the kitchen",category:"Indian"});
    try {
      await checkBackend();
      await restoreCustomerSession();
      renderAccountUI();
      state.menu = await loadMenu();
      renderCart();
      renderCategories();
      renderMenu();
      populateMealBuilder();
      renderSmartCombos();
      renderRecommendations();
      renderRewards();
      if (state.backendOnline) {
        showToast("FoodieHub API connected. Orders can be saved.");
      }
    } catch (error) {
      $("#menuStatus").textContent = error.message;
      showToast(error.message, "error");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();