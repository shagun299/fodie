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
  { width: 320, height: 720 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 480, height: 960 }
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


async function auditThemeContrast(page, viewport, themeName, heroOnly=false) {
  const audit = await page.evaluate(() => {
    function parseColor(value) {
      const input = String(value || "").trim();
      const hex = input.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      if (hex) {
        let value = hex[1];
        if (value.length === 3) value = value.split("").map(char => char + char).join("");
        return [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16)).concat(1);
      }
      const rgb = input.match(/rgba?\(([^)]+)\)/i);
      if (!rgb) return null;
      const parts = rgb[1].replace(/\s*\/\s*/g, ",").split(",").map(part => Number.parseFloat(part.trim()));
      if (parts.length < 3 || parts.slice(0, 3).some(number => !Number.isFinite(number))) return null;
      return [parts[0], parts[1], parts[2], Number.isFinite(parts[3]) ? parts[3] : 1];
    }
    function blend(foreground, background) {
      const alpha = foreground[3] ?? 1;
      return [0,1,2].map(index => foreground[index] * alpha + background[index] * (1 - alpha)).concat(1);
    }
    function luminance(color) {
      const linear = color.slice(0, 3).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    }
    function ratio(first, second) {
      const a = luminance(first), b = luminance(second);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }
    const root = getComputedStyle(document.documentElement);
    const paper = parseColor(root.getPropertyValue("--paper").trim()) || [245,247,242,1];
    const card = parseColor(root.getPropertyValue("--card").trim()) || [255,254,250,1];
    const paperDeep = parseColor(root.getPropertyValue("--paper-deep").trim()) || paper;
    const surfaces = {
      paper, card, paperDeep,
      greenSoft:parseColor(root.getPropertyValue("--green-soft").trim()) || [231,239,231,1],
      green:parseColor(root.getPropertyValue("--green").trim()) || [43,87,60,1],
      forest:parseColor("#203d2e"),
      goldButton:parseColor("#d6b985"),
      heroNote:parseColor("#193826"),
      forestDeep:parseColor("#172c21")
    };
    const specs = [
      ["hero-headline","#heroTitle","forest"],
      ["hero-highlight","#heroTitle em","forest"],
      ["hero-description",".hero-description","forest"],
      ["hero-note-title",".hero-copy .hero-note strong","heroNote"],
      ["hero-note-description",".hero-copy .hero-note small","heroNote"],
      ["hero-side-note",".hero-side-note","heroNote"],
      ["menu-heading","#menuTitle","paper"],
      ["menu-description",".menu-heading p","paper"],
      ["dish-name","#menuGrid .dish-content h3","card"],
      ["dish-description","#menuGrid .dish-description","card"],
      ["dish-category","#menuGrid .dish-category","card"],
      ["dish-time","#menuGrid .dish-time","card"],
      ["dish-price","#menuGrid .dish-prices strong","card"],
      ["category-label","#categoryTabs .category-label","paper"],
      ["diet-filter","#menu .diet-button","paper"],
      ["location-label",".app-location-copy small","card"],
      ["location-value","#appLocationText","card"],
      ["search-text","#menuSearch","paperDeep"],
      ["search-placeholder","#menuSearch","paperDeep","::placeholder"],
      ["offer-heading",".offer-slide.is-active .offer-copy h2","forest"],
      ["offer-highlight",".offer-slide.is-active .offer-copy h2 em","forest"],
      ["offer-description",".offer-slide.is-active .offer-copy p","forest"],
      ["offer-kicker",".offer-slide.is-active .offer-kicker","forest"],
      ["feature-heading",".feature-heading h2","paper"],
      ["feature-highlight",".feature-heading h2 em","paper"],
      ["feature-description",".feature-heading p","paper"],
      ["meal-field-label",".feature-field","card"],
      ["meal-field-name",".feature-field span","card"],
      ["meal-summary-note",".meal-builder-summary small","paperDeep"],
      ["recommendation-name",".recommendation-card-copy h3","card"],
      ["recommendation-description",".recommendation-card-copy p","card"],
      ["rewards-heading",".rewards-copy h2","forest"],
      ["rewards-highlight",".rewards-copy h2 em","forest"],
      ["rewards-description",".rewards-copy p","forest"],
      ["story-heading",".story-copy h2","paper"],
      ["story-description",".story-copy > p","paper"],
      ["footer-heading",".site-footer .footer-column h3","forestDeep"],
      ["footer-link",".site-footer .footer-column a","forestDeep"],
      ["footer-description",".site-footer .footer-brand p","forestDeep"],
      ["footer-bottom",".site-footer .footer-bottom","forestDeep"],
      ["mobile-dock-label","#mobileDock .mobile-dock-item","card"],
      ["quick-access-title",".quick-access-label strong","card"],
      ["quick-access-description",".quick-access-label small","card"],
      ["sort-label",".sort-control","paper"],
      ["menu-status","#menuStatus","paper"]
    ];
    const colors = [];
    for (const [name, selector, surfaceName, pseudo] of specs) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const style = getComputedStyle(element, pseudo || null);
      const display = getComputedStyle(element).display;
      const visibility = getComputedStyle(element).visibility;
      if (display === "none" || visibility === "hidden") continue;
      const foreground = parseColor(style.color);
      if (!foreground) {
        colors.push({name,selector,pass:false,reason:"unreadable computed foreground",color:style.color});
        continue;
      }
      const background = surfaces[surfaceName];
      const composite = foreground[3] < 1 ? blend(foreground, background) : foreground;
      const contrast = ratio(composite, background);
      colors.push({
        name,selector,color:style.color,background:surfaceName,
        contrast:Number(contrast.toFixed(2)),pass:contrast >= 4.5
      });
    }
    const eyebrowElement = document.querySelector(".hero-copy > .eyebrow");
    let eyebrowAudit = null;
    if (eyebrowElement) {
      const style = getComputedStyle(eyebrowElement);
      const textColor = parseColor(style.color);
      const pillColor = parseColor(style.backgroundColor);
      const lineElement = eyebrowElement.querySelector(".eyebrow-line");
      const lineStyle = lineElement ? getComputedStyle(lineElement) : null;
      const lineColor = lineStyle ? parseColor(lineStyle.backgroundColor) : null;
      const heroSurface = surfaces.forest;
      const actualPill = pillColor ? blend(pillColor, heroSurface) : heroSurface;
      const actualText = textColor ? (textColor[3] < 1 ? blend(textColor, actualPill) : textColor) : null;
      const actualLine = lineColor ? blend(lineColor, actualPill) : null;
      const rect = lineElement?.getBoundingClientRect();
      eyebrowAudit = {
        text:eyebrowElement.innerText.replace(/\\s+/g," ").trim(),
        display:style.display,
        visibility:style.visibility,
        textContrast:actualText ? Number(ratio(actualText, actualPill).toFixed(2)) : 0,
        lineContrast:actualLine ? Number(ratio(actualLine, actualPill).toFixed(2)) : 0,
        lineWidth:rect ? rect.width : 0,
        lineHeight:rect ? rect.height : 0,
        background:style.backgroundColor,
        textColor:style.color
      };
    }
    function effectiveBackground(element) {
      const fallback = surfaces.paper;
      const layers = [];
      let current = element;
      while (current && current.nodeType === 1) {
        const color = parseColor(getComputedStyle(current).backgroundColor);
        if (color && color[3] > 0) layers.push(color);
        current = current.parentElement;
      }
      let background = fallback;
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        background = blend(layers[index], background);
      }
      return background;
    }
    const controls = [];
    for (const [name, selector, surfaceName] of [
      ["header-theme-button",".theme-button","card"],
      ["header-favourites-button",".favourite-shortcut","card"],
      ["header-profile-button","#openProfile","card"],
      ["header-cart-button","#openCart","card"],
      ["delivery-address-button","#appLocationTrigger","paper"],
      ["veg-mode-button","#appVegToggle","greenSoft"],
      ["category-filter","#categoryTabs .category-tab","paper"],
      ["diet-filter-button","#menu .diet-button","paper"],
      ["sort-control","#sortMenu","card"],
      ["mobile-dock-item","#mobileDock .mobile-dock-item","card"],
      ["hero-customise-button",".hero-copy .hero-note-action","heroNote"],
      ["hero-image-side-note",".hero-visual .hero-side-note","heroNote"],
      ["dish-add-button","#menuGrid .add-button","greenSoft"],
      ["quick-access-button",".quick-access-card","card"],
      ["account-tab",".account-auth-tab","card"],
      ["profile-tab",".profile-tab","card"],
      ["payment-method",".payment-method-card","card"],
      ["hero-primary-cta",".hero-actions .button-primary","goldButton"],
      ["dish-customise-link","#menuGrid .customize-link","card"],
      ["offer-previous-button","#offerPrevious","card"],
      ["offer-next-button","#offerNext","card"],
      ["clear-filters-button","#clearFilters","card"]
    ]) {
      const element = document.querySelector(selector);
      if (!element || getComputedStyle(element).display === "none") continue;
      const style = getComputedStyle(element);
      const foreground = parseColor(style.color);
      const background = effectiveBackground(element);
      const composite = foreground && foreground[3] < 1 ? blend(foreground, background) : foreground;
      const contrast = composite ? ratio(composite, background) : 0;
      controls.push({name,selector,color:style.color,background:surfaceName,
        contrast:Number(contrast.toFixed(2)),pass:contrast >= 4.5});
    }
    const failedControls = controls.filter(item => !item.pass);
    const heroCards = Array.from(document.querySelectorAll(".hero-copy .hero-note"));
    const heroNoteAudit = heroCards.map(card => {
      const cardStyle = getComputedStyle(card);
      const background = parseColor(cardStyle.backgroundColor);
      const title = card.querySelector("strong");
      const description = card.querySelector("small");
      const titleColor = title ? parseColor(getComputedStyle(title).color) : null;
      const descriptionColor = description ? parseColor(getComputedStyle(description).color) : null;
      const border = parseColor(cardStyle.borderTopColor);
      return {
        background:cardStyle.backgroundColor,
        titleContrast:background && titleColor ? Number(ratio(titleColor,background).toFixed(2)) : 0,
        descriptionContrast:background && descriptionColor ? Number(ratio(descriptionColor,background).toFixed(2)) : 0,
        borderWidth:Number.parseFloat(cardStyle.borderTopWidth) || 0,
        borderContrast:background && border ? Number(ratio(blend(border,background),background).toFixed(2)) : 0
      };
    });
    const sideNote = document.querySelector(".hero-visual .hero-side-note");
    const sideNoteAudit = (() => {
      if (!sideNote) return null;
      const style = getComputedStyle(sideNote);
      const background = parseColor(style.backgroundColor);
      const foreground = parseColor(style.color);
      const rect = sideNote.getBoundingClientRect();
      return {
        display:style.display,visibility:style.visibility,
        background:style.backgroundColor,
        textContrast:background && foreground ? Number(ratio(foreground,background).toFixed(2)) : 0,
        borderWidth:Number.parseFloat(style.borderTopWidth) || 0,
        width:rect.width,height:rect.height
      };
    })();
    const noteDivider = document.querySelector(".hero-notes .note-divider");
    const noteDividerAudit = (() => {
      if (!noteDivider) return null;
      const style = getComputedStyle(noteDivider);
      const foreground = parseColor(style.backgroundColor);
      const rect = noteDivider.getBoundingClientRect();
      return {
        display:style.display,visibility:style.visibility,
        contrast:foreground ? Number(ratio(foreground,surfaces.forest).toFixed(2)) : 0,
        width:rect.width,height:rect.height
      };
    })();
    const borders = [];
    for (const [name, selector, surfaceName] of [
      ["dish-card-border","#menuGrid .dish-card","card"],
      ["search-border",".app-search-box","paperDeep"],
      ["meal-builder-border",".meal-builder-shell","card"],
      ["quick-access-border",".quick-access-card","card"],
      ["mobile-dock-border","#mobileDock","card"],
      ["hero-note-border",".hero-copy .hero-note","heroNote"],
      ["hero-side-note-border",".hero-visual .hero-side-note","heroNote"]
    ]) {
      const element = document.querySelector(selector);
      if (!element || getComputedStyle(element).display === "none") continue;
      const style = getComputedStyle(element);
      const color = parseColor(style.borderTopColor);
      const width = Number.parseFloat(style.borderTopWidth) || 0;
      const background = effectiveBackground(element);
      if (!color || width === 0) {
        borders.push({name,selector,pass:false,width,color:style.borderTopColor});
        continue;
      }
      const visibleLine = blend(color, background);
      const contrast = ratio(visibleLine, background);
      borders.push({name,selector,width,contrast:Number(contrast.toFixed(2)),pass:contrast >= 1.2});
    }
    const stabilitySheet = Array.from(document.styleSheets).find(sheet =>
      String(sheet.href || "").includes("mobile-layout-stability-v1.css"));
    const matchedRules = (selector, property) => {
      const element = document.querySelector(selector);
      if (!element) return [];
      const found = [];
      const walk = (rules, href) => {
        for (const rule of Array.from(rules || [])) {
          if (rule.selectorText && rule.style && rule.style.getPropertyValue(property)) {
            let matches = false;
            try { matches = element.matches(rule.selectorText); } catch (_) {}
            if (matches) found.push({
              href, selector:rule.selectorText,
              value:rule.style.getPropertyValue(property).trim(),
              important:rule.style.getPropertyPriority(property)
            });
          }
          if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules, href);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try { walk(sheet.cssRules, sheet.href || "inline"); } catch (_) {}
      }
      return found.slice(-8);
    };
    const rootDarkMatches = (() => { try { return document.documentElement.matches(':root[data-theme="dark"]'); } catch (_) { return false; } })();
    const stylesheetRuleDump = (() => {
      if (!stabilitySheet) return [];
      try {
        return Array.from(stabilitySheet.cssRules).map(rule => ({
          type:rule.constructor?.name || "",
          selector:rule.selectorText || "",
          nested:rule.cssRules?.length || 0,
          sample:String(rule.cssText || "").slice(0,180)
        }));
      } catch (error) { return [{error:error.message}]; }
    })();
    const cssDiagnostics = {
      layerLinkPresent:Boolean(stabilitySheet),
      layerHref:stabilitySheet?.href || "",
      layerRules:(() => { try { return stabilitySheet ? stabilitySheet.cssRules.length : 0; } catch (_) { return -1; } })(),
      rootDarkMatches,
      darkTargetMatches:(() => { try { return Boolean(document.querySelector(':root[data-theme="dark"] #menuGrid .dish-content h3')); } catch (_) { return false; } })(),
      elementCounts:{
        dish:document.querySelectorAll("#menuGrid .dish-content h3").length,
        diet:document.querySelectorAll("#menu .diet-button").length
      },
      stylesheetRuleDump,
      theme:document.documentElement.dataset.theme || "",
      dishName:{
        inline:document.querySelector("#menuGrid .dish-content h3")?.getAttribute("style") || "",
        computed:getComputedStyle(document.querySelector("#menuGrid .dish-content h3") || document.body).color,
        rules:matchedRules("#menuGrid .dish-content h3","color")
      },
      dietButton:{
        inline:document.querySelector("#menu .diet-button")?.getAttribute("style") || "",
        computed:getComputedStyle(document.querySelector("#menu .diet-button") || document.body).color,
        rules:matchedRules("#menu .diet-button","color")
      },
      search:{
        inline:document.querySelector("#menuSearch")?.getAttribute("style") || "",
        computed:getComputedStyle(document.querySelector("#menuSearch") || document.body).color,
        rules:matchedRules("#menuSearch","color")
      },
      cardBorder:{
        computed:getComputedStyle(document.querySelector("#menuGrid .dish-card") || document.body).borderTopColor,
        rules:matchedRules("#menuGrid .dish-card","border-color")
      }
    };
    const isForestSurface = value => {
      const parsed = parseColor(value);
      return Boolean(parsed &&
        parsed.slice(0,3).every((channel,index) => Math.abs(channel - [25,56,38][index]) <= 2) &&
        parsed[3] >= .98);
    };
    return {
      theme:document.documentElement.dataset.theme,
      cssDiagnostics,
      colors,
      borders,
      controls,
      heroNoteAudit,
      sideNoteAudit,
      noteDividerAudit,
      eyebrowAudit,
      failedColors:colors.filter(item => !item.pass),
      failedBorders:borders.filter(item => !item.pass),
      failedControls,
      failedHeroNotes:heroNoteAudit.filter(item => item.titleContrast < 4.5 || item.descriptionContrast < 4.5 ||
        item.borderWidth < 1 || item.borderContrast < 1.5 || !isForestSurface(item.background)),
      failedSideNote:!sideNoteAudit || sideNoteAudit.display === "none" || sideNoteAudit.visibility === "hidden" ||
        sideNoteAudit.textContrast < 4.5 || sideNoteAudit.borderWidth < 1 ||
        sideNoteAudit.width < 80 || sideNoteAudit.height < 20 ||
        !isForestSurface(sideNoteAudit.background),
      failedNoteDivider:noteDividerAudit && noteDividerAudit.display !== "none" &&
        (noteDividerAudit.visibility === "hidden" || noteDividerAudit.contrast < 2 ||
         Math.min(noteDividerAudit.width,noteDividerAudit.height) < .5),
      footerLogo: (() => {
        const light = document.querySelector(".site-footer .footer-logo-light");
        const dark = document.querySelector(".site-footer .footer-logo-dark");
        if (!light || !dark) return null;
        return {
          lightDisplay:getComputedStyle(light).display,
          darkDisplay:getComputedStyle(dark).display,
          darkSource:dark.getAttribute("src") || "",
          darkNaturalWidth:dark.naturalWidth
        };
      })()
    };
  });
  check(Boolean(audit.footerLogo) &&
    audit.footerLogo.lightDisplay === "none" &&
    audit.footerLogo.darkDisplay !== "none" &&
    audit.footerLogo.darkSource.toLowerCase().includes("foodiehub_logo_dark.svg") &&
    audit.footerLogo.darkNaturalWidth > 0,
    viewport, themeName + "-footer-wordmark-uses-high-contrast-dark-logo",
    JSON.stringify(audit.footerLogo));
  if (!heroOnly) {
  check(audit.theme === themeName && audit.colors.length >= 25 && audit.failedColors.length === 0,
    viewport, themeName + "-theme-text-has-readable-contrast",
    JSON.stringify({tested:audit.colors.length,failures:audit.failedColors,css:audit.cssDiagnostics}));
  check(audit.controls.length >= 8 && audit.failedControls.length === 0,
    viewport, themeName + "-theme-control-contrast",
    JSON.stringify({tested:audit.controls.length,failures:audit.failedControls,css:audit.cssDiagnostics}));
  }
  check(audit.heroNoteAudit.length === 2 && audit.failedHeroNotes.length === 0 &&
    !audit.failedSideNote && !audit.failedNoteDivider,
    viewport, themeName + "-hero-note-surfaces-and-copy-remain-readable",
    JSON.stringify({cards:audit.heroNoteAudit,sideNote:audit.sideNoteAudit,divider:audit.noteDividerAudit,
      failedCards:audit.failedHeroNotes,failedSideNote:audit.failedSideNote,failedDivider:audit.failedNoteDivider}));
  if (!heroOnly) {
  check(audit.borders.length >= 4 && audit.failedBorders.length === 0,
    viewport, themeName + "-theme-ui-dividers-remain-visible",
    JSON.stringify({tested:audit.borders.length,failures:audit.failedBorders,css:audit.cssDiagnostics}));
  check(Boolean(audit.eyebrowAudit) && audit.eyebrowAudit.display !== "none" &&
    audit.eyebrowAudit.visibility !== "hidden" && audit.eyebrowAudit.text === "A CLEAR MENU. AN EASY ORDER." &&
    audit.eyebrowAudit.textContrast >= 4.5 && audit.eyebrowAudit.lineContrast >= 3 &&
    audit.eyebrowAudit.lineWidth >= 20 && audit.eyebrowAudit.lineHeight >= 1,
    viewport, themeName + "-hero-eyebrow-and-gold-line-visible", JSON.stringify(audit.eyebrowAudit));
  }
}

