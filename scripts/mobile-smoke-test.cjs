"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");

const BASE_URL = process.env.FOODIEHUB_QA_URL || "https://shagun299.github.io/fodie/?qa=mobile";
const OUT_DIR = path.join(process.cwd(), "mobile-qa-artifacts");
fs.mkdirSync(OUT_DIR, { recursive: true });

const failures = [];
const reports = [];
const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 }
];

function sizeName(viewport) {
  return String(viewport.width) + "x" + String(viewport.height);
}

function check(condition, viewport, name, detail) {
  const result = { viewport: sizeName(viewport), name, pass: Boolean(condition) };
  if (detail) result.detail = detail;
  reports.push(result);
  if (!condition) failures.push(result);
}

async function waitForSite(page) {
  const response = await page.goto(BASE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  if (response && response.status() >= 400) {
    throw new Error("Site returned HTTP " + response.status());
  }
  try {
    await page.waitForFunction(() => {
      const count = document.querySelectorAll("#menuGrid .dish-card").length;
      const status = document.querySelector("#menuStatus")?.textContent?.trim() || "";
      return count > 0 || (status && status !== "Loading menu...");
    }, { timeout: 30000 });
  } catch (_) {}
  const state = await page.evaluate(() => ({
    cards: document.querySelectorAll("#menuGrid .dish-card").length,
    status: document.querySelector("#menuStatus")?.textContent?.trim() || "",
    script: document.querySelector('script[src*="assets/js/app.js"]')?.src || "",
    categories: document.querySelectorAll("#categoryTabs .category-tab").length,
    readyState: document.readyState
  }));
  if (!state.cards) throw new Error("Menu initialization did not render cards: " + JSON.stringify(state));
}

async function runViewport(browser, viewport) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "no-preference"
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate:3 });
  const pageErrors = [];
  const httpErrors = [];
  const firstPartyFailures = [];

  await page.addInitScript(() => {
    window.__foodieLongTasks = [];
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          window.__foodieLongTasks.push({
            durationMs:Math.round(entry.duration),
            startTimeMs:Math.round(entry.startTime)
          });
        }
      }).observe({ type: "longtask", buffered: true });
    } catch (_) {}
  });

  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => {
    if (response.status() >= 400) {
      httpErrors.push({ url:response.url(), status:response.status() });
    }
  });
  page.on("requestfailed", request => {
    const url = request.url();
    if (url.includes("shagun299.github.io") || url.includes("images.unsplash.com") || url.includes("images.pexels.com")) {
      firstPartyFailures.push({ url, error: request.failure()?.errorText || "request failed" });
    }
  });

  try {
    await waitForSite(page);

    const introButton = page.locator("#skipWelcome");
    if (await introButton.isVisible().catch(() => false)) {
      await introButton.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(450);
    }

    if (viewport.width === 390) {
      await page.screenshot({ path: path.join(OUT_DIR, "mobile-390-home.png") });
    }
    const initialPerformance = await page.evaluate(() => {
      const nav = window.performance.getEntriesByType("navigation")[0];
      const images = window.performance.getEntriesByType("resource").filter(item =>
        item.initiatorType === "img" || item.name.includes("images.unsplash.com") || item.name.includes("images.pexels.com"));
      return {
        domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : null,
        imageRequestsBeforeScrolling: images.length,
        encodedImageBytesBeforeScrolling: images.reduce((sum, item) => sum + (item.encodedBodySize || 0), 0),
        domNodeCount: document.getElementsByTagName("*").length
      };
    });
    reports.push({ viewport:sizeName(viewport), name:"initial-load-observation", pass:true, detail:initialPerformance });
    const menuCount = await page.locator("#menuGrid .dish-card").count();
    check(menuCount >= 20, viewport, "menu-rendered", "Found " + menuCount + " menu cards");

    const categoryLabels = await page.locator("#categoryTabs .category-label").evaluateAll(nodes =>
      nodes.map(node => ({
        text:node.textContent.trim(),
        visible:getComputedStyle(node).display !== "none" && node.getBoundingClientRect().height > 0
      }))
    );
    check(categoryLabels.length >= 3 && categoryLabels.every(item => item.text && item.visible),
      viewport, "category-icons-have-visible-names", JSON.stringify(categoryLabels));

    const menuIdentity = await page.locator("#menuGrid .dish-card").first().evaluate(card => {
      window.__qaInitialMenuCard = card;
      return card.dataset.dishId;
    });
    const vegToggle = page.locator("#appVegToggle");
    if (await vegToggle.getAttribute("aria-pressed") === "true") {
      await vegToggle.click();
      await page.waitForFunction(() => document.querySelector("#appVegToggle")?.getAttribute("aria-pressed") === "false");
    }
    await vegToggle.click();
    await page.waitForFunction(() => document.querySelector("#appVegToggle")?.getAttribute("aria-pressed") === "true");
    const vegResults = await page.locator("#menuGrid .dish-card").evaluateAll(cards => ({
      count:cards.length,
      onlyVegetarian:cards.every(card => card.querySelector("[data-diet-indicator]")?.classList.contains("diet-veg"))
    }));
    check(vegResults.count > 0 && vegResults.onlyVegetarian, viewport, "veg-mode-filters-menu",
      JSON.stringify(vegResults));
    await vegToggle.click();
    await page.waitForFunction(() => document.querySelector("#appVegToggle")?.getAttribute("aria-pressed") === "false");
    const reusedMenuNode = await page.evaluate(id => {
      const card = document.querySelector('#menuGrid [data-dish-id="' + CSS.escape(id) + '"]');
      return Boolean(card && card === window.__qaInitialMenuCard);
    }, menuIdentity);
    check(reusedMenuNode, viewport, "menu-filters-reuse-existing-card-nodes", menuIdentity);
    const interactionMotion = await page.evaluate(() => ({
      buttonTransition:getComputedStyle(document.querySelector("#appVegToggle")).transitionDuration,
      categoryTransition:getComputedStyle(document.querySelector("#categoryTabs .category-tab")).transitionDuration,
      offscreenRendering:getComputedStyle(document.querySelector("#menuGrid .dish-card")).contentVisibility
    }));
    check(interactionMotion.buttonTransition.split(",").some(value => parseFloat(value) > 0) &&
      interactionMotion.categoryTransition.split(",").some(value => parseFloat(value) > 0) &&
      interactionMotion.offscreenRendering === "auto",
      viewport, "lightweight-mobile-interactions-enabled", JSON.stringify(interactionMotion));

    const sortMenu = page.locator("#sortMenu");
    await sortMenu.selectOption("price-low");
    const ascendingPrices = await page.locator("#menuGrid [data-price]").evaluateAll(nodes =>
      nodes.map(node => Number(node.textContent.replace(/[^\d.]/g, ""))).filter(Number.isFinite)
    );
    check(ascendingPrices.length >= 2 && ascendingPrices.every((value,index) => index === 0 || ascendingPrices[index-1] <= value),
      viewport, "sort-low-to-high-orders-prices", JSON.stringify(ascendingPrices));
    await sortMenu.selectOption("price-high");
    const descendingPrices = await page.locator("#menuGrid [data-price]").evaluateAll(nodes =>
      nodes.map(node => Number(node.textContent.replace(/[^\d.]/g, ""))).filter(Number.isFinite)
    );
    check(descendingPrices.length >= 2 && descendingPrices.every((value,index) => index === 0 || descendingPrices[index-1] >= value),
      viewport, "sort-high-to-low-orders-prices", JSON.stringify(descendingPrices));
    await sortMenu.selectOption("recommended");

    const pageGeometry = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      dockVisible: getComputedStyle(document.querySelector("#mobileDock")).display !== "none",
      scrollShell: (() => {
        const content = document.querySelector("#mobilePageScroll");
        const dock = document.querySelector("#mobileDock");
        const dockRect = dock?.getBoundingClientRect();
        const bodyPadding = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
        const dockPosition = dock ? getComputedStyle(dock).position : "missing";
        const pageScroller = document.scrollingElement;
        const scrollRange = pageScroller ? pageScroller.scrollHeight - pageScroller.clientHeight : 0;
        const dockHeight = dockRect ? dockRect.height : 0;
        return {
          contentBottom:content ? Math.round(content.getBoundingClientRect().bottom) : null,
          dockTop:dockRect ? Math.round(dockRect.top) : null,
          contentHeight:pageScroller ? pageScroller.scrollHeight : 0,
          bodyPadding,
          dockHeight,
          dockPosition,
          scrollRange:Math.round(scrollRange),
          separated:Boolean(content && dock && dockPosition === "fixed" &&
            bodyPadding >= dockHeight + 24 && scrollRange > 200 &&
            getComputedStyle(content).overflowY === "visible")
        };
      })(),
      visibleBrandLogos: Array.from(document.querySelectorAll(".brand img"))
        .filter(img => getComputedStyle(img).display !== "none").length,
      headerCartBadgeContained: (() => {
        const cart = document.querySelector("#openCart")?.getBoundingClientRect();
        const badge = document.querySelector("#cartCount")?.getBoundingClientRect();
        return Boolean(cart && badge && badge.width > 0 && badge.left >= cart.left - 1 &&
          badge.right <= cart.right + 1 && badge.top >= cart.top - 1 && badge.bottom <= cart.bottom + 1);
      })(),
      contentAlignment: (() => {
        const selectors = ["#quickAccess", "#offers", "#menu", "#meal-studio", "#smart-combos"];
        const boxes = selectors.map(selector => {
          const element = document.querySelector(selector);
          const rect = element?.getBoundingClientRect();
          return { selector, left:rect ? Math.round(rect.left) : null, right:rect ? Math.round(rect.right) : null,
            width:rect ? Math.round(rect.width) : 0 };
        }).filter(item => item.width > 0);
        const lefts = boxes.map(item => item.left);
        const rights = boxes.map(item => item.right);
        return { boxes, aligned:lefts.length >= 4 &&
          Math.max(...lefts)-Math.min(...lefts) <= 2 &&
          Math.max(...rights)-Math.min(...rights) <= 2 };
      })(),
      dishCardAlignment: (() => {
        const card = document.querySelector("#menuGrid .dish-card");
        if (!card) return { valid:false };
        const cardRect = card.getBoundingClientRect();
        const imageRect = card.querySelector(".dish-image-wrap")?.getBoundingClientRect();
        const contentRect = card.querySelector(".dish-content")?.getBoundingClientRect();
        return { valid:Boolean(imageRect && contentRect) &&
          imageRect.left >= cardRect.left-1 && imageRect.right <= contentRect.left+2 &&
          contentRect.right <= cardRect.right+1 && contentRect.left < contentRect.right };
      })(),
      menuImage: document.querySelector("#menuGrid .dish-image")?.getAttribute("src") || "",
      appLocation: (() => {
        const element = document.querySelector("#appLocationTrigger");
        const rect = element?.getBoundingClientRect();
        return { visible:Boolean(element && rect && rect.width > 0 && rect.height > 0),
          width:rect ? rect.width : 0,height:rect ? rect.height : 0 };
      })(),
      appSearch: (() => {
        const element = document.querySelector(".app-search-box");
        const rect = element?.getBoundingClientRect();
        return { visible:Boolean(element && rect && rect.width > 0 && rect.height > 0),
          width:rect ? rect.width : 0,height:rect ? rect.height : 0 };
      })(),
      appVegToggleVisible: (() => {
        const element = document.querySelector("#appVegToggle");
        const rect = element?.getBoundingClientRect();
        return Boolean(element && rect && rect.width > 0 && rect.height > 0);
      })(),
      categoryCount: document.querySelectorAll("#categoryTabs .category-tab").length,
      appHomeTitle: document.querySelector("#menuTitle")?.innerText.replace(/\\s+/g," ").trim() || "",
      heroButton: (() => {
        const button = document.querySelector(".hero-actions .button");
        if (!button) return null;
        const r = button.getBoundingClientRect();
        return { width:r.width, height:r.height, direction:getComputedStyle(button.parentElement).flexDirection };
      })(),
      dockItems: Array.from(document.querySelectorAll("#mobileDock .mobile-dock-item")).map(element => {
        const r = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { width:r.width, height:r.height, display:style.display, direction:style.flexDirection,
          text:element.innerText.trim().replace(/\s+/g," ") };
      }),
      typography: (() => {
        const body = getComputedStyle(document.body);
        const hero = document.querySelector("#heroTitle");
        const heroDescription = document.querySelector(".hero-description");
        const dishDescription = document.querySelector("#menuGrid .dish-description");
        return {
          bodyFont:body.fontFamily,
          bodySize:parseFloat(body.fontSize),
          heroFont:hero ? getComputedStyle(hero).fontFamily : "",
          menuHeadingFont:document.querySelector("#menuTitle") ? getComputedStyle(document.querySelector("#menuTitle")).fontFamily : "",
          offerHeadingFont:document.querySelector(".offer-slide.is-active .offer-copy h2") ? getComputedStyle(document.querySelector(".offer-slide.is-active .offer-copy h2")).fontFamily : "",
          heroSize:hero ? parseFloat(getComputedStyle(hero).fontSize) : 0,
          heroDescriptionSize:heroDescription ? parseFloat(getComputedStyle(heroDescription).fontSize) : 0,
          dishDescriptionSize:dishDescription ? parseFloat(getComputedStyle(dishDescription).fontSize) : 0,
          heroText:hero ? hero.innerText.replace(/\s+/g," ").trim() : ""
        };
      })()
    }));
    check(pageGeometry.documentWidth <= pageGeometry.viewportWidth + 1, viewport, "no-horizontal-page-overflow",
      "viewport=" + pageGeometry.viewportWidth + ", document=" + pageGeometry.documentWidth + ", body=" + pageGeometry.bodyWidth);
    check(pageGeometry.contentAlignment.aligned, viewport, "main-sections-share-one-content-grid",
      JSON.stringify(pageGeometry.contentAlignment.boxes));
    check(pageGeometry.dishCardAlignment.valid, viewport, "dish-card-image-and-content-align-without-overlap",
      JSON.stringify(pageGeometry.dishCardAlignment));
    check(pageGeometry.dockVisible, viewport, "mobile-dock-visible");
    check(pageGeometry.scrollShell.separated && pageGeometry.scrollShell.contentHeight > 200,
      viewport, "mobile-dock-does-not-cover-page-content", JSON.stringify(pageGeometry.scrollShell));
    check(pageGeometry.visibleBrandLogos === 1, viewport, "exactly-one-theme-logo-visible",
      String(pageGeometry.visibleBrandLogos));
    check(pageGeometry.headerCartBadgeContained, viewport, "header-cart-count-stays-inside-button");

    await page.locator("#themeToggle").click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    const darkThemeGeometry = await page.evaluate(() => ({
      theme:document.documentElement.dataset.theme,
      lightLogoDisplay:getComputedStyle(document.querySelector(".brand-logo-light")).display,
      darkLogoDisplay:getComputedStyle(document.querySelector(".brand-logo-dark")).display,
      dockVisible:getComputedStyle(document.querySelector("#mobileDock")).display !== "none"
    }));
    check(darkThemeGeometry.theme === "dark" && darkThemeGeometry.lightLogoDisplay === "none" &&
      darkThemeGeometry.darkLogoDisplay !== "none" && darkThemeGeometry.dockVisible,
      viewport, "dark-theme-shows-readable-logo-and-mobile-dock", JSON.stringify(darkThemeGeometry));
    if (viewport.width === 390) {
      await page.screenshot({ path:path.join(OUT_DIR,"mobile-390-dark-home.png") });
    }
    await page.locator("#themeToggle").click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    check(pageGeometry.typography.bodyFont.includes("Manrope"), viewport, "brand-font-loaded",
      pageGeometry.typography.bodyFont);
    check(pageGeometry.typography.heroFont.includes("Manrope") &&
      pageGeometry.typography.menuHeadingFont.includes("Manrope") &&
      pageGeometry.typography.offerHeadingFont.includes("Manrope"),
      viewport, "all-display-headings-use-manrope",
      JSON.stringify({hero:pageGeometry.typography.heroFont,menu:pageGeometry.typography.menuHeadingFont,offer:pageGeometry.typography.offerHeadingFont}));
    check(pageGeometry.typography.bodySize >= 14 && pageGeometry.typography.dishDescriptionSize >= 11,
      viewport, "app-text-sizes-readable", JSON.stringify(pageGeometry.typography));
    check(pageGeometry.appLocation.visible && pageGeometry.appLocation.height >= 30,
      viewport, "app-location-control-visible", JSON.stringify(pageGeometry.appLocation));
    check(pageGeometry.appSearch.visible && pageGeometry.appSearch.width >= 260 && pageGeometry.appSearch.height >= 40,
      viewport, "app-search-is-prominent", JSON.stringify(pageGeometry.appSearch));
    check(pageGeometry.appVegToggleVisible, viewport, "app-veg-mode-control-visible");
    check(pageGeometry.categoryCount >= 3, viewport, "food-category-icons-render",
      "Rendered " + pageGeometry.categoryCount + " categories");
    check(pageGeometry.appHomeTitle === "What are you craving?", viewport, "app-home-title-visible",
      pageGeometry.appHomeTitle);
    check(pageGeometry.dockItems.length === 4 &&
      pageGeometry.dockItems.every(item => item.display === "flex" && item.direction === "column" && item.width >= 60 && item.height >= 46),
      viewport, "mobile-dock-buttons-are-stacked-and-tappable", JSON.stringify(pageGeometry.dockItems));
    check(/(?:\?|&)w=480(?:&|$)/.test(pageGeometry.menuImage), viewport, "mobile-menu-image-sized",
      pageGeometry.menuImage);

    await page.locator("#offers").scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const offer = await page.evaluate(() => {
      const panel = document.querySelector("#offerCarousel .offer-slide.is-active");
      if (!panel) return null;
      const copy = panel.querySelector(".offer-copy")?.getBoundingClientRect();
      const art = panel.querySelector(".offer-art")?.getBoundingClientRect();
      if (!copy || !art) return null;
      const overlap = copy.left < art.right && copy.right > art.left &&
        copy.top < art.bottom && copy.bottom > art.top;
      return { overlap, copyBottom:copy.bottom, artTop:art.top, panelWidth:panel.getBoundingClientRect().width };
    });
    check(Boolean(offer) && !offer.overlap, viewport, "offer-copy-and-discount-do-not-overlap",
      offer ? JSON.stringify(offer) : "Offer elements not found");

    await page.locator("#menu").scrollIntoViewIfNeeded();
    await page.locator("#menuSearch").fill("burger");
    await page.waitForTimeout(300);
    const searchCount = await page.locator("#menuGrid .dish-card").count();
    check(searchCount >= 1 && searchCount < menuCount, viewport, "menu-search-works", "Burger results: " + searchCount);
    await page.locator("#menuSearch").fill("");
    await page.waitForTimeout(250);

    const firstCard = page.locator("#menuGrid .dish-card").first();
    const cardBadgeGeometry = await firstCard.evaluate(card => {
      const image = card.querySelector(".dish-image-wrap")?.getBoundingClientRect();
      const badge = card.querySelector(".discount-badge")?.getBoundingClientRect();
      const heart = card.querySelector(".dish-favourite")?.getBoundingClientRect();
      const contained = Boolean(image && badge && badge.left >= image.left - 1 && badge.right <= image.right + 1 &&
        badge.top >= image.top - 1 && badge.bottom <= image.bottom + 1);
      const overlapsHeart = Boolean(badge && heart && badge.left < heart.right && badge.right > heart.left &&
        badge.top < heart.bottom && badge.bottom > heart.top);
      return { contained, overlapsHeart, badgeWidth:badge?.width || 0, imageWidth:image?.width || 0 };
    });
    check(cardBadgeGeometry.contained, viewport, "discount-badge-contained-in-photo", JSON.stringify(cardBadgeGeometry));
    check(!cardBadgeGeometry.overlapsHeart, viewport, "discount-badge-does-not-hit-favourite", JSON.stringify(cardBadgeGeometry));
    if (viewport.width === 390) {
      await firstCard.screenshot({ path:path.join(OUT_DIR,"mobile-390-menu-card.png") });
    }

    await page.locator("#menuGrid [data-add]").first().click();
    await page.locator("#mobileOpenCart").click();
    await page.waitForFunction(() => document.querySelector("#cartDrawer")?.classList.contains("is-open"));
    const bag = await page.evaluate(() => {
      const selectors = ["#cartDrawer", "#cartDrawer .coupon-entry", "#cartDrawer .coupon-row",
        "#cartDrawer .bill-lines", "#cartDrawer .checkout-button", "#cartDrawer .drawer-bottom"];
      const values = {};
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (!element) { values[selector] = null; continue; }
        const r = element.getBoundingClientRect();
        values[selector] = { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height };
      }
      const drawerBackground = getComputedStyle(document.querySelector("#cartDrawer")).backgroundColor;
      const drawerOpaque = drawerBackground.startsWith("rgb(") ||
        Number(drawerBackground.split(",").pop().replace(")","").trim()) >= 0.99;
      const toastDisplay = getComputedStyle(document.querySelector("#toastRegion")).display;
      return {
        values,
        drawerBackground,
        drawerOpaque,
        toastHidden: toastDisplay === "none",
        drawerWidth: values["#cartDrawer"]?.width || 0,
        couponWithin: Boolean(values["#cartDrawer .coupon-row"]) &&
          values["#cartDrawer .coupon-row"].x >= -1 &&
          values["#cartDrawer .coupon-row"].right <= window.innerWidth + 1,
        billAfterCoupon: Boolean(values["#cartDrawer .bill-lines"] && values["#cartDrawer .coupon-entry"]) &&
          values["#cartDrawer .bill-lines"].y >= values["#cartDrawer .coupon-entry"].bottom - 1,
        checkoutAfterBill: Boolean(values["#cartDrawer .checkout-button"] && values["#cartDrawer .bill-lines"]) &&
          values["#cartDrawer .checkout-button"].y >= values["#cartDrawer .bill-lines"].bottom - 1
      };
    });
    check(bag.drawerWidth >= viewport.width - 2, viewport, "bag-is-full-width", JSON.stringify(bag.values["#cartDrawer"]));
    check(bag.couponWithin, viewport, "coupon-fits-bag-width");
    check(bag.billAfterCoupon, viewport, "bill-below-coupon");
    check(bag.checkoutAfterBill, viewport, "checkout-below-bill");
    check(bag.drawerOpaque, viewport, "bag-drawer-is-opaque", bag.drawerBackground);
    check(bag.toastHidden, viewport, "toast-does-not-cover-bag");

    if (viewport.width === 390) {
      await page.screenshot({ path: path.join(OUT_DIR, "mobile-390-bag.png") });
    }

    await page.locator("#closeCart").click();
    await page.locator("#menuGrid [data-customize]").first().click();
    await page.waitForFunction(() => document.querySelector("#dishDetailDialog")?.open === true);
    const detail = await page.evaluate(() => {
      const dialog = document.querySelector("#dishDetailDialog");
      const r = dialog.getBoundingClientRect();
      const image = dialog.querySelector("img")?.getBoundingClientRect();
      const width = window.innerWidth;
      return {
        dialogWithinViewport: r.left >= -1 && r.right <= width + 1,
        imageWithinDialog: !image || (image.left >= r.left - 1 && image.right <= r.right + 1),
        dialogWidth: r.width,
        viewportWidth: width
      };
    });
    check(detail.dialogWithinViewport && detail.imageWithinDialog, viewport, "dish-detail-fits-viewport", JSON.stringify(detail));
    await page.locator('[data-close-dialog="dishDetailDialog"]').click().catch(() => {});
    if (viewport.width === 390) {
      await page.locator("#offers").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT_DIR, "mobile-390-page.png") });
    }

    const originalThemeForAddress = await page.evaluate(() => document.documentElement.dataset.theme || "light");
    for (const theme of ["light", "dark"]) {
      const activeTheme = await page.evaluate(() => document.documentElement.dataset.theme || "light");
      if (activeTheme !== theme) {
        await page.locator("#themeToggle").click();
        await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, theme);
      }
      await page.locator("#appLocationTrigger").click();
      await page.waitForFunction(() => document.querySelector("#profileDialog")?.open === true);
      const houseField = page.locator('#profileDialog .address-grid input[name="house"]');
      await houseField.click();
      const focusStyle = await houseField.evaluate(element => {
        const style = getComputedStyle(element);
        const rgb = style.borderTopColor.match(/\d+/g)?.map(Number) || [];
        return {
          theme:document.documentElement.dataset.theme || "light",
          outlineStyle:style.outlineStyle,
          outlineWidth:style.outlineWidth,
          borderColor:style.borderTopColor,
          borderLooksRed:rgb.length >= 3 && rgb[0] > rgb[1] * 1.25 && rgb[0] > rgb[2] * 1.25,
          boxShadow:style.boxShadow
        };
      });
      check(focusStyle.outlineStyle === "none" && focusStyle.outlineWidth === "0px" &&
        !focusStyle.borderLooksRed,
        viewport, "address-field-focus-is-calm-in-" + theme, JSON.stringify(focusStyle));
      await page.locator('[data-close-dialog="profileDialog"]').click();
    }
    const currentThemeAfterAddress = await page.evaluate(() => document.documentElement.dataset.theme || "light");
    if (currentThemeAfterAddress !== originalThemeForAddress) {
      await page.locator("#themeToggle").click();
      await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, originalThemeForAddress);
    }

    await page.locator("#openProfile").click();
    await page.waitForFunction(() => document.querySelector("#profileDialog")?.open === true);
    const accountUi = await page.evaluate(() => {
      const dialog = document.querySelector("#profileDialog");
      const rect = dialog.getBoundingClientRect();
      return {
        fitsViewport: rect.left >= -1 && rect.right <= window.innerWidth + 1,
        dialogWidth: rect.width,
        viewportWidth: window.innerWidth,
        hasSignIn: Boolean(document.querySelector("#customerLoginForm input[name=email]") &&
          document.querySelector("#customerLoginForm input[name=password]")),
        hasRegistration: Boolean(document.querySelector("#customerRegisterForm input[name=name]") &&
          document.querySelector("#customerRegisterForm input[name=phone]") &&
          document.querySelector("#customerRegisterForm input[name=password]")),
        hasSavedAddressList: Boolean(document.querySelector("#savedAddressesPanel #savedAddressesList")),
        formFits: (() => {
          const form = document.querySelector("#profileForm");
          return !form || form.scrollWidth <= form.clientWidth + 1;
        })(),
        formGeometry: (() => {
          const form = document.querySelector("#profileForm");
          if (!form) return null;
          const box = form.getBoundingClientRect();
          const offenders = Array.from(form.querySelectorAll("input,select,textarea,.form-grid,.form-field"))
            .map(el => ({ selector:el.id ? "#" + el.id : (el.name ? el.tagName.toLowerCase() + "[name=" + el.name + "]" : el.className || el.tagName.toLowerCase()),
              left:Math.round(el.getBoundingClientRect().left), right:Math.round(el.getBoundingClientRect().right),
              width:Math.round(el.getBoundingClientRect().width), scrollWidth:el.scrollWidth }))
            .filter(item => item.right > box.right + 1 || item.left < box.left - 1);
          return { scrollWidth:form.scrollWidth, clientWidth:form.clientWidth, rectWidth:Math.round(box.width), offenders };
        })()
      };
    });
    check(accountUi.fitsViewport && accountUi.formFits, viewport, "account-dialog-fits-mobile", JSON.stringify(accountUi));
    check(accountUi.hasSignIn && accountUi.hasRegistration && accountUi.hasSavedAddressList,
      viewport, "customer-account-controls-render", JSON.stringify(accountUi));
    if (viewport.width === 390) await page.screenshot({ path: path.join(OUT_DIR, "mobile-390-account.png") });
    await page.locator('[data-close-dialog="profileDialog"]').click();

    const scrollFrameMetrics = await page.evaluate(async () => {
      const scroller = document.scrollingElement;
      const maxScroll = scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
      const start = performance.now();
      let last = start;
      const frames = [];
      return await new Promise(resolve => {
        function tick(now) {
          frames.push(now - last);
          last = now;
          const progress = Math.min(1, (now - start) / 1200);
          if (scroller) scroller.scrollTop = maxScroll * progress;
          if (progress < 1) requestAnimationFrame(tick);
          else {
            const sorted = frames.slice().sort((a,b) => a-b);
            resolve({
              frames:frames.length,
              scrollRangePx:maxScroll,
              p95FrameMs:sorted.length ? Math.round(sorted[Math.floor((sorted.length - 1) * .95)] * 10) / 10 : null,
              maxFrameMs:sorted.length ? Math.round(sorted[sorted.length - 1] * 10) / 10 : null
            });
          }
        }
        requestAnimationFrame(tick);
      });
    });
    const performance = await page.evaluate(() => {
      const nav = window.performance.getEntriesByType("navigation")[0];
      const resources = window.performance.getEntriesByType("resource");
      const images = resources.filter(item => item.initiatorType === "img" ||
        item.name.includes("images.unsplash.com") || item.name.includes("images.pexels.com"));
      return {
        domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : null,
        loadEventMs: nav ? Math.round(nav.loadEventEnd - nav.startTime) : null,
        imageRequests: images.length,
        encodedImageBytes: images.reduce((sum, item) => sum + (item.encodedBodySize || 0), 0),
        longTasksOver50ms: (window.__foodieLongTasks || []).length,
        longTaskDetails: window.__foodieLongTasks || []
      };
    });
    performance.scrollFrameMetrics = scrollFrameMetrics;
    const unexpectedHttpErrors = httpErrors.filter(item => {
      try { return !new URL(item.url).pathname.includes("/api/"); } catch (_) { return true; }
    });
    check(pageErrors.length === 0, viewport, "no-page-javascript-errors", JSON.stringify(pageErrors));
    check(unexpectedHttpErrors.length === 0, viewport, "no-unexpected-http-errors",
      JSON.stringify({ all:httpErrors, unexpected:unexpectedHttpErrors }));
    check(firstPartyFailures.length === 0, viewport, "no-site-or-food-image-request-failures", JSON.stringify(firstPartyFailures));
    reports.push({ viewport:sizeName(viewport), name:"performance-observation", pass:true, detail:performance });
  } catch (error) {
    failures.push({ viewport:sizeName(viewport), name:"browser-test-execution", pass:false, detail:error.stack || error.message });
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless:true, args:["--no-sandbox","--disable-dev-shm-usage"] });
  try {
    for (const viewport of viewports) await runViewport(browser, viewport);
  } finally {
    await browser.close();
  }
  const report = {
    url: BASE_URL,
    generatedAt: new Date().toISOString(),
    passed: reports.filter(item => item.pass).length,
    failed: failures.length,
    failures,
    checks: reports
  };
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
})();