async function waitForThemeTransition(page) {
  await page.waitForFunction(() => {
    const button = document.querySelector("#themeToggle");
    return (!button || !button.classList.contains("is-theme-switching")) &&
      !document.documentElement.classList.contains("theme-transition-fallback");
  }, { timeout:5000 });
}

async function auditInteractionMotion(page, viewport, label) {
  const audit = await page.evaluate(() => {
    const read = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        transitionProperty:style.transitionProperty,
        transitionDuration:style.transitionDuration,
        transitionTimingFunction:style.transitionTimingFunction
      };
    };
    return {
      button:read(".hero-actions .button"),
      iconButton:read("#themeToggle"),
      category:read("#categoryTabs .category-tab"),
      addButton:read("#menuGrid .add-button"),
      mobileDock:read("#mobileDock .mobile-dock-item"),
      card:read("#menuGrid .dish-card"),
      cartDrawer:read("#cartDrawer"),
      dialog:read("#profileDialog"),
      offer:read("#offerCarousel .offer-slide"),
      input:read("#menuSearch")
    };
  });
  const keys = ["button","iconButton","category","addButton","mobileDock","card","cartDrawer","dialog","offer","input"];
  const missing = keys.filter(key => !audit[key]);
  const hasMotion = item => item && item.transitionDuration.split(",").some(value => {
    const ms = parseFloat(value);
    return Number.isFinite(ms) && ms > 0;
  });
  const nonResponsive = keys.filter(key => !hasMotion(audit[key]));
  check(missing.length === 0 && nonResponsive.length === 0,
    viewport, label + "-interaction-motion-is-configured",
    JSON.stringify({missing,nonResponsive,audit}));

  await page.emulateMedia({ reducedMotion:"reduce" });
  const reduced = await page.evaluate(() => {
    const selectors = [".hero-actions .button","#themeToggle","#categoryTabs .category-tab",
      "#menuGrid .add-button","#mobileDock .mobile-dock-item","#menuGrid .dish-card",
      "#cartDrawer","#profileDialog","#offerCarousel .offer-slide","#menuSearch"];
    return selectors.map(selector => {
      const element = document.querySelector(selector);
      return {selector,duration:element ? getComputedStyle(element).transitionDuration : "missing"};
    });
  });
  const reducedMotionApplied = reduced.every(item => item.duration.split(",").every(value => {
    const ms = parseFloat(value);
    return Number.isFinite(ms) && ms <= .01;
  }));
  check(reducedMotionApplied, viewport, label + "-reduced-motion-setting-disables-interaction-transitions",
    JSON.stringify(reduced));
  await page.emulateMedia({ reducedMotion:"no-preference" });
}

async function auditMobileLayout(page, viewport, themeName) {
  const audit = await page.evaluate(() => {
    const sectionSelectors = [
      ".hero-section",".promise-strip","#quickAccess","#offers","#menu",
      "#meal-studio","#smart-combos","#rewards",".story-section",".closing-banner"
    ];
    const sections = sectionSelectors.map(selector => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      if (!element || !rect || rect.width <= 0 || getComputedStyle(element).display === "none") return null;
      return {selector,left:Math.round(rect.left),right:Math.round(rect.right),width:Math.round(rect.width)};
    }).filter(Boolean);
    const lefts = sections.map(item => item.left);
    const rights = sections.map(item => item.right);
    const aligned = sections.length >= 5 &&
      Math.max(...lefts)-Math.min(...lefts) <= 2 &&
      Math.max(...rights)-Math.min(...rights) <= 2;
    const boundsSelectors = [
      ".header-inner","#appLocationTrigger",".app-search-box","#quickAccess .quick-access-card",
      "#offerCarousel .offer-slide.is-active","#menu .sort-control","#menuGrid .dish-card",
      "#meal-studio .meal-builder-shell","#mobileDock",".site-footer"
    ];
    const outOfBounds = boundsSelectors.map(selector => {
      const element = document.querySelector(selector);
      if (!element || getComputedStyle(element).display === "none") return null;
      const rect = element.getBoundingClientRect();
      return rect.width <= 0 || rect.left < -1 || rect.right > window.innerWidth + 1
        ? {selector,left:Math.round(rect.left),right:Math.round(rect.right),width:Math.round(rect.width)}
        : null;
    }).filter(Boolean);
    const grid = document.querySelector("#menuGrid");
    const gridStyle = grid ? getComputedStyle(grid) : null;
    const gridColumns = gridStyle ? gridStyle.gridTemplateColumns.split(" ").filter(Boolean).length : 0;
    const cards = Array.from(document.querySelectorAll("#menuGrid .dish-card")).slice(0,6).map(card => {
      const cardRect = card.getBoundingClientRect();
      const image = card.querySelector(".dish-image-wrap")?.getBoundingClientRect();
      const content = card.querySelector(".dish-content")?.getBoundingClientRect();
      const imageContained = Boolean(image && image.left >= cardRect.left - 1 &&
        image.right <= cardRect.right + 1 && image.top >= cardRect.top - 1 &&
        image.bottom <= cardRect.bottom + 1);
      const contentContained = Boolean(content && content.left >= cardRect.left - 1 &&
        content.right <= cardRect.right + 1 && content.bottom <= cardRect.bottom + 1);
      const imageAboveCopy = Boolean(image && content && image.bottom <= content.top + 2 &&
        Math.abs(image.left-cardRect.left) <= 2 && Math.abs(content.left-cardRect.left) <= 2);
      const imageRatio = image && image.height > 0 ? image.width / image.height : 0;
      return {
        valid:imageContained && contentContained && imageAboveCopy && imageRatio >= 1.05 && imageRatio <= 1.55,
        imageRatio:Number(imageRatio.toFixed(2)),
        cardWidth:Math.round(cardRect.width),
        imageHeight:Math.round(image?.height || 0)
      };
    });
    const hero = document.querySelector(".hero-section");
    const heroDiagnostics = (() => {
      if (!hero) return null;
      const rect = hero.getBoundingClientRect();
      const describe = element => {
        const r = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag:element.tagName,className:String(element.className || ""),id:element.id || "",
          display:style.display,position:style.position,gridColumn:style.gridColumn,
          width:style.width,minWidth:style.minWidth,maxWidth:style.maxWidth,
          left:Math.round(r.left),right:Math.round(r.right),rectWidth:Math.round(r.width),
          clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,
          overflowX:style.overflowX,flex:style.flex
        };
      };
      return {
        hero:describe(hero),
        children:Array.from(hero.children).map(describe),
        notes:hero.querySelector(".hero-notes") ? describe(hero.querySelector(".hero-notes")) : null,
        notesChildren:hero.querySelector(".hero-notes") ? Array.from(hero.querySelector(".hero-notes").children).map(describe) : [],
        scrollableDescendants:Array.from(hero.querySelectorAll("*"))
          .filter(element => getComputedStyle(element).display !== "none" &&
            element.scrollWidth > element.clientWidth + 2)
          .map(describe).slice(0,20)
      };
    })();
    const overflowingSections = [".hero-section",".promise-strip","#quickAccess","#offers","#menu",
      "#meal-studio","#smart-combos","#rewards",".story-section",".closing-banner"]
      .map(selector => document.querySelector(selector))
      .filter(element => element && getComputedStyle(element).display !== "none" &&
        element.scrollWidth > element.clientWidth + 2)
      .map(element => {
        const rect = element.getBoundingClientRect();
        const offenders = Array.from(element.querySelectorAll("*")).map(child => {
          const childRect = child.getBoundingClientRect();
          if (getComputedStyle(child).display === "none" ||
              getComputedStyle(child).visibility === "hidden") return null;
          return childRect.right > rect.right + 1 || childRect.left < rect.left - 1
            ? {tag:child.tagName,className:String(child.className || ""),id:child.id,
              left:Math.round(childRect.left),right:Math.round(childRect.right)}
            : null;
        }).filter(Boolean).slice(0,15);
        return {
          section:element.id || element.className || element.tagName,
          clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,
          left:Math.round(rect.left),right:Math.round(rect.right),
          overflowX:getComputedStyle(element).overflowX,
          offenders
        };
      });
    const actionSelectors = [
      ".hero-actions .button","#themeToggle","#favouritesToggle","#openProfile","#openCart",
      "#appVegToggle",".quick-access-card","#offerCarousel .offer-copy .button",
      "#menu .diet-button","#menuGrid .add-button","#mobileDock .mobile-dock-item"
    ];
    const actions = actionSelectors.flatMap(selector => Array.from(document.querySelectorAll(selector)))
      .filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
      });
    const invalidActions = actions.map(element => {
      const rect = element.getBoundingClientRect();
      return rect.left < -1 || rect.right > window.innerWidth + 1 || rect.height < 26
        ? {name:element.id || element.className || element.tagName,
          left:Math.round(rect.left),right:Math.round(rect.right),height:Math.round(rect.height)}
        : null;
    }).filter(Boolean);
    return {
      sections,aligned,outOfBounds,cardCount:cards.length,gridColumns,
      cardsAligned:cards.length >= 3 && cards.every(item => item.valid),
      cardMetrics:cards,
      overflowingSections,heroDiagnostics,actionCount:actions.length,invalidActions
    };
  });
  check(audit.aligned, viewport, themeName + "-mobile-sections-share-one-alignment-grid",
    JSON.stringify(audit.sections));
  check(audit.outOfBounds.length === 0 && audit.overflowingSections.length === 0,
    viewport, themeName + "-mobile-sections-and-surfaces-stay-inside-viewport",
    JSON.stringify({outOfBounds:audit.outOfBounds,overflowingSections:audit.overflowingSections,heroDiagnostics:audit.heroDiagnostics}));
  check(audit.cardsAligned, viewport, themeName + "-mobile-dish-cards-have-aligned-image-and-copy",
    JSON.stringify({cardCount:audit.cardCount,gridColumns:audit.gridColumns,metrics:audit.cardMetrics}));
  check(audit.gridColumns === 2, viewport, themeName + "-mobile-food-menu-uses-two-column-grid",
    "Rendered columns: " + audit.gridColumns);
  check(audit.actionCount >= 10 && audit.invalidActions.length === 0,
    viewport, themeName + "-mobile-buttons-fit-and-remain-tappable",
    JSON.stringify({actionCount:audit.actionCount,invalid:audit.invalidActions}));
}


async function auditMobileFeaturePolish(page, viewport, themeName) {
  const state = await page.evaluate(() => {
    const rect = element => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};
    };
    const toolbar = document.querySelector("#menu .menu-toolbar");
    const sort = document.querySelector("#menu .sort-control");
    const tabs = Array.from(document.querySelectorAll("#menu .category-tab")).slice(0,6).map(tab => {
      const icon = tab.querySelector(".category-icon");
      const label = tab.querySelector(".category-label");
      const t=rect(tab),i=rect(icon),l=rect(label);
      return {
        direction:getComputedStyle(tab).flexDirection,
        iconCentered:Boolean(t && i && Math.abs((t.left+t.right-i.left-i.right)/2) <= 3),
        labelCentered:Boolean(t && l && Math.abs((t.left+t.right-l.left-l.right)/2) <= 3),
        iconAboveLabel:Boolean(i && l && i.bottom <= l.top + 2),
        iconHeight:i?.height || 0,
        labelHeight:l?.height || 0
      };
    });
    const meal=document.querySelector("#meal-studio .meal-builder-shell");
    const mealControls=document.querySelector("#meal-studio .meal-builder-controls");
    const mealSelects=Array.from(document.querySelectorAll("#meal-studio .feature-field select"));
    const comboGrid=document.querySelector("#smart-combos .combo-grid");
    const comboCard=document.querySelector("#smart-combos .combo-card");
    const recommendationTitle=document.querySelector("#recommendationTitle");
    const recommendationFilter=document.querySelector("#smart-picks .recommendation-filter");
    const recommendationSelect=document.querySelector("#recommendationMood");
    const newsletter=document.querySelector(".footer-newsletter");
    const newsletterTitle=newsletter?.querySelector("h3");
    const newsletterDescription=newsletter?.querySelector("p");
    return {
      sort:{toolbar:rect(toolbar),control:rect(sort),rightAligned:Boolean(toolbar&&sort&&Math.abs(toolbar.getBoundingClientRect().right-sort.getBoundingClientRect().right)<=3)},
      categories:{count:tabs.length,items:tabs,allCentered:tabs.length>=3&&tabs.every(t=>t.direction==="column"&&t.iconCentered&&t.labelCentered&&t.iconAboveLabel)},
      meal:{
        rect:rect(meal),
        height:meal?.getBoundingClientRect().height || 0,
        headingHeight:document.querySelector("#meal-studio .feature-heading")?.getBoundingClientRect().height||0,
        headingFirstChildHeight:document.querySelector("#meal-studio .feature-heading>div:first-child")?.getBoundingClientRect().height||0,
        headingFirstChildFlexBasis:document.querySelector("#meal-studio .feature-heading>div:first-child")?getComputedStyle(document.querySelector("#meal-studio .feature-heading>div:first-child")).flexBasis:"",
        headingGap:meal&&rect(document.querySelector("#meal-studio .feature-heading")) ?
          Math.round(meal.getBoundingClientRect().top-document.querySelector("#meal-studio .feature-heading").getBoundingClientRect().bottom) : null,
        columns:mealControls?getComputedStyle(mealControls).gridTemplateColumns.split(" ").filter(Boolean).length:0,
        selectors:mealSelects.length,
        selectorsVisible:mealSelects.every(s=>s.getBoundingClientRect().width>0&&s.getBoundingClientRect().height>=34),
        controlsHeight:mealControls?.getBoundingClientRect().height||0,
        summaryHeight:document.querySelector("#meal-studio .meal-builder-summary")?.getBoundingClientRect().height||0,
        mainUsesFullRow:Boolean(mealSelects[0]&&mealSelects[1]&&mealSelects[0].parentElement.getBoundingClientRect().width>
          mealSelects[1].parentElement.getBoundingClientRect().width*1.65),
        titleSize:document.querySelector("#mealStudioTitle")?parseFloat(getComputedStyle(document.querySelector("#mealStudioTitle")).fontSize):0
      },
      combos:{
        grid:rect(comboGrid),
        headingHeight:document.querySelector("#smart-combos .feature-heading")?.getBoundingClientRect().height||0,
        headingFirstChildHeight:document.querySelector("#smart-combos .feature-heading>div:first-child")?.getBoundingClientRect().height||0,
        headingFirstChildFlexBasis:document.querySelector("#smart-combos .feature-heading>div:first-child")?getComputedStyle(document.querySelector("#smart-combos .feature-heading>div:first-child")).flexBasis:"",
        headingGap:comboGrid&&document.querySelector("#smart-combos .feature-heading") ?
          Math.round(comboGrid.getBoundingClientRect().top-document.querySelector("#smart-combos .feature-heading").getBoundingClientRect().bottom) : null,
        columns:comboGrid?getComputedStyle(comboGrid).gridAutoFlow:"",
        card:rect(comboCard),
        count:document.querySelectorAll("#smart-combos .combo-card").length,
        horizontalScroll:Boolean(comboGrid&&comboGrid.scrollWidth>comboGrid.clientWidth+10),
        gridHeight:comboGrid?.getBoundingClientRect().height||0,
        compact:Boolean(comboCard&&comboCard.getBoundingClientRect().height<=165&&comboGrid?.getBoundingClientRect().height<=170)
      },
      recommendations:{
        title:recommendationTitle?.textContent.replace(/\\s+/g," ").trim() || "",
        titleSize:recommendationTitle?parseFloat(getComputedStyle(recommendationTitle).fontSize):0,
        headingHeight:document.querySelector("#smart-picks .feature-heading")?.getBoundingClientRect().height||0,
        headingFirstChildHeight:document.querySelector("#smart-picks .feature-heading>div:first-child")?.getBoundingClientRect().height||0,
        headingFirstChildFlexBasis:document.querySelector("#smart-picks .feature-heading>div:first-child")?getComputedStyle(document.querySelector("#smart-picks .feature-heading>div:first-child")).flexBasis:"",
        selector:rect(recommendationFilter),
        selectorStyle:recommendationFilter ? {height:getComputedStyle(recommendationFilter).height,display:getComputedStyle(recommendationFilter).display} : null,
        select:rect(recommendationSelect),
        selectStyle:recommendationSelect ? {height:getComputedStyle(recommendationSelect).height,minHeight:getComputedStyle(recommendationSelect).minHeight,maxHeight:getComputedStyle(recommendationSelect).maxHeight,aspectRatio:getComputedStyle(recommendationSelect).aspectRatio,appearance:getComputedStyle(recommendationSelect).appearance} : null,
        options:Array.from(recommendationSelect?.options||[]).map(option=>option.textContent.trim()),
        gridColumns:document.querySelector("#smart-picks .recommendation-grid")?getComputedStyle(document.querySelector("#smart-picks .recommendation-grid")).gridTemplateColumns.split(" ").filter(Boolean).length:0,
        gridAutoFlow:document.querySelector("#smart-picks .recommendation-grid")?getComputedStyle(document.querySelector("#smart-picks .recommendation-grid")).gridAutoFlow:"",
        gridCards:document.querySelectorAll("#smart-picks .recommendation-card").length,
        gridHeight:document.querySelector("#smart-picks .recommendation-grid")?.getBoundingClientRect().height||0,
        horizontalScroll:Boolean(document.querySelector("#smart-picks .recommendation-grid")&&
          document.querySelector("#smart-picks .recommendation-grid").scrollWidth>document.querySelector("#smart-picks .recommendation-grid").clientWidth+10),
        cardHeight:document.querySelector("#smart-picks .recommendation-card")?.getBoundingClientRect().height||0,
        headingGap:document.querySelector("#smart-picks .recommendation-grid")&&document.querySelector("#smart-picks .recommendation-heading") ?
          Math.round(document.querySelector("#smart-picks .recommendation-grid").getBoundingClientRect().top-
            document.querySelector("#smart-picks .recommendation-heading").getBoundingClientRect().bottom) : null,
        selectorFits:Boolean(recommendationFilter&&recommendationSelect&&recommendationFilter.getBoundingClientRect().height<=40&&recommendationSelect.getBoundingClientRect().width<=160&&recommendationSelect.getBoundingClientRect().height<=35)
      },
      newsletter:{
        box:rect(newsletter),title:rect(newsletterTitle),description:rect(newsletterDescription),
        headingText:newsletterTitle?.textContent.trim()||"",
        titleLeftAligned:Boolean(newsletterTitle&&newsletterDescription&&Math.abs(newsletterTitle.getBoundingClientRect().left-newsletterDescription.getBoundingClientRect().left)<=2),
        titleToCopy:Boolean(newsletterTitle&&newsletterDescription&&newsletterDescription.getBoundingClientRect().top>=newsletterTitle.getBoundingClientRect().bottom-1),
        formWidth:newsletter?.querySelector(".newsletter-form")?.getBoundingClientRect().width || 0
      }
    };
  });
  const sortRight = Boolean(state.sort.rightAligned && state.sort.control && state.sort.control.width>0);
  check(sortRight,viewport,themeName+"-sort-control-is-anchored-to-the-right",JSON.stringify(state.sort));
  check(state.categories.allCentered,viewport,themeName+"-category-icons-and-labels-share-a-centre",JSON.stringify(state.categories));
  check(state.meal.columns===3&&state.meal.selectors===3&&state.meal.selectorsVisible&&
    !state.meal.mainUsesFullRow&&state.meal.height<=290&&state.meal.headingGap>=0&&state.meal.headingGap<=18&&
    state.meal.headingHeight<=90&&state.meal.headingFirstChildHeight<=70&&
    state.meal.headingFirstChildFlexBasis!=="220px",
    viewport,themeName+"-meal-studio-uses-three-compact-aligned-selectors-without-reserved-gap",JSON.stringify(state.meal));
  check(state.combos.columns==="column"&&state.combos.count>=2&&state.combos.horizontalScroll&&
    state.combos.compact&&state.combos.headingGap>=0&&state.combos.headingGap<=18&&
    state.combos.headingHeight<=90&&state.combos.headingFirstChildHeight<=70&&
    state.combos.headingFirstChildFlexBasis!=="220px",
    viewport,themeName+"-meal-combos-use-compact-horizontal-cards-without-empty-gap",JSON.stringify(state.combos));
  check(state.recommendations.title==="A little inspiration."&&state.recommendations.titleSize<=23&&state.recommendations.selectorFits&&state.recommendations.options[0]==="Popular picks",
    viewport,themeName+"-recommendations-have-a-clean-heading-and-selector",JSON.stringify(state.recommendations));
  check(state.recommendations.gridAutoFlow==="column"&&state.recommendations.gridCards===3&&
    state.recommendations.horizontalScroll&&state.recommendations.gridHeight<=205&&
    state.recommendations.cardHeight<=195&&state.recommendations.headingGap>=0&&state.recommendations.headingGap<=18&&
    state.recommendations.headingHeight<=100&&state.recommendations.headingFirstChildHeight<=70&&
    state.recommendations.headingFirstChildFlexBasis!=="220px",
    viewport,themeName+"-recommendation-cards-form-readable-swipe-row-without-reserved-gap",JSON.stringify(state.recommendations));
  check(state.newsletter.titleLeftAligned&&state.newsletter.titleToCopy&&state.newsletter.formWidth>250,
    viewport,themeName+"-newsletter-heading-and-copy-share-one-left-edge",JSON.stringify(state.newsletter));

  if(viewport.width===390&&themeName==="light") {
    const startY=await page.evaluate(()=>window.scrollY);
    for(const [selector,file] of [
      ["#meal-studio","mobile-390-meal-studio.png"],
      ["#smart-combos","mobile-390-combos.png"],
      ["#smart-picks","mobile-390-recommendations.png"],
      ["#rewards","mobile-390-rewards.png"],
      ["#about","mobile-390-story.png"],
      [".site-footer","mobile-390-footer.png"]
    ]) {
      await page.evaluate((targetSelector) => {
        const element=document.querySelector(targetSelector);
        const header=document.querySelector(".site-header");
        if(!element) return;
        const offset=header ? header.getBoundingClientRect().height : 0;
        const top=element.getBoundingClientRect().top+window.scrollY-offset-8;
        window.scrollTo({top,behavior:"instant"});
      },selector);
      await page.waitForTimeout(240);
      await page.screenshot({path:path.join(OUT_DIR,file)});
    }
    await page.evaluate(y=>window.scrollTo({top:y,behavior:"instant"}),startY);
  }
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


async function auditDiscountBadge(page, viewport, themeName) {
  const count = await page.locator("#menuGrid .dish-image-wrap > .discount-badge").count();
  if (!count) {
    check(false, viewport, "discount-badge-present-in-" + themeName, "No rendered discount badge found");
    return;
  }
  const snapshot = await page.locator("#menuGrid .dish-image-wrap > .discount-badge").first().evaluate(element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const image = element.closest(".dish-image-wrap");
    const imageRect = image?.getBoundingClientRect();
    const favourite = image?.querySelector(".dish-favourite");
    const favouriteRect = favourite?.getBoundingClientRect();
    const parse = value => {
      const parts = String(value || "").match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
      return parts.length >= 3 ? [parts[0],parts[1],parts[2],Number.isFinite(parts[3]) ? parts[3] : 1] : null;
    };
    const luminance = color => {
      const channels = color.slice(0,3).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : Math.pow((channel + .055) / 1.055,2.4);
      });
      return .2126*channels[0] + .7152*channels[1] + .0722*channels[2];
    };
    const foreground = parse(style.color);
    const background = parse(style.backgroundColor);
    const border = parse(style.borderTopColor);
    const contrast = foreground && background ?
      (Math.max(luminance(foreground),luminance(background)) + .05) /
      (Math.min(luminance(foreground),luminance(background)) + .05) : 0;
    return {
      text:element.textContent.trim(),
      foreground,
      background,
      border,
      contrast,
      opacity:Number(style.opacity),
      display:style.display,
      visibility:style.visibility,
      position:style.position,
      zIndex:Number.parseInt(style.zIndex,10) || 0,
      fontSize:Number.parseFloat(style.fontSize) || 0,
      fontWeight:Number.parseInt(style.fontWeight,10) || 0,
      width:rect.width,
      height:rect.height,
      textFits:element.scrollWidth <= element.clientWidth + 1,
      contained:Boolean(imageRect && rect.left >= imageRect.left - 1 && rect.right <= imageRect.right + 1 &&
        rect.top >= imageRect.top - 1 && rect.bottom <= imageRect.bottom + 1),
      overlapsFavourite:Boolean(favouriteRect && rect.left < favouriteRect.right && rect.right > favouriteRect.left &&
        rect.top < favouriteRect.bottom && rect.bottom > favouriteRect.top)
    };
  });
  const expectedBackground = [16,46,30];
  const expectedForeground = [255,253,246];
  const expectedBorder = [240,199,125];
  const near = (actual, expected) => Boolean(actual && expected.every((value,index) => Math.abs(actual[index] - value) <= 2));
  check(snapshot.opacity >= .98 && snapshot.display !== "none" && snapshot.visibility !== "hidden" &&
    snapshot.position === "absolute" && snapshot.zIndex >= 3,
    viewport, "discount-badge-is-solid-and-layered-in-" + themeName, JSON.stringify(snapshot));
  check(near(snapshot.background,expectedBackground) && near(snapshot.foreground,expectedForeground) &&
    near(snapshot.border,expectedBorder) && snapshot.contrast >= 7,
    viewport, "discount-badge-has-high-contrast-in-" + themeName, JSON.stringify(snapshot));
  check(snapshot.height >= (viewport.width <= 760 ? 27 : 30) &&
    snapshot.fontSize >= (viewport.width <= 760 ? 8.5 : 9.5) &&
    snapshot.fontWeight >= 800 && snapshot.textFits,
    viewport, "discount-badge-text-is-readable-and-fits-in-" + themeName, JSON.stringify(snapshot));
  check(snapshot.contained && !snapshot.overlapsFavourite,
    viewport, "discount-badge-stays-inside-photo-in-" + themeName, JSON.stringify(snapshot));
}

async function runDesktopHeroThemeAudit(browser) {
  const desktopViewports = [
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 900, height: 900 },
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1440, height: 960 },
    { width: 1920, height: 1080 }
  ];

  for (const viewport of desktopViewports) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      colorScheme: "light",
      reducedMotion: "no-preference"
    });
    const page = await context.newPage();
    const pageErrors = [];
    const httpErrors = [];
    const firstPartyFailures = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("response", response => {
      if (response.status() >= 400) httpErrors.push({ url:response.url(), status:response.status() });
    });
    page.on("requestfailed", request => {
      const url = request.url();
      if (url.includes("shagun299.github.io") ||
          url.includes("images.unsplash.com") || url.includes("images.pexels.com")) {
        firstPartyFailures.push({ url, error:request.failure()?.errorText || "request failed" });
      }
    });

    try {
      await waitForSite(page);
      await page.waitForTimeout(180);

      const initialState = await page.evaluate(() => {
        const rect = element => {
          if (!element) return null;
          const r = element.getBoundingClientRect();
          return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height };
        };
        const header = document.querySelector(".header-inner");
        const headerChildren = Array.from(header?.children || [])
          .filter(element => getComputedStyle(element).display !== "none" &&
            getComputedStyle(element).visibility !== "hidden" && rect(element)?.width > 0)
          .map(element => ({
            selector:element.id ? "#" + element.id : (element.className || element.tagName.toLowerCase()),
            ...rect(element)
          }));
        const headerOverlaps = headerChildren.slice(1).flatMap((item,index) => {
          const previous = headerChildren[index];
          return previous.right > item.left + 2
            ? [{ previous:previous.selector, current:item.selector, overlap:Math.round(previous.right-item.left) }]
            : [];
        });
        const selectors = [
          ".hero-section",".promise-strip","#quickAccess","#offers","#menu",
          "#meal-studio","#smart-combos","#rewards",".story-section",
          ".closing-banner",".site-footer"
        ];
        const sections = selectors.map(selector => {
          const element = document.querySelector(selector);
          if (!element || getComputedStyle(element).display === "none") return null;
          return { selector, ...rect(element) };
        }).filter(Boolean);
        const outOfBounds = sections.filter(item => item.left < -1 || item.right > window.innerWidth + 1);
        const overflowSelectors = [
          ".hero-section",".promise-strip","#quickAccess","#offers","#menu",
          "#meal-studio","#rewards",".story-section",".closing-banner",".site-footer"
        ];
        const internalOverflow = overflowSelectors.map(selector => {
          const element = document.querySelector(selector);
          if (!element || getComputedStyle(element).display === "none") return null;
          return element.scrollWidth > element.clientWidth + 2
            ? { selector, scrollWidth:element.scrollWidth, clientWidth:element.clientWidth }
            : null;
        }).filter(Boolean);
        const hero = document.querySelector(".hero-section");
        const copy = hero?.querySelector(".hero-copy");
        const visual = hero?.querySelector(".hero-visual");
        const heroRect = rect(hero), copyRect = rect(copy), visualRect = rect(visual);
        const heroChildrenFit = Boolean(heroRect && copyRect && visualRect) &&
          copyRect.left >= heroRect.left - 1 && copyRect.right <= heroRect.right + 1 &&
          visualRect.left >= heroRect.left - 1 && visualRect.right <= heroRect.right + 1;
        const heroChildrenOverlap = Boolean(copyRect && visualRect) &&
          copyRect.left < visualRect.right - 2 && copyRect.right > visualRect.left + 2 &&
          copyRect.top < visualRect.bottom - 2 && copyRect.bottom > visualRect.top + 2;
        const controls = ["#themeToggle","#favouritesToggle","#openProfile","#openCart"];
        const controlMetrics = controls.map(selector => {
          const element = document.querySelector(selector);
          const r = rect(element);
          return { selector, visible:Boolean(r && r.width > 0 && r.height > 0), width:r?.width || 0, height:r?.height || 0 };
        });
        const menuColumns = getComputedStyle(document.querySelector("#menuGrid") || document.body)
          .gridTemplateColumns.split(" ").filter(Boolean).length;
        return {
          viewportWidth:window.innerWidth,
          documentWidth:document.documentElement.scrollWidth,
          bodyWidth:document.body.scrollWidth,
          headerChildren,
          headerOverlaps,
          sections,
          outOfBounds,
          internalOverflow,
          heroChildrenFit,
          heroChildrenOverlap,
          heroGeometry:{hero:heroRect,copy:copyRect,visual:visualRect},
          controlMetrics,
          menuColumns,
          mobileDockDisplay:getComputedStyle(document.querySelector("#mobileDock") || document.body).display,
          initialCart:(() => {
          const drawer = document.querySelector("#cartDrawer");
          const style = drawer ? getComputedStyle(drawer) : null;
          return {
            drawerOpen:Boolean(drawer?.classList.contains("is-open")),
            ariaHidden:drawer?.getAttribute("aria-hidden"),
            visibility:style?.visibility || "missing",
            pointerEvents:style?.pointerEvents || "missing",
            backdropVisible:Boolean(document.querySelector("#cartBackdrop")?.classList.contains("is-visible")),
            bodyLocked:document.body.classList.contains("drawer-open")
          };
        })()
        };
      });
      const desktopShellPass =
        initialState.documentWidth <= viewport.width + 1 &&
        initialState.bodyWidth <= viewport.width + 1 &&
        initialState.headerChildren.length >= 2 &&
        initialState.headerOverlaps.length === 0 &&
        initialState.outOfBounds.length === 0 &&
        initialState.internalOverflow.length === 0 &&
        initialState.heroChildrenFit && !initialState.heroChildrenOverlap &&
        initialState.controlMetrics.every(item => item.visible && item.width >= 28 && item.height >= 28) &&
        initialState.menuColumns >= 2 &&
        initialState.mobileDockDisplay === "none";
      check(desktopShellPass, viewport, "desktop-layout-fits-without-collisions",
        JSON.stringify(initialState));
      check(!initialState.initialCart.drawerOpen &&
        initialState.initialCart.ariaHidden === "true" &&
        initialState.initialCart.visibility === "hidden" &&
        initialState.initialCart.pointerEvents === "none" &&
        !initialState.initialCart.backdropVisible &&
        !initialState.initialCart.bodyLocked,
        viewport, "desktop-cart-starts-fully-hidden", JSON.stringify(initialState.initialCart));

      await auditInteractionMotion(page, viewport, "desktop");
      await auditThemeContrast(page, viewport, "light");
      await auditDiscountBadge(page, viewport, "light");

      if (viewport.width === 1440) {
        await page.screenshot({ path:path.join(OUT_DIR,"desktop-hero-light.png") });
        await page.locator("#favouritesToggle").click();
        await page.waitForFunction(() => document.querySelector("#favouritesToggle")?.getAttribute("aria-label") === "Show all dishes");
        const favouritesOn = await page.locator("#favouritesToggle").evaluate(button => button.classList.contains("is-active"));
        await page.locator("#favouritesToggle").click();
        await page.waitForFunction(() => document.querySelector("#favouritesToggle")?.getAttribute("aria-label") === "Show favourites");
        const favouritesOff = await page.locator("#favouritesToggle").evaluate(button => !button.classList.contains("is-active"));
        check(favouritesOn && favouritesOff, viewport, "desktop-header-favourites-toggle-works",
          JSON.stringify({favouritesOn,favouritesOff}));

        await page.locator("#openProfile").click();
        await page.waitForFunction(() => document.querySelector("#profileDialog")?.open === true);
        await page.locator('[data-close-dialog="profileDialog"]').click();
        await page.waitForFunction(() => document.querySelector("#profileDialog")?.open === false);
        await page.waitForTimeout(360);
        check(await page.locator("#profileDialog").evaluate(dialog => !dialog.open),
          viewport, "desktop-profile-close-button-works");

        await page.locator("#openProfile").click();
        await page.waitForFunction(() => document.querySelector("#profileDialog")?.open === true);
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.querySelector("#profileDialog")?.open === false);
        await page.waitForTimeout(360);
        check(await page.locator("#profileDialog").evaluate(dialog => !dialog.open),
          viewport, "desktop-profile-escape-close-works");
      }

      const themeCycles = [];
      for (const targetTheme of ["dark","light"]) {
        await page.locator("#themeToggle").click();
        await page.waitForFunction(expected => document.documentElement.dataset.theme === expected,
          targetTheme);
        await waitForThemeTransition(page);
        await page.waitForTimeout(80);
        const state = await page.evaluate(() => ({
          theme:document.documentElement.dataset.theme || "",
          toggleLabel:document.querySelector("#themeToggle")?.getAttribute("aria-label") || "",
          metaThemeColor:document.querySelector('meta[name="theme-color"]')?.getAttribute("content") || "",
          transitionClass:document.documentElement.classList.contains("theme-transition-fallback") ||
            Boolean(document.querySelector("#themeToggle")?.classList.contains("is-theme-switching"))
        }));
        const expectedLabel = targetTheme === "dark" ? "Switch to light theme" : "Switch to dark theme";
        const expectedColor = targetTheme === "dark" ? "#101a14" : "#f5f7f2";
        check(state.theme === targetTheme && state.toggleLabel === expectedLabel &&
          state.metaThemeColor === expectedColor && !state.transitionClass,
          viewport, "desktop-theme-toggle-settles-in-" + targetTheme, JSON.stringify(state));
        themeCycles.push(state);
        await auditThemeContrast(page, viewport, targetTheme);
        await auditDiscountBadge(page, viewport, targetTheme);
        if (viewport.width === 1440 && targetTheme === "dark") {
          await page.screenshot({ path:path.join(OUT_DIR,"desktop-hero-dark.png") });
        }
      }
      check(themeCycles.length === 2 && themeCycles[0].theme === "dark" &&
        themeCycles[1].theme === "light",
        viewport, "desktop-theme-toggle-is-reversible", JSON.stringify(themeCycles));

      const finalGeometry = await page.evaluate(() => ({
        viewportWidth:window.innerWidth,
        documentWidth:document.documentElement.scrollWidth,
        bodyWidth:document.body.scrollWidth,
        drawerOpen:Boolean(document.querySelector("#cartDrawer")?.classList.contains("is-open")),
        drawerVisibility:getComputedStyle(document.querySelector("#cartDrawer")).visibility,
        drawerPointerEvents:getComputedStyle(document.querySelector("#cartDrawer")).pointerEvents,
        backdropVisible:Boolean(document.querySelector("#cartBackdrop")?.classList.contains("is-visible"))
      }));
      check(finalGeometry.documentWidth <= viewport.width + 1 &&
        finalGeometry.bodyWidth <= viewport.width + 1 &&
        !finalGeometry.drawerOpen && finalGeometry.drawerVisibility === "hidden" &&
        finalGeometry.drawerPointerEvents === "none" && !finalGeometry.backdropVisible,
        viewport, "desktop-layout-remains-stable-after-theme-cycles", JSON.stringify(finalGeometry));

      check(pageErrors.length === 0, viewport, "desktop-no-page-javascript-errors",
        JSON.stringify(pageErrors));
      const unexpectedHttpErrors = httpErrors.filter(item => {
        try { return !new URL(item.url).pathname.includes("/api/"); } catch (_) { return true; }
      });
      check(unexpectedHttpErrors.length === 0, viewport, "desktop-no-unexpected-http-errors",
        JSON.stringify({ all:httpErrors, unexpected:unexpectedHttpErrors }));
      check(firstPartyFailures.length === 0, viewport, "desktop-no-site-or-food-image-request-failures",
        JSON.stringify(firstPartyFailures));
    } catch (error) {
      failures.push({
        viewport:sizeName(viewport), name:"desktop-responsive-browser-test-execution",
        pass:false, detail:error.stack || error.message
      });
    } finally {
      await context.close();
    }
  }
}

async function auditDishDetailSheet(page, viewport, themeName) {
  await page.locator("#menu").scrollIntoViewIfNeeded();
  await page.locator("#menuGrid [data-customize]").first().click();
  await page.waitForFunction(() => document.querySelector("#dishDetailDialog")?.open === true);
  await page.waitForTimeout(280);
  const metrics = await page.evaluate(() => {
    const dialog=document.querySelector("#dishDetailDialog");
    const hero=dialog?.querySelector(".customizer-hero");
    const image=dialog?.querySelector(".customizer-image-wrap");
    const form=dialog?.querySelector(".dish-customizer-form");
    const footer=dialog?.querySelector(".customizer-footer");
    const close=dialog?.querySelector(".customizer-close");
    const submit=dialog?.querySelector(".customizer-submit");
    const rect=element=>element?element.getBoundingClientRect():null;
    const d=rect(dialog),h=rect(hero),i=rect(image),f=rect(form),b=rect(footer),c=rect(close),s=rect(submit);
    return {
      theme:document.documentElement.dataset.theme||"",
      viewport:{width:window.innerWidth,height:window.innerHeight},
      dialog:d?{left:d.left,right:d.right,top:d.top,bottom:d.bottom,width:d.width,height:d.height}:null,
      bottomAnchored:Boolean(d&&Math.abs(d.bottom-window.innerHeight)<=2),
      heightRatio:d?d.height/window.innerHeight:0,
      heroHeight:h?.height||0,
      imageFits:Boolean(i&&h&&i.left>=h.left-1&&i.right<=h.right+1&&i.top>=h.top-1&&i.bottom<=h.bottom+1),
      closeFits:Boolean(c&&d&&c.left>=d.left&&c.right<=d.right&&c.top>=d.top&&c.bottom<=d.bottom),
      formFits:Boolean(f&&d&&f.left>=d.left-1&&f.right<=d.right+1&&f.bottom<=d.bottom+1),
      formNoHorizontalOverflow:Boolean(form&&form.scrollWidth<=form.clientWidth+1),
      formUsesOwnScroll:Boolean(form&&["auto","scroll"].includes(getComputedStyle(form).overflowY)),
      choiceCount:dialog?.querySelectorAll(".customizer-choice,.customizer-addon,.customizer-preference").length||0,
      footerFits:Boolean(b&&f&&b.left>=f.left-1&&b.right<=f.right+1&&b.height>=50),
      submitFits:Boolean(s&&b&&s.left>=b.left-1&&s.right<=b.right+1&&s.height>=40&&s.bottom<=b.bottom+1),
      submitText:submit?.innerText.replace(/\s+/g," ").trim()||"",
      borderRadius:getComputedStyle(dialog||document.body).borderTopLeftRadius
    };
  });
  check(Boolean(metrics.dialog)&&metrics.bottomAnchored&&metrics.heightRatio<=.74&&
    metrics.dialog.left>=-1&&metrics.dialog.right<=viewport.width+1,
    viewport,themeName+"-dish-customizer-is-a-compact-bottom-sheet",JSON.stringify(metrics));
  check(metrics.imageFits&&metrics.closeFits&&metrics.formFits&&metrics.formNoHorizontalOverflow&&
    metrics.formUsesOwnScroll&&metrics.choiceCount>=3&&metrics.footerFits&&metrics.submitFits,
    viewport,themeName+"-dish-customizer-controls-and-add-bar-align",JSON.stringify(metrics));
  if(viewport.width===390) {
    await page.screenshot({path:path.join(OUT_DIR,"mobile-390-dish-sheet-"+themeName+".png")});
  }

  await page.locator("#customizerQtyPlus").click();
  const quantity=await page.locator("#customizerQty").textContent();
  check(quantity?.trim()==="2",viewport,themeName+"-dish-customizer-quantity-control-works",quantity||"");
  await page.locator('[data-close-dialog="dishDetailDialog"]').click();
  await page.waitForFunction(()=>document.querySelector("#dishDetailDialog")?.open===false);
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
    await auditInteractionMotion(page, viewport, "mobile");

    const introButton = page.locator("#skipWelcome");
    if (await introButton.isVisible().catch(() => false)) {
      await introButton.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(450);
    }

    const initialCartState = await page.evaluate(() => {
      const drawer = document.querySelector("#cartDrawer");
      const style = drawer ? getComputedStyle(drawer) : null;
      return {
        drawerOpen:Boolean(drawer?.classList.contains("is-open")),
        ariaHidden:drawer?.getAttribute("aria-hidden"),
        visibility:style?.visibility || "missing",
        pointerEvents:style?.pointerEvents || "missing",
        backdropVisible:Boolean(document.querySelector("#cartBackdrop")?.classList.contains("is-visible")),
        bodyLocked:document.body.classList.contains("drawer-open")
      };
    });
    check(!initialCartState.drawerOpen && initialCartState.ariaHidden === "true" &&
      initialCartState.visibility === "hidden" && initialCartState.pointerEvents === "none" &&
      !initialCartState.backdropVisible && !initialCartState.bodyLocked,
      viewport, "mobile-cart-starts-fully-hidden", JSON.stringify(initialCartState));

    if (viewport.width === 390) {
      await page.screenshot({ path: path.join(OUT_DIR, "mobile-390-home.png") });
    }
    const teamDashboardOption = await page.evaluate(() => {
      const footer = document.querySelector(".site-footer");
      const helpColumn = Array.from(footer?.querySelectorAll(".footer-column") || [])
        .find(column => column.querySelector("h3")?.textContent.trim() === "Need a hand?");
      const contact = Array.from(helpColumn?.querySelectorAll("a") || [])
        .find(link => link.textContent.trim() === "Get in touch");
      return {
        buttonPresent:Boolean(document.querySelector("#openAdmin")),
        footerContainsTeamDashboard:/team dashboard/i.test(footer?.innerText || ""),
        helpHeading:helpColumn?.querySelector("h3")?.textContent.trim() || "",
        contactVisible:Boolean(contact && getComputedStyle(contact).display !== "none" &&
          contact.getBoundingClientRect().width > 0 && contact.getBoundingClientRect().height > 0)
      };
    });
    check(!teamDashboardOption.buttonPresent && !teamDashboardOption.footerContainsTeamDashboard &&
      teamDashboardOption.helpHeading === "Need a hand?" && teamDashboardOption.contactVisible,
      viewport, "team-dashboard-footer-option-removed", JSON.stringify(teamDashboardOption));

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
      visibleBrandLogos: (() => {
        const visibleImages = Array.from(document.querySelectorAll(".brand img"))
          .filter(img => getComputedStyle(img).display !== "none").length;
        const lockup = document.querySelector(".mobile-brand-lockup");
        const rect = lockup?.getBoundingClientRect();
        const lockupVisible = Boolean(lockup && getComputedStyle(lockup).display !== "none" && rect && rect.width > 0 && rect.height > 0);
        return visibleImages + (lockupVisible ? 1 : 0);
      })(),
      mobileBrandLockup: (() => {
        const lockup = document.querySelector(".mobile-brand-lockup");
        const name = lockup?.querySelector(".mobile-brand-name");
        const tagline = lockup?.querySelector(".mobile-brand-tagline");
        const visible = Boolean(lockup && getComputedStyle(lockup).display !== "none" &&
          lockup.getBoundingClientRect().width > 0 && lockup.getBoundingClientRect().height > 0);
        const brightness = color => {
          const rgb = String(color || "").match(/\d+/g)?.slice(0,3).map(Number) || [];
          return rgb.length === 3 ? Math.round((rgb[0]+rgb[1]+rgb[2])/3) : 0;
        };
        return {
          visible,
          wordmark:name ? name.innerText.replace(/\s+/g,"") : "",
          wordmarkColor:name ? getComputedStyle(name).color : "",
          wordmarkBrightness:name ? brightness(getComputedStyle(name).color) : 0,
          taglineColor:tagline ? getComputedStyle(tagline).color : "",
          taglineBrightness:tagline ? brightness(getComputedStyle(tagline).color) : 0,
          markWidth:lockup?.querySelector(".mobile-brand-mark")?.getBoundingClientRect().width || 0
        };
      })(),
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
        const grid = document.querySelector("#menuGrid");
        if (!card || !grid) return { valid:false,columns:0 };
        const cardRect = card.getBoundingClientRect();
        const imageRect = card.querySelector(".dish-image-wrap")?.getBoundingClientRect();
        const contentRect = card.querySelector(".dish-content")?.getBoundingClientRect();
        const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
        const imageRatio = imageRect && imageRect.height > 0 ? imageRect.width / imageRect.height : 0;
        return { valid:Boolean(imageRect && contentRect) &&
          imageRect.left >= cardRect.left-1 && imageRect.right <= cardRect.right+1 &&
          imageRect.top >= cardRect.top-1 && imageRect.bottom <= contentRect.top+2 &&
          contentRect.left >= cardRect.left-1 && contentRect.right <= cardRect.right+1 &&
          contentRect.bottom <= cardRect.bottom+1 && columns === 2 &&
          imageRatio >= 1.05 && imageRatio <= 1.55,
          columns,imageRatio:Number(imageRatio.toFixed(2)),
          cardWidth:Math.round(cardRect.width),imageHeight:Math.round(imageRect?.height || 0) };
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
    check(pageGeometry.dishCardAlignment.columns === 2, viewport, "dish-menu-has-two-aligned-columns",
      JSON.stringify(pageGeometry.dishCardAlignment));
    check(pageGeometry.dockVisible, viewport, "mobile-dock-visible");
    check(pageGeometry.scrollShell.separated && pageGeometry.scrollShell.contentHeight > 200,
      viewport, "mobile-dock-does-not-cover-page-content", JSON.stringify(pageGeometry.scrollShell));
    check(pageGeometry.visibleBrandLogos === 1, viewport, "exactly-one-theme-logo-visible",
      String(pageGeometry.visibleBrandLogos));
    check(pageGeometry.mobileBrandLockup.visible &&
      pageGeometry.mobileBrandLockup.wordmark === "FoodieHub" &&
      pageGeometry.mobileBrandLockup.wordmarkBrightness < 150 &&
      pageGeometry.mobileBrandLockup.markWidth >= 32,
      viewport, "mobile-brand-wordmark-is-visible-in-light-theme",
      JSON.stringify(pageGeometry.mobileBrandLockup));
    check(pageGeometry.headerCartBadgeContained, viewport, "header-cart-count-stays-inside-button");
    await waitForThemeTransition(page);
    await page.waitForTimeout(800);
    await auditThemeContrast(page, viewport, "light");

    await page.locator("#themeToggle").click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    await waitForThemeTransition(page);
    const darkThemeGeometry = await page.evaluate(() => {
      const name = document.querySelector(".mobile-brand-name");
      const tagline = document.querySelector(".mobile-brand-tagline");
      const brightness = color => {
        const rgb = String(color || "").match(/\d+/g)?.slice(0,3).map(Number) || [];
        return rgb.length === 3 ? Math.round((rgb[0]+rgb[1]+rgb[2])/3) : 0;
      };
      const lockup = document.querySelector(".mobile-brand-lockup");
      return {
        theme:document.documentElement.dataset.theme,
        lockupVisible:Boolean(lockup && getComputedStyle(lockup).display !== "none" &&
          lockup.getBoundingClientRect().width > 0 && lockup.getBoundingClientRect().height > 0),
        wordmark:name ? name.innerText.replace(/\s+/g,"") : "",
        wordmarkColor:name ? getComputedStyle(name).color : "",
        wordmarkBrightness:name ? brightness(getComputedStyle(name).color) : 0,
        taglineBrightness:tagline ? brightness(getComputedStyle(tagline).color) : 0,
        dockVisible:getComputedStyle(document.querySelector("#mobileDock")).display !== "none"
      };
    });
    check(darkThemeGeometry.theme === "dark" && darkThemeGeometry.lockupVisible &&
      darkThemeGeometry.wordmark === "FoodieHub" && darkThemeGeometry.wordmarkBrightness >= 190 &&
      darkThemeGeometry.taglineBrightness >= 140 && darkThemeGeometry.dockVisible,
      viewport, "dark-theme-shows-high-contrast-mobile-wordmark-and-dock", JSON.stringify(darkThemeGeometry));
    await auditThemeContrast(page, viewport, "dark");
    if (viewport.width === 390) {
      await page.screenshot({ path:path.join(OUT_DIR,"mobile-390-dark-home.png") });
    }
    await page.locator("#themeToggle").click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    await waitForThemeTransition(page);
    const lightBrandAfterToggle = await page.evaluate(() => ({
      visible:getComputedStyle(document.querySelector(".mobile-brand-lockup")).display !== "none",
      text:document.querySelector(".mobile-brand-name")?.innerText.replace(/\s+/g,"") || "",
      color:getComputedStyle(document.querySelector(".mobile-brand-name")).color
    }));
    check(lightBrandAfterToggle.visible && lightBrandAfterToggle.text === "FoodieHub" &&
      lightBrandAfterToggle.color === "rgb(32, 61, 46)",
      viewport, "light-theme-keeps-mobile-wordmark-readable", JSON.stringify(lightBrandAfterToggle));
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
    const compactOfferChecks = [];
    for (let slide=0; slide<4; slide += 1) {
      await page.locator('#offerCarousel [data-offer-dot="' + slide + '"]').click();
      await page.waitForFunction(index =>
        document.querySelector('#offerCarousel [data-offer-dot="' + index + '"]')?.getAttribute("aria-pressed") === "true", slide);
      compactOfferChecks.push(await page.locator("#offerCarousel .offer-slide.is-active").evaluate(panel => {
        const panelRect = panel.getBoundingClientRect();
        const copy = panel.querySelector(".offer-copy")?.getBoundingClientRect();
        const art = panel.querySelector(".offer-art");
        const button = panel.querySelector(".offer-copy .button")?.getBoundingClientRect();
        return {
          height:Math.round(panelRect.height),
          artDisplay:art ? getComputedStyle(art).display : "missing",
          copyWidth:copy ? Math.round(copy.width) : 0,
          panelWidth:Math.round(panelRect.width),
          ctaVisible:Boolean(button && button.width > 0 && button.height >= 30 &&
            button.left >= panelRect.left - 1 && button.right <= panelRect.right + 1 &&
            button.top >= panelRect.top - 1 && button.bottom <= panelRect.bottom + 1),
          ctaRect:button ? {x:Math.round(button.left-panelRect.left),y:Math.round(button.top-panelRect.top),
            width:Math.round(button.width),height:Math.round(button.height),bottom:Math.round(button.bottom-panelRect.top)} : null,
          ctaStyle:panel.querySelector(".offer-copy .button") ? {
            display:getComputedStyle(panel.querySelector(".offer-copy .button")).display,
            visibility:getComputedStyle(panel.querySelector(".offer-copy .button")).visibility,
            opacity:getComputedStyle(panel.querySelector(".offer-copy .button")).opacity
          } : null
        };
      }));
    }
    check(compactOfferChecks.length === 4 && compactOfferChecks.every(item =>
      item.height <= 190 && item.artDisplay === "none" && item.copyWidth >= item.panelWidth - 36 && item.ctaVisible),
      viewport, "mobile-offers-use-compact-text-first-layout", JSON.stringify(compactOfferChecks));
    await page.locator('#offerCarousel [data-offer-dot="0"]').click();
    await page.waitForFunction(() =>
      document.querySelector('#offerCarousel [data-offer-dot="0"]')?.getAttribute("aria-pressed") === "true");

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
        drawerVisibility:getComputedStyle(document.querySelector("#cartDrawer")).visibility,
        drawerPointerEvents:getComputedStyle(document.querySelector("#cartDrawer")).pointerEvents,
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
    check(bag.drawerVisibility === "visible" && bag.drawerPointerEvents !== "none",
      viewport, "bag-drawer-is-visible-and-interactive-only-when-open", JSON.stringify(bag));
    check(bag.toastHidden, viewport, "toast-does-not-cover-bag");

    if (viewport.width === 390) {
      await page.screenshot({ path: path.join(OUT_DIR, "mobile-390-bag.png") });
    }

    await page.locator("#closeCart").click();
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
        await waitForThemeTransition(page);
      }
      await auditMobileLayout(page, viewport, theme);
      await auditMobileFeaturePolish(page, viewport, theme);
      await auditDishDetailSheet(page, viewport, theme);
      await auditDiscountBadge(page, viewport, theme);

      // Full mobile checkout pass in both themes. Use validation-only submits:
      // never create a demo order or contact the payment provider.
      await page.locator("#mobileOpenCart").click();
      await page.waitForFunction(() => document.querySelector("#cartDrawer")?.classList.contains("is-open"));
      await page.locator("#checkoutButton").click();
      await page.waitForFunction(() => document.querySelector("#checkoutDialog")?.open === true);
      await page.waitForTimeout(360); // let the 300ms dialog entrance transition settle before measuring bounds
      const checkoutLayout = await page.evaluate(() => {
        const dialog = document.querySelector("#checkoutDialog");
        const form = document.querySelector("#checkoutForm");
        const placeButton = form?.querySelector(".place-order-button");
        if (!dialog || !form || !placeButton) return null;
        const dialogRect = dialog.getBoundingClientRect();
        const formRect = form.getBoundingClientRect();
        const fields = Array.from(form.querySelectorAll(".form-field input,.form-field select,.form-field textarea"));
        const fieldBounds = fields.map(field => {
          const rect = field.getBoundingClientRect();
          return rect.left >= formRect.left - 1 && rect.right <= formRect.right + 1 && rect.width > 0;
        });
        const paymentLabels = Array.from(form.querySelectorAll(".payment-choice label"));
        const paymentBounds = paymentLabels.map(label => {
          const rect = label.getBoundingClientRect();
          return rect.left >= formRect.left - 1 && rect.right <= formRect.right + 1 && rect.width > 0;
        });
        const itemCount = form.querySelectorAll(".checkout-review-item").length;
        const hasCod = Boolean(form.querySelector('input[name="paymentMethod"][value="cod"]:not(:disabled)'));
        const hasUpi = Boolean(form.querySelector('input[name="paymentMethod"][value="upi_at_door"]:not(:disabled)'));
        const originalScrollTop = form.scrollTop;
        form.scrollTop = form.scrollHeight;
        const buttonRect = placeButton.getBoundingClientRect();
        const buttonReachable = buttonRect.top >= formRect.top - 1 && buttonRect.bottom <= formRect.bottom + 1;
        form.scrollTop = originalScrollTop;
        return {
          theme:document.documentElement.dataset.theme || "light",
          dialogWithinViewport:dialogRect.left >= -1 && dialogRect.right <= window.innerWidth + 1 &&
            dialogRect.top >= -1 && dialogRect.bottom <= window.innerHeight + 1,
          dialogWidth:dialogRect.width,
          dialogHeight:dialogRect.height,
          viewportWidth:window.innerWidth,
          viewportHeight:window.innerHeight,
          formHasNoHorizontalOverflow:form.scrollWidth <= form.clientWidth + 1,
          formScrollsVertically:form.scrollHeight > form.clientHeight,
          allFieldsFit:fieldBounds.length >= 10 && fieldBounds.every(Boolean),
          paymentChoicesFit:paymentBounds.length === 3 && paymentBounds.every(Boolean),
          hasCartReviewItem:itemCount >= 1,
          hasCod,
          hasUpi,
          buttonReachable,
          buttonWidth:buttonRect.width,
          formWidth:formRect.width
        };
      });
      check(Boolean(checkoutLayout) && checkoutLayout.dialogWithinViewport &&
        checkoutLayout.formHasNoHorizontalOverflow && checkoutLayout.formScrollsVertically &&
        checkoutLayout.allFieldsFit && checkoutLayout.paymentChoicesFit &&
        checkoutLayout.hasCartReviewItem && checkoutLayout.hasCod && checkoutLayout.hasUpi &&
        checkoutLayout.buttonReachable && checkoutLayout.buttonWidth >= checkoutLayout.formWidth - 30,
        viewport, "checkout-layout-and-payment-controls-fit-in-" + theme, JSON.stringify(checkoutLayout));

      await page.locator("#checkoutForm").evaluate(form => {
        form.noValidate = true;
        form.requestSubmit();
      });
      await page.waitForFunction(() => document.querySelector("#checkoutError")?.textContent.includes("Choose a payment method"));
      const missingPaymentMessage = await page.locator("#checkoutError").textContent();
      check(Boolean(missingPaymentMessage && missingPaymentMessage.includes("Choose a payment method")),
        viewport, "checkout-requires-payment-method-in-" + theme, missingPaymentMessage || "");

      await page.locator('#checkoutForm input[name="name"]').fill("QA Customer");
      await page.locator('#checkoutForm input[name="phone"]').fill("12345");
      await page.locator('#checkoutForm input[name="paymentMethod"][value="cod"]').check({ force:true });
      await page.locator("#checkoutForm").evaluate(form => form.requestSubmit());
      await page.waitForFunction(() => document.querySelector("#checkoutError")?.textContent.includes("valid 10-digit Indian mobile number"));
      const invalidPhoneState = await page.evaluate(() => ({
        message:document.querySelector("#checkoutError")?.textContent || "",
        cartCount:document.querySelector("#cartCount")?.textContent || "",
        dialogOpen:Boolean(document.querySelector("#checkoutDialog")?.open),
        codSelected:Boolean(document.querySelector('#checkoutForm input[name="paymentMethod"][value="cod"]')?.checked)
      }));
      check(invalidPhoneState.message.includes("valid 10-digit Indian mobile number") &&
        invalidPhoneState.cartCount === "1" && invalidPhoneState.dialogOpen && invalidPhoneState.codSelected,
        viewport, "checkout-invalid-phone-keeps-cart-safe-in-" + theme, JSON.stringify(invalidPhoneState));
      await page.locator('[data-close-dialog="checkoutDialog"]').click();
      await page.waitForFunction(() => document.querySelector("#checkoutDialog")?.open === false);

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
      await waitForThemeTransition(page);
    }

    await page.locator("#openProfile").click();
    await page.waitForFunction(() => document.querySelector("#profileDialog")?.open === true);
    const accountUi = await page.evaluate(() => {
      const dialog = document.querySelector("#profileDialog");
      const rect = dialog.getBoundingClientRect();
      return {
        fitsViewport: rect.left >= -1 && rect.right <= window.innerWidth + 1,
        dialogTop:Math.round(rect.top),
        dialogBottom:Math.round(rect.bottom),
        dialogHeight:Math.round(rect.height),
        viewportHeight:window.innerHeight,
        dialogPosition:getComputedStyle(dialog).position,
        dialogBottomStyle:getComputedStyle(dialog).bottom,
        dialogMaxHeight:getComputedStyle(dialog).maxHeight,
        dialogOverflow:getComputedStyle(dialog).overflowY,
        bottomSheet:Math.abs(rect.bottom-window.innerHeight)<=2&&rect.height<=window.innerHeight*.72,
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
    check(accountUi.fitsViewport && accountUi.formFits && accountUi.bottomSheet,
      viewport, "account-dialog-is-a-compact-bottom-sheet", JSON.stringify(accountUi));
    check(accountUi.hasSignIn && accountUi.hasRegistration && accountUi.hasSavedAddressList,
      viewport, "customer-account-controls-render", JSON.stringify(accountUi));
    if (viewport.width === 390) await page.screenshot({ path: path.join(OUT_DIR, "mobile-390-account.png") });
    await page.locator('[data-close-dialog="profileDialog"]').click();
    await page.waitForFunction(() => document.querySelector("#profileDialog")?.open === false);
    check(await page.locator("#profileDialog").evaluate(dialog => !dialog.open),
      viewport, "profile-close-button-closes-dialog");
    await page.locator("#openProfile").click();
    await page.waitForFunction(() => document.querySelector("#profileDialog")?.open === true);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("#profileDialog")?.open === false);
    check(await page.locator("#profileDialog").evaluate(dialog => !dialog.open),
      viewport, "profile-dialog-closes-with-escape");

    for (const [buttonSelector,dialogSelector,closeSelector,label,maxRatio] of [
      ["#trackOrderHome","#trackingDialog",'[data-close-dialog="trackingDialog"]',"tracking",0.72],
      ["#openMyDashboard","#myDashboardDialog",'[data-close-dialog="myDashboardDialog"]',"dashboard",0.78]
    ]) {
      await page.locator(buttonSelector).scrollIntoViewIfNeeded();
      await page.locator(buttonSelector).click();
      await page.waitForFunction(selector=>document.querySelector(selector)?.open===true,dialogSelector);
      await page.waitForTimeout(260);
      const sheet=await page.locator(dialogSelector).evaluate(dialog=>{
        const rect=dialog.getBoundingClientRect();
        return {
          top:Math.round(rect.top),bottom:Math.round(rect.bottom),
          height:Math.round(rect.height),width:Math.round(rect.width),
          viewportHeight:window.innerHeight,
          bottomAnchored:Math.abs(rect.bottom-window.innerHeight)<=2,
          fitsViewport:rect.left>=-1&&rect.right<=window.innerWidth+1,
          maxHeight:getComputedStyle(dialog).maxHeight,
          overflow:getComputedStyle(dialog).overflowY
        };
      });
      check(sheet.bottomAnchored&&sheet.fitsViewport&&sheet.height<=viewport.height*maxRatio,
        viewport,label+"-opens-as-compact-bottom-sheet",JSON.stringify(sheet));
      await page.locator(closeSelector).click();
      await page.waitForFunction(selector=>document.querySelector(selector)?.open===false,dialogSelector);
    }

    const buttonActions=[];
    for(const [label,selector] of [
      ["meal","#addMealBundle"],
      ["combo","#smart-combos [data-combo]"],
      ["recommendation","#smart-picks [data-recommend-add]"]
    ]) {
      const button=page.locator(selector).first();
      const visible=await button.isVisible().catch(()=>false);
      const enabled=visible&&await button.isEnabled().catch(()=>false);
      const before=Number(await page.locator("#cartCount").textContent()||0);
      if(enabled) {
        await button.click();
        await page.waitForFunction(previous=>Number(document.querySelector("#cartCount")?.textContent||0)>previous,before);
      }
      const after=Number(await page.locator("#cartCount").textContent()||0);
      const pass=visible&&enabled&&after>before;
      buttonActions.push({label,visible,enabled,before,after,pass});
      check(pass,viewport,label+"-button-adds-items-to-cart",JSON.stringify(buttonActions[buttonActions.length-1]));
    }

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
    // One final add-to-bag action, after checkout validation has verified its clean cart count.
    const addTheme = await page.evaluate(() => document.documentElement.dataset.theme || "light");
    await page.locator("#menuGrid [data-customize]").first().click();
    await page.waitForFunction(() => document.querySelector("#dishDetailDialog")?.open === true);
    await page.locator("#customizerQtyPlus").click();
    await page.locator(".customizer-submit").click();
    await page.waitForFunction(() => document.querySelector("#dishDetailDialog")?.open === false);
    const finalCartCount = Number((await page.locator("#cartCount").textContent()) || "0");
    check(finalCartCount >= 3, viewport, addTheme+"-dish-customizer-adds-selected-quantity-to-bag", String(finalCartCount));
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
    await runDesktopHeroThemeAudit(browser);
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
